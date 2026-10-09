import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { categories, customer_products, customers, items, orders, production_orders } from "../shared/schema";
import router from "../server/routes";
import { db, pool } from "../server/db";

jest.mock("../server/db", () => ({
  db: { transaction: jest.fn(), select: jest.fn() }, pool: { connect: jest.fn() },
}));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/auth", () => ({
  requireAnyPermission: (...permissions: string[]) => (req: any, res: any, next: any) =>
    permissions.includes(req.headers["x-test-permission"]) ? next() : res.status(403).json({ message: "Forbidden" }),
  requirePermission: (permission: string) => (req: any, res: any, next: any) =>
    permission === req.headers["x-test-permission"] ? next() : res.status(403).json({ message: "Forbidden" }),
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  resolveUser: jest.fn(),
  hashPassword: jest.fn(),
}));

const baseOrder = { id: 7, order_number: "TEST-7", customer_id: "C1", status: "waiting", notes: null, created_at: "2026-01-01T23:00:00Z", delivery_date: null, delivery_days: null };
const baseLines = [
  { id: 11, order_id: 7, production_order_number: "TEST-7-01", customer_product_id: 1, quantity_kg: "10.00", final_quantity_kg: "10.00", status: "pending", batch_number: null },
  { id: 12, order_id: 7, production_order_number: "TEST-7-02", customer_product_id: 2, quantity_kg: "20.00", final_quantity_kg: "20.00", status: "pending", batch_number: null },
];

