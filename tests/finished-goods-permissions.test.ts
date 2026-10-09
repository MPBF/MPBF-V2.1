import { describe, expect, it, jest } from "@jest/globals";
import { createInstance } from "i18next";
import english from "../client/src/i18n-en";
import reviewedEnglish from "../client/src/i18n-en-reviewed";
import productionEnglish from "../client/src/i18n-en-production";
import orderWorkspaceEnglish from "../client/src/i18n-en-order-workspace";
import { finishedGoodsPermissionDescriptions, finishedGoodsPermissionGroup } from "../client/src/lib/finished-goods-permissions";
import { availableProductionViews, initialProductionPath } from "../client/src/lib/production-navigation";
import { ProductionReadService } from "../server/production/read";
import { ProductionWarehouseService } from "../server/production/warehouse";
import { ProductionExecutionService } from "../server/production/execution";
import type { ProductionUser } from "../shared/production";

const actor = (...permissions: string[]): ProductionUser => ({ id: 83, permissions });
const receipt = { request_id: "permission-test", items: [{ production_order_id: 1, location_id: 1, quantity_kg: "5.00" }] };
function fixture() {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes("SELECT id,order_id FROM production_orders")) return { rows: [{ id: 1, order_id: 1 }] };
    if (sql.includes("FOR UPDATE OF p")) return { rows: [{ id: 1, order_id: 1, order_status: "in_production" }] };
    if (sql.includes("SELECT id,is_active FROM factory_locations")) return { rows: [{ id: 1, is_active: true }] };
    if (sql.includes("SELECT * FROM factory_execution")) return { rows: [{ customer_product_id: 1, item_id: "ITM001", is_roll_product: false }] };
    if (sql.includes(" ready") && sql.includes(" received")) return { rows: [{ ready: "10.00", received: "0.00" }] };
    if (sql.includes("nextval")) return { rows: [{ id: 1 }] };
    if (sql.includes("RETURNING")) return { rows: [{ id: 1, voucher_number: "FR-00000001" }] };
    if (sql.includes("inventory_kg")) return { rows: [{ receipts: 0, movements: 0, inventory: 0, inventory_kg: "0" }] };
    if (sql.includes("count")) return { rows: [{ total: 0, total_kg: "0" }] };
    return { rows: [] };
  });
  const release = jest.fn();
  const connect = jest.fn(async () => ({ query, release }));
  const pool = { connect };
  return { query, connect, read: new ProductionReadService(pool), warehouse: new ProductionWarehouseService(pool), execution: new ProductionExecutionService(pool) };
}

describe("finished-goods role permission contract", () => {
  it("offers exactly the dedicated server keys, not legacy or broader inventory grants", () => {
    expect(finishedGoodsPermissionGroup.items.map(([key]) => key)).toEqual([
      "view_finished_inventory", "receive_production", "manage_finished_warehouse",
    ]);
  });
  it.each(["ar", "en"])("translates all labels and descriptions in %s", async language => {
    const i18n = createInstance();
    await i18n.init({ lng: language, fallbackLng: "ar", keySeparator: false, resources: {
      ar: { translation: {} },
      en: { translation: { ...productionEnglish, ...reviewedEnglish, ...orderWorkspaceEnglish, ...english } },
    } });
    const texts = [finishedGoodsPermissionGroup.label, finishedGoodsPermissionGroup.description,
      ...finishedGoodsPermissionGroup.items.map(([, label]) => label), ...Object.values(finishedGoodsPermissionDescriptions)];
    for (const text of texts) {
      expect(i18n.t(text)).toBe(language === "ar" ? text : productionEnglish[text]);
      if (language === "en") expect(i18n.t(text)).not.toMatch(/[\u0600-\u06ff]/);
    }
  });
  it.each([
    ["view_finished_inventory", ["warehouse"], "/production/warehouse"],
    ["receive_production", ["hall", "warehouse"], "/production/hall"],
    ["manage_finished_warehouse", ["warehouse"], "/production/warehouse"],
  ] as const)("opens the minimum %s role without unrelated grants", async (key, views, path) => {
    const user = actor(key);
    const f = fixture();
    expect(availableProductionViews(user).map(v => v.view)).toEqual(views);
    expect(initialProductionPath(user)).toBe(path);
    await expect(f.read.state(user, "warehouse")).resolves.toMatchObject({ orders: [], rolls: [], machines: [] });
    for (const kind of ["inventory", "receipts", "movements"] as const) {
      await expect(f.read.history(user, kind, {})).resolves.toBeDefined();
    }
    for (const stage of ["film", "printing", "cutting"] as const) {
      await expect(f.read.state(user, stage)).rejects.toMatchObject({ status: 403 });
    }
    for (const kind of ["orders", "rolls"] as const) await expect(f.read.history(user, kind, {})).rejects.toMatchObject({ status: 403 });
    expect(() => f.execution.film(user, 1, { request_id: "film-test", machine_id: "F1", weight_kg: "1.00", is_last_roll: false, inline_printed: false })).toThrow(expect.objectContaining({ status: 403 }));
    if (key !== "receive_production") expect(() => f.warehouse.receive(user, receipt)).toThrow(expect.objectContaining({ status: 403 }));
    if (key !== "manage_finished_warehouse") expect(() => f.warehouse.location(user, { request_id: "location-test", name: "A", name_ar: "أ" })).toThrow(expect.objectContaining({ status: 403 }));
  });
  it("allows a receive-only role to see ready output and commit a receipt, not production", async () => {
    const f = fixture();
    await f.read.state(actor("receive_production"), "hall");
    expect(f.query.mock.calls.some(([sql]) => sql.includes("WITH ready AS"))).toBe(true);
    await expect(f.warehouse.receive(actor("receive_production"), receipt)).resolves.toMatchObject({ voucher_number: "FR-00000001" });
    expect(f.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO factory_inventory"))).toBe(true);
    expect(f.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(true);
  });
  it.each(["manage_finished_warehouse", "admin"])("allows explicit location management with %s", async key => {
    const f = fixture();
    for (const id of [undefined, 1]) await expect(f.warehouse.location(actor(key), {
      request_id: `location-${id}`, name: "A", name_ar: "أ", is_active: false,
    }, id)).resolves.toMatchObject({ id: 1 });
  });
  it.each([
    { permissions: [] },
    { permissions: ["manage_warehouse", "view_warehouse", "manage_inventory", "view_inventory", "manage_production_hall"] },
    { permissions: ["manage_production"] },
  ])(
    "does not treat legacy or production management grants as receipt/inventory authority: $permissions", async ({ permissions }) => {
      const f = fixture();
      const user = actor(...permissions);
      await expect(f.read.history(user, "inventory", {})).rejects.toMatchObject({
        status: 403, message: "لا تملك صلاحية تنفيذ هذا الإجراء", message_en: "You do not have permission for this action.",
      });
      expect(() => f.warehouse.receive(user, receipt)).toThrow(expect.objectContaining({ status: 403 }));
      expect(() => f.warehouse.location(user, { request_id: "deny", name: "A", name_ar: "أ" })).toThrow(expect.objectContaining({ status: 403 }));
      expect(f.connect).not.toHaveBeenCalled();
    },
  );
});