function fakeTransaction(
  state: { order: any; lines: any[] },
  failInsert = false,
  createdProducts: any[] = [],
  itemCategoryId = "CAT1",
  categoryPercentage = 0,
) {
  return async (callback: (tx: any) => Promise<any>) => {
    // Writes are private until callback succeeds, just as in a DB transaction.
    const draft = structuredClone(state);
    const pendingProducts: any[] = [];
    const tx = {
      select: () => ({
        from(table: unknown) {
          const rows = table === orders ? [draft.order] :
            table === production_orders ? [...draft.lines] :
              table === customer_products ? [
                ...pendingProducts,
                ...[1, 2, 3].map((id) => ({ id, category_id: "CAT1" })),
              ] :
                table === customers ? [{ id: "C1" }] :
                  table === categories ? [{ id: "CAT1", name: "Bag", name_ar: "كيس", overrun_percentage: categoryPercentage }] :
                    table === items ? [{ id: "IT1", category_id: itemCategoryId }] : [];
          const query: any = {
            where: () => query,
            orderBy: () => query,
            for: () => query,
            limit: async () => rows,
            then: (resolve: (value: any[]) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(rows).then(resolve, reject),
          };
          return query;
        },
      }),
      update: (table: unknown) => ({
        set(values: any) {
          return {
            where() {
              return {
                returning: async () => {
                  if (table === orders) Object.assign(draft.order, values);
                  else Object.assign(draft.lines[0], values);
                  return [table === orders ? draft.order : draft.lines[0]];
                },
              };
            },
          };
        },
      }),
      insert: (table: unknown) => ({
        values: (values: any) => ({
          returning: async () => {
            if (failInsert && table === production_orders) throw new Error("simulated insert failure");
            const created = { id: table === customer_products ? 88 : 99, ...values };
            if (table === customer_products) pendingProducts.push(created);
            else if (table === production_orders) draft.lines.push(created);
            return [created];
          },
        }),
      }),
      delete: (_table: unknown) => ({ where: async () => { draft.lines.splice(0, 1); } }),
    };
    const result = await callback(tx);
    state.order = draft.order;
    state.lines = draft.lines;
    createdProducts.push(...pendingProducts);
    return result;
  };
}

const original_items = baseLines.map(({ id, customer_product_id, quantity_kg }) => ({ id, customer_product_id, quantity_kg }));
const body = (items: any[]) => ({ delivery_days: 20, original_items, items });

describe("editing an order with production lines", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.name === "ZodError" ? 400 : error.status || 500).json({ message: error.message }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  const request = (items: any[], permission = "manage_orders", extra: Record<string, unknown> = {}) =>
    fetch(`${url}/api/orders/7/with-items`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-test-permission": permission },
      body: JSON.stringify({ ...body(items), ...extra }),
    });

  const draftProduct = () => ({
    category_id: "CAT1",
    item_id: "IT1",
    width: "20",
    left_facing: "2",
    right_facing: "3",
    thickness: "20",
    density: "",
    printing_cylinder: "8\"",
    cutting_length_cm: 18,
    raw_material: "LDPE",
    master_batch_id: null,
    cutting_unit: "automatic",
    punching: "handle",
    unit_weight_kg: "1.250",
    unit_quantity: 4,
    cliche_front_design: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`,
    cliche_back_design: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`,
    front_print_colors: ["#112233", "Red"],
    back_print_colors: ["#445566"],
    notes: "draft product",
  });

  const untouchedLines = () => baseLines.map((line) => ({
    id: line.id,
    customer_product_id: line.customer_product_id,
    quantity_kg: line.quantity_kg,
  }));

  beforeEach(() => { jest.clearAllMocks(); });

  it("preserves a second user's release and started work when a stale editor saves notes", async () => {
    const state: { order: any; lines: any[] } = {
      order: structuredClone(baseOrder), lines: structuredClone(baseLines),
    };
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state) as typeof db.transaction);
    jest.mocked(db.select).mockImplementation(() => ({
      from: (table: unknown) => {
        const query: any = {
          where: () => query,
          limit: async () => [structuredClone(state.order)],
          orderBy: async () => structuredClone(table === production_orders ? state.lines : []),
        };
        return query;
      },
    }) as any);
    // First user opens the real edit endpoint while the order is still waiting.
    const opened = await fetch(`${url}/api/orders/7/with-items`, {
      headers: { "x-test-permission": "manage_orders" },
    });
    expect(opened.status).toBe(200);
    const snapshot: any = await opened.json();
    expect(snapshot.order.status).toBe("waiting");
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith("SELECT id,status")) return { rows: [structuredClone(state.order)] };
      if (sql.includes("FROM production_orders")) return { rows: structuredClone(state.lines) };
      if (sql.startsWith("UPDATE orders")) {
        state.order.previous_status = state.order.status;
        state.order.status = "for_production";
        return { rows: [structuredClone(state.order)] };
      }
      return { rows: [] };
    });
    jest.mocked(pool.connect).mockImplementation(async () => ({ query, release: jest.fn() }) as any);
    // A second user executes the independent release action.
    const released = await fetch(`${url}/api/orders/7/release-production`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-permission": "admin" },
      body: JSON.stringify({ expected_status: "waiting" }),
    });
    expect(released.status).toBe(200);
    expect(state.order.status).toBe("for_production");
    state.lines[0] = { ...state.lines[0], status: "active", batch_number: "B-001", started_at: "2026-10-06T08:00:00Z" };
    const work = structuredClone(state.lines);
    const saved = await request(snapshot.items.map((line: any) => ({
      id: line.id, customer_product_id: line.customer_product_id, quantity_kg: line.quantity_kg,
    })), "manage_orders", { status: snapshot.order.status, notes: "updated notes" });
    expect(saved.status).toBe(200);
    expect(state.order).toMatchObject({ status: "for_production", previous_status: "waiting", notes: "updated notes" });
    expect(state.lines).toEqual(work);
    expect(await saved.json()).toMatchObject({ order: { status: "for_production" }, production_orders: work });
  });

  it.each(["for_production", "in_production", "paused", "cancelled", "completed", "delivered", "archived"])(
    "cannot override current %s via the editor's legacy status field", async status => {
      const state: { order: any; lines: any[] } = {
        order: { ...baseOrder, status, previous_status: "on_hold" }, lines: structuredClone(baseLines),
      };
      jest.mocked(db.transaction).mockImplementation(fakeTransaction(state) as typeof db.transaction);
      const response = await request(untouchedLines(), "manage_orders", { status: "waiting", notes: "edited" });
      expect(response.status).toBe(200);
      expect(state.order).toMatchObject({ status, previous_status: "on_hold", notes: "edited" });
      expect(state.lines).toEqual(baseLines);
    },
  );

  it("keeps the surviving production-order ID and creates a new numbered line", async () => {
    const state = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state) as typeof db.transaction);
    const response = await request([
      { id: 12, customer_product_id: 2, quantity_kg: "20.00" },
      { customer_product_id: 3, quantity_kg: "5.00" },
    ]);
    expect(response.status).toBe(200);
    expect(state.lines.map((line) => line.id)).toEqual([12, 99]);
    expect(state.lines[1].production_order_number).toBe("TEST-7-03");
    expect(state.order.delivery_days).toBe(20);
    expect(state.order.delivery_date).toBe("2026-01-22");
  });

  it("continues JO numbering on new-format orders without renaming surviving lines", async () => {
    const state = {
      order: { ...structuredClone(baseOrder), order_number: "O00123" },
      lines: structuredClone(baseLines).map((line, index) => ({
        ...line, production_order_number: `O00123-JO${index ? "99" : "01"}`,
      })),
    };
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state) as typeof db.transaction);
    const response = await request([
      { id: 12, customer_product_id: 2, quantity_kg: "20.00" },
      { customer_product_id: 3, quantity_kg: "5.00" },
    ]);
    expect(response.status).toBe(200);
    expect(state.order.order_number).toBe("O00123");
    expect(state.lines.map(line => line.production_order_number)).toEqual(["O00123-JO99", "O00123-JO100"]);
    expect(state.lines.map(line => line.id)).toEqual([12, 99]);
  });

  it("rolls back the metadata update and keeps both old lines if inserting a replacement fails", async () => {
    const state = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state, true) as typeof db.transaction);
    const response = await request([
      { id: 12, customer_product_id: 2, quantity_kg: "20.00" },
      { customer_product_id: 3, quantity_kg: "5.00" },
    ]);
    expect(response.status).toBe(500);
    expect(state.lines).toEqual(baseLines);
    expect(state.order).toEqual(baseOrder);
  });

  it("rejects deletion of a line already in production without changing the order", async () => {
    const state = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    state.lines[0].status = "active";
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state) as typeof db.transaction);
    const response = await request([{ id: 12, customer_product_id: 2, quantity_kg: "20.00" }]);
    expect(response.status).toBe(409);
    expect(state.lines).toHaveLength(2);
  });

  it("rejects deleting a pending line with historical non-pending status", async () => {
    const state: { order: any; lines: any[] } = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    state.lines[0].previous_status = "active";
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state) as typeof db.transaction);
    const response = await request([{ id: 12, customer_product_id: 2, quantity_kg: "20.00" }]);
    expect(response.status).toBe(409);
    expect(state.lines).toHaveLength(2);
  });

  it("recalculates planned final quantity from the retained overrun after a quantity edit", async () => {
    const state: { order: any; lines: any[] } = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    state.lines[0].overrun_percentage = "25.00";
    state.lines[0].final_quantity_kg = "12.50";
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state, false, [], "CAT1", 20) as typeof db.transaction);
    const response = await request([
      { id: 11, customer_product_id: 1, quantity_kg: "12.00" },
      { id: 12, customer_product_id: 2, quantity_kg: "20.00" },
    ]);
    expect(response.status).toBe(200);
    expect(state.lines[0]).toMatchObject({ quantity_kg: "12.00", final_quantity_kg: "15.00" });
    expect(state.lines[0].overrun_percentage).toBe("25.00");
  });

  it("preserves the existing planned final quantity when only the product changes", async () => {
    const state: { order: any; lines: any[] } = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    state.lines[0].overrun_percentage = "25.00";
    state.lines[0].final_quantity_kg = "12.50";
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state) as typeof db.transaction);
    const response = await request([
      { id: 11, customer_product_id: 3, quantity_kg: "10.00" },
      { id: 12, customer_product_id: 2, quantity_kg: "20.00" },
    ]);
    expect(response.status).toBe(200);
    expect(state.lines[0]).toMatchObject({ customer_product_id: 3, final_quantity_kg: "12.50" });
  });

  it("rejects a stale edit instead of replacing a concurrently changed line", async () => {
    const state = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    state.lines[0].quantity_kg = "15.00";
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state) as typeof db.transaction);
    const response = await request(baseLines.map((line) => ({
      id: line.id, customer_product_id: line.customer_product_id, quantity_kg: line.quantity_kg,
    })));
    expect(response.status).toBe(409);
    expect(state.lines[0].quantity_kg).toBe("15.00");
  });

  it("requires order management permission", async () => {
    jest.mocked(db.transaction).mockClear();
    const response = await request([], "view_orders");
    expect(response.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("creates a full order draft product through the same normalization and derivation on edit", async () => {
    const state = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    const createdProducts: any[] = [];
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state, false, createdProducts, "CAT1", 20) as typeof db.transaction);
    const response = await request([
      ...untouchedLines(),
      { new_product: draftProduct(), quantity_kg: "5.00" },
    ]);
    expect(response.status).toBe(200);
    expect(createdProducts).toHaveLength(1);
    expect(createdProducts[0]).toMatchObject({
      customer_id: "C1",
      category_id: "CAT1",
      item_id: "IT1",
      width: "20",
      left_facing: "2",
      right_facing: "3",
      thickness: "20",
      density: "0.95",
      printing_cylinder: "8\"",
      cutting_length_cm: 20,
      raw_material: "LDPE",
      master_batch_id: null,
      cutting_unit: "automatic",
      punching: "handle",
      unit_weight_kg: "1.250",
      unit_quantity: 4,
      cliche_front_design: expect.stringContaining("data:image/png;base64,"),
      cliche_back_design: expect.stringContaining("data:image/png;base64,"),
      front_print_colors: ["#112233", "Red"],
      back_print_colors: ["#445566"],
      notes: "draft product",
      size_caption: "20+2+3X20",
      is_printed: true,
      bag_weight_grams: "5",
      bags_per_kilo: "211",
      package_weight_kg: "5.00",
    });
    expect(createdProducts[0]).not.toHaveProperty("universal_thickness");
    expect(state.lines.at(-1)).toMatchObject({
      customer_product_id: 88, overrun_percentage: "20", final_quantity_kg: "6.00",
    });
    expect(state.lines.slice(0, 2)).toEqual(baseLines);
  });

  it("applies today's category rate only to appended lines, not existing lines", async () => {
    const state = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state, false, [], "CAT1", 10) as typeof db.transaction);
    const response = await request([
      ...untouchedLines(), { customer_product_id: 3, quantity_kg: "5.00" },
    ]);
    expect(response.status).toBe(200);
    expect(state.lines.slice(0, 2)).toEqual(baseLines);
    expect(state.lines.at(-1)).toMatchObject({
      quantity_kg: "5.00", overrun_percentage: "10", final_quantity_kg: "5.50",
    });
  });

  it("rejects forged child customer and computed product fields on edit", async () => {
    const state = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    const forged = draftProduct() as any;
    forged.customer_id = "OTHER";
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state) as typeof db.transaction);
    const response = await request([...untouchedLines(), { new_product: forged, quantity_kg: "5.00" }]);
    expect(response.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();

    const computed = { ...draftProduct(), bag_weight_grams: "1" } as any;
    const computedResponse = await request([...untouchedLines(), { new_product: computed, quantity_kg: "5.00" }]);
    expect(computedResponse.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects wrong references, invalid images, and blocked facing sums for draft products on edit", async () => {
    const state = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    const createdProducts: any[] = [];
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state, false, createdProducts, "CAT2") as typeof db.transaction);
    const wrongReference = await request([...untouchedLines(), {
      new_product: draftProduct(), quantity_kg: "5.00",
    }]);
    expect(wrongReference.status).toBe(400);
    expect(createdProducts).toHaveLength(0);

    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state, false, createdProducts) as typeof db.transaction);
    const badImage = await request([...untouchedLines(), {
      new_product: { ...draftProduct(), cliche_front_design: `data:image/png;base64,${Buffer.from("<html>").toString("base64")}` },
      quantity_kg: "5.00",
    }]);
    expect(badImage.status).toBe(400);
    expect(createdProducts).toHaveLength(0);

    const blocked = await request([...untouchedLines(), {
      new_product: { ...draftProduct(), left_facing: "10", right_facing: "10" },
      quantity_kg: "5.00",
    }]);
    expect(blocked.status).toBe(400);
    expect(createdProducts).toHaveLength(0);
  });

  it("rolls back a draft product and order changes when its production-line insert fails", async () => {
    const state = { order: structuredClone(baseOrder), lines: structuredClone(baseLines) };
    const createdProducts: any[] = [];
    jest.mocked(db.transaction).mockImplementation(fakeTransaction(state, true, createdProducts) as typeof db.transaction);
    const response = await request([...untouchedLines(), {
      new_product: draftProduct(), quantity_kg: "5.00",
    }]);
    expect(response.status).toBe(500);
    expect(createdProducts).toHaveLength(0);
    expect(state.order).toEqual(baseOrder);
    expect(state.lines).toEqual(baseLines);
  });
});