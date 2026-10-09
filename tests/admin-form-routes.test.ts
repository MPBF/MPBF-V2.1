import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  categories, customers, items, machines, sections, users,
} from "../shared/schema";
import router from "../server/routes";
import { db } from "../server/db";

jest.mock("../server/db", () => ({
  db: { transaction: jest.fn(), insert: jest.fn(), update: jest.fn(), select: jest.fn() },
}));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/auth", () => ({
  requireAnyPermission: (...required: string[]) => (req: any, res: any, next: any) => {
    const permissions = String(req.headers["x-test-permissions"] ?? req.headers["x-test-permission"] ?? "")
      .split(",").filter(Boolean);
    if (!required.some((permission) => permissions.includes(permission))) {
      return res.status(403).end();
    }
    req.user = { id: 7, permissions };
    next();
  },
  requirePermission: (...required: string[]) => (req: any, res: any, next: any) => {
    const permissions = String(req.headers["x-test-permissions"] ?? req.headers["x-test-permission"] ?? "")
      .split(",").filter(Boolean);
    if (!required.some((permission) => permissions.includes(permission))) return res.status(403).end();
    req.user = { id: 7, permissions };
    next();
  },
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  resolveUser: jest.fn(),
  hashPassword: jest.fn(),
}));

describe("administration form routes", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  let inserted: { table: unknown; values: Record<string, any> }[];
  let updated: { table: unknown; values: Record<string, any> }[];
  let deleted: unknown[];
  let txSelectRows: Map<unknown, any[]>;
  let txLimitResponses: Map<unknown, any[][]>;
  let txLocks: { table: unknown; strength: string }[];
  let executeRows: any[];
  let tx: any;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.status ?? (error.name === "ZodError" ? 400 : 500)).json({ message: error.message }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    inserted = [];
    updated = [];
    deleted = [];
    txSelectRows = new Map();
    txLimitResponses = new Map();
    txLocks = [];
    executeRows = [];
    tx = {
      execute: jest.fn(async () => ({ rows: executeRows.shift() ?? [] })),
      select: () => {
        let table: unknown;
        let locked = false;
        const query: any = {
          from(value: unknown) { table = value; return query; },
          innerJoin() { return query; },
          where() { return query; },
          orderBy: async () => txSelectRows.get(table) ?? [],
          for(strength: string) { locked = true; txLocks.push({ table, strength }); return query; },
          limit: async () => {
            const queued = txLimitResponses.get(table);
            if (queued?.length) return queued.shift();
            const rows = txSelectRows.get(table) ?? [];
            return locked ? rows.slice(0, 1) : rows.slice(0, 1);
          },
          then: (resolve: (rows: any[]) => unknown, reject: (error: unknown) => unknown) =>
            Promise.resolve(txSelectRows.get(table) ?? []).then(resolve, reject),
        };
        return query;
      },
      insert: (table: unknown) => ({
        values: (values: Record<string, any>) => ({
          returning: async () => {
            inserted.push({ table, values });
            return [{ ...values, id: values.id ?? 99 }];
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, any>) => {
          updated.push({ table, values });
          return {
            where: () => ({
              returning: async () => [{ ...values, id: table === categories ? "CAT1" : 99 }],
            }),
          };
        },
      }),
      delete: (table: unknown) => ({
        where: () => ({
          returning: async () => {
            deleted.push(table);
            return [{ id: table === sections ? "SEC01" : "MAC01" }];
          },
        }),
      }),
    };
    jest.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx) as any);
    jest.mocked(db.select).mockImplementation(() => tx.select());
    jest.mocked(db.insert).mockImplementation(() => ({
      values: (values: Record<string, any>) => ({
        returning: async () => {
          inserted.push({ table: null, values });
          return [{ ...values, id: 99 }];
        },
      }),
    }) as any);
    jest.mocked(db.update).mockImplementation((table: any) => ({
      set: (values: Record<string, any>) => {
        updated.push({ table, values });
        return {
          where: () => ({
            returning: async () => [{ ...values, id: table === "PT-CLEAR" ? "PT-CLEAR" : 99 }],
          }),
        };
      },
    }) as any);
  });

  const request = (path: string, method: string, body: unknown, permission = "manage_categories", grants = permission) =>
    fetch(`${url}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-test-permission": permission, "x-test-permissions": grants },
      body: JSON.stringify(body),
    });

  it("assigns category IDs and codes on the server, ignoring create overrides", async () => {
    executeRows = [[], [{ max_number: "5", suffix_width: 2 }], [{ value: "6" }]];
    const response = await request("/categories", "POST", {
      id: "CAT999", code: "USER-CODE", name: "  Film  ",
    });
    expect(response.status).toBe(201);
    expect(inserted[0]).toEqual({
      table: categories,
      values: { name: "Film", id: "CAT06", code: "CAT06" },
    });
  });

  it.each([0, 5, 10, 20])("persists allowed category production overrun %s on create and edit", async (percentage) => {
    executeRows = [[], [{ max_number: "5", suffix_width: 2 }], [{ value: "6" }]];
    const created = await request("/categories", "POST", { name: "Film", overrun_percentage: percentage });
    expect(created.status).toBe(201);
    expect(inserted[0].values.overrun_percentage).toBe(percentage);
    txSelectRows.set(categories, [{ id: "CAT1", parent_id: null, code: "CAT1" }]);
    const edited = await request("/categories/CAT1", "PUT", { overrun_percentage: percentage });
    expect(edited.status).toBe(200);
    expect(updated[0].values).toEqual({ overrun_percentage: percentage });
  });

  it.each([-1, 1, 15, 25, 5.5, null, "", "5", "5%"])("rejects unsupported category production overrun %s", async (percentage) => {
    const created = await request("/categories", "POST", { name: "Film", overrun_percentage: percentage });
    expect(created.status).toBe(400);
    expect(inserted).toHaveLength(0);
    txSelectRows.set(categories, [{ id: "CAT1", parent_id: null, code: "CAT1" }]);
    const edited = await request("/categories/CAT1", "PUT", { overrun_percentage: percentage });
    expect(edited.status).toBe(400);
    expect(updated).toHaveLength(0);
  });

  it("does not allow read-only category users to change the production overrun", async () => {
    const response = await request("/categories/CAT1", "PUT", { overrun_percentage: 20 }, "view_orders");
    expect(response.status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  it("allocates SEC IDs from the locked counter instead of a submitted ID", async () => {
    executeRows = [[], [{ max_number: "8", suffix_width: 2 }], [{ value: "9" }]];
    const response = await request("/sections", "POST", {
      id: "MANUAL", name: "  Printing  ",
    }, "manage_sections");
    expect(response.status).toBe(201);
    expect(inserted[0]).toEqual({
      table: sections,
      values: { name: "Printing", id: "SEC09" },
    });
  });

  it("allocates customer IDs on the server and saves a valid sales representative", async () => {
    executeRows = [[], [{ max_number: "332", suffix_width: 3 }]];
    txSelectRows.set(users, [{ id: 7 }]);
    const response = await request("/customers", "POST", {
      id: "MANUAL", name: "  Customer  ", name_ar: "  عميل  ", sales_rep_id: 7,
    }, "manage_customers");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "CID333" });
    expect(inserted[0]).toEqual({
      table: customers, values: { name: "Customer", name_ar: "عميل", sales_rep_id: 7, id: "CID333" },
    });
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(txLocks).toContainEqual({ table: users, strength: "share" });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("allows creating customers without a representative but rejects invalid choices", async () => {
    executeRows = [[], [{ max_number: null, suffix_width: null }]];
    const created = await request("/customers", "POST", { name: "Customer", sales_rep_id: null }, "manage_orders");
    expect(created.status).toBe(201);
    expect(inserted[0].values.id).toBe("CID001");
    const rejected = await request("/customers", "POST", { name: "Another", sales_rep_id: 8 }, "manage_customers");
    expect(rejected.status).toBe(400);
    expect(inserted).toHaveLength(1);
  });

  it("exposes the representative lookup to business users, not just user administrators", async () => {
    const representatives = [{ id: 7, display_name: "Representative", display_name_ar: "مندوب" }];
    txSelectRows.set(users, representatives);
    for (const permission of ["manage_customers", "manage_orders", "view_orders", "admin"]) {
      const response = await request("/customers/sales-representatives", "GET", undefined, permission);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(representatives);
    }
    expect(jest.mocked(db.select).mock.calls[0][0]).toEqual({
      id: users.id, display_name: users.display_name, display_name_ar: users.display_name_ar,
    });
    expect((await request("/customers/sales-representatives", "GET", undefined, "manage_users")).status).toBe(403);
    expect((await request("/customers", "POST", { name: "Customer" }, "view_orders")).status).toBe(403);
  });

  it("preserves a legacy representative during unrelated edits but validates changed assignments", async () => {
    txSelectRows.set(customers, [{ id: "CID001", sales_rep_id: 9 }]);
    const changedPhone = await request("/customers/CID001", "PUT", { phone: "0501234567" }, "manage_customers");
    expect(changedPhone.status).toBe(200);
    expect(updated[0]).toEqual({ table: customers, values: { phone: "0501234567" } });
    const invalidRep = await request("/customers/CID001", "PUT", { sales_rep_id: 8 }, "manage_customers");
    expect(invalidRep.status).toBe(400);
    expect(updated).toHaveLength(1);
    const clearedRep = await request("/customers/CID001", "PUT", { sales_rep_id: null }, "manage_customers");
    expect(clearedRep.status).toBe(200);
    expect(updated[1].values).toEqual({ sales_rep_id: null });
  });

  it("keeps customer identifiers immutable and returns 404 for missing customers", async () => {
    expect((await request("/customers/CID001", "PUT", { id: "CID002", name: "Changed" }, "manage_customers")).status).toBe(400);
    expect((await request("/customers/CID001", "PUT", { name: "Changed" }, "manage_customers")).status).toBe(404);
    expect((await request("/customers", "POST", { name: " " }, "manage_customers")).status).toBe(400);
    expect(updated).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it("rejects blank or null usernames and uses the same trimmed password minimum on create and edit", async () => {
    const blank = await request("/users/7", "PUT", { username: "   " }, "manage_users");
    const nulled = await request("/users/7", "PUT", { username: null }, "manage_users");
    const shortCreate = await request("/users", "POST", {
      username: "account", password: "1234567 ",
    }, "manage_users");
    const blankPasswordEdit = await request("/users/7", "PUT", { password: "   " }, "manage_users");
    expect([blank.status, nulled.status, shortCreate.status, blankPasswordEdit.status]).toEqual([400, 400, 400, 400]);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it("requires admin permission to create a system user or change the system-user flag", async () => {
    const create = await request("/users", "POST", {
      username: "system", password: "password8", is_system_user: true,
    }, "manage_users");
    expect(create.status).toBe(403);

    txSelectRows.set(users, [{ id: 9, role_id: null, section_id: null, is_system_user: false }]);
    const update = await request("/users/9", "PUT", { is_system_user: true, role_id: 9 }, "manage_users");
    expect(update.status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  it("omits a blank edit password while saving other user fields", async () => {
    txSelectRows.set(users, [{ id: 9, role_id: null, section_id: null, is_system_user: false }]);
    const response = await request("/users/9", "PUT", {
      password: "   ", display_name: "Updated",
    }, "manage_users");
    expect(response.status).toBe(200);
    expect(updated[0].values).toEqual({ display_name: "Updated" });
  });

  it("allows an admin to set the protected system-user flag", async () => {
    txSelectRows.set(users, [{ id: 9, role_id: null, section_id: null, is_system_user: false }]);
    const response = await request("/users/9", "PUT", { is_system_user: true }, "admin");
    expect(response.status).toBe(200);
    expect(updated[0].values).toEqual({ is_system_user: true });
  });

  it("rejects category ancestry cycles under the tree-write lock", async () => {
    txSelectRows.set(categories, [
      { id: "CAT1", parent_id: null, code: "CAT1" },
      { id: "CAT2", parent_id: "CAT1", code: "CAT2" },
    ]);
    const response = await request("/categories/CAT1", "PUT", { parent_id: "CAT2" });
    expect(response.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("rejects category code edits but preserves an omitted legacy parent relation", async () => {
    txSelectRows.set(categories, [{ id: "CAT1", parent_id: "missing-legacy", code: "legacy-code" }]);
    const changedCode = await request("/categories/CAT1", "PUT", { code: "new-code" });
    expect(changedCode.status).toBe(400);
    expect(updated).toHaveLength(0);

    const unchanged = await request("/categories/CAT1", "PUT", { name: " Updated " });
    expect(unchanged.status).toBe(200);
    expect(updated[0]).toEqual({ table: categories, values: { name: "Updated" } });
  });

  it("rejects nonexistent item categories and machine sections", async () => {
    executeRows = [[], [{ max_number: null, suffix_width: null }]];
    const badItem = await request("/items", "POST", { category_id: "missing", name: "Resin" }, "manage_items");
    expect(badItem.status).toBe(400);
    expect(inserted).toHaveLength(0);

    executeRows = [[], [{ max_number: null }], [{ value: "1" }]];
    const badMachine = await request("/machines", "POST", {
      name: "Line", type: "extruder", section_id: "missing",
    }, "manage_machines");
    expect(badMachine.status).toBe(400);
    expect(inserted).toHaveLength(0);
    expect(txSelectRows.has(sections)).toBe(false);
  });

  it("key-share locks existing category and section references during form writes", async () => {
    txSelectRows.set(categories, [{ id: "CAT01" }]);
    executeRows = [[], [{ max_number: null, suffix_width: null }], [{ value: "1" }]];
    const itemResponse = await request("/items", "POST", {
      category_id: "CAT01", name: "Resin",
    }, "manage_items");
    expect(itemResponse.status).toBe(201);
    expect(txLocks).toContainEqual({ table: categories, strength: "key share" });

    txSelectRows.set(sections, [{ id: "SEC01" }]);
    const userResponse = await request("/users", "POST", {
      username: "employee", password: "password8", section_id: "SEC01",
    }, "manage_users");
    expect(userResponse.status).toBe(201);

    executeRows = [[], [{ max_number: "1" }], [{ value: "2" }]];
    const machineResponse = await request("/machines", "POST", {
      name: "Line", type: "extruder", section_id: "SEC01",
    }, "manage_machines");
    expect(machineResponse.status).toBe(201);
    expect(txLocks).toContainEqual({ table: sections, strength: "key share" });
  });

  it("automatically allocates MAC IDs and canonicalizes a changed legacy type label", async () => {
    executeRows = [[], [{ max_number: "28" }], [{ value: "29" }]];
    const response = await request("/machines", "POST", {
      id: "M001", name: "Extrusion line", type: "printing",
    }, "manage_machines");
    expect(response.status).toBe(201);
    expect(inserted[0].values).toMatchObject({ id: "MAC29", type: "printer" });
  });

  it("blocks invalid machine type transitions but allows explicitly clearing an inline printer", async () => {
    txLimitResponses.set(machines, [[{
      id: "EXT01", type: "extruder", section_id: null, inline_printer_id: "PRN01",
    }]]);
    const blocked = await request("/machines/EXT01", "PUT", { type: "cutter" }, "manage_machines");
    expect(blocked.status).toBe(400);
    expect(updated).toHaveLength(0);

    txLimitResponses.set(machines, [[{
      id: "EXT01", type: "extruder", section_id: null, inline_printer_id: "PRN01",
    }]]);
    const cleared = await request("/machines/EXT01", "PUT", {
      type: "cutter", inline_printer_id: null,
    }, "manage_machines");
    expect(cleared.status).toBe(200);
    expect(updated[0].values).toMatchObject({ type: "cutter", inline_printer_id: null });
  });

  it("blocks changing a referenced printer and preserves unrelated legacy machine associations", async () => {
    txLimitResponses.set(machines, [
      [{ id: "PRN01", type: "printer", section_id: null, inline_printer_id: null }],
      [{ id: "EXT01" }],
    ]);
    const blocked = await request("/machines/PRN01", "PUT", { type: "cutter" }, "manage_machines");
    expect(blocked.status).toBe(400);
    expect(updated).toHaveLength(0);

    txLimitResponses.set(machines, [[{
      id: "EXT02", type: "extruder", section_id: null, inline_printer_id: "LEGACY-NONPRINTER",
    }]]);
    const unrelatedEdit = await request("/machines/EXT02", "PUT", { name: "Updated" }, "manage_machines");
    expect(unrelatedEdit.status).toBe(200);
    expect(updated[0].values).toEqual({ name: "Updated" });
  });

  it("prevents deleting a machine referenced as an inline printer", async () => {
    txLimitResponses.set(machines, [
      [{ id: "PRN01" }],
      [{ id: "EXT01" }],
    ]);
    const response = await request("/machines/PRN01", "DELETE", {}, "admin");
    expect(response.status).toBe(409);
    expect(deleted).toHaveLength(0);
  });

  it("rejects a malformed color and ignores client IDs and color sort order", async () => {
    const invalid = await request("/master-batch-colors", "POST", {
      id: "supplier-code", name: "White", name_ar: "أبيض", color_hex: "white", text_color: "#000",
    }, "manage_master_batch");
    expect(invalid.status).toBe(400);
    expect(inserted).toHaveLength(0);

    executeRows = [[], [{ max_number: null, suffix_width: null }], [{ value: "1" }]];
    const valid = await request("/master-batch-colors", "POST", {
      id: "supplier-code", name: "White", name_ar: "أبيض", color_hex: "#fff", text_color: "#000",
      sort_order: 500,
    }, "manage_master_batch");
    expect(valid.status).toBe(201);
    expect(inserted[0].values).toMatchObject({ id: "MB01", color_hex: "#fff" });
    expect(inserted[0].values).not.toHaveProperty("sort_order");
  });

  it("accepts the preserved transparent legacy color when editing a supplier color", async () => {
    const response = await request("/master-batch-colors/PT-CLEAR", "PUT", {
      color_hex: "transparent",
    }, "manage_master_batch");
    expect(response.status).toBe(200);
    expect(updated[0].values).toEqual({ color_hex: "transparent" });
  });

  it("keeps component IDs database-generated and strips manual sort order", async () => {
    const response = await request("/maintenance-component-catalog", "POST", {
      id: 777, machine_type: "extruder", name_ar: "موتور", name_en: "Motor", sort_order: 99,
    }, "manage_maintenance");
    expect(response.status).toBe(201);
    expect(inserted[0].values).not.toHaveProperty("id");
    expect(inserted[0].values).not.toHaveProperty("sort_order");
  });

  it("rejects attempted ID changes on PUT before touching the database", async () => {
    const response = await request("/machines/MAC01", "PUT", {
      id: "MAC02", name: "Changed",
    }, "manage_machines");
    expect(response.status).toBe(400);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it("prevents deleting sections referenced by users or machines", async () => {
    txSelectRows.set(sections, [{ id: "SEC01" }]);
    txSelectRows.set(users, [{ id: 12 }]);
    const userReference = await request("/sections/SEC01", "DELETE", {}, "admin");
    expect(userReference.status).toBe(409);
    expect(deleted).toHaveLength(0);

    txSelectRows.set(users, []);
    txSelectRows.set(machines, [{ id: "MAC01" }]);
    const machineReference = await request("/sections/SEC01", "DELETE", {}, "admin");
    expect(machineReference.status).toBe(409);
    expect(deleted).toHaveLength(0);
  });

  it("deletes an unreferenced section inside the locked transaction", async () => {
    txSelectRows.set(sections, [{ id: "SEC01" }]);
    txSelectRows.set(users, []);
    txSelectRows.set(machines, []);
    const response = await request("/sections/SEC01", "DELETE", {}, "admin");
    expect(response.status).toBe(200);
    expect(deleted).toEqual([sections]);
  });

  it("rejects item ID overrides on PUT", async () => {
    const response = await request("/items/ITM01", "PUT", { id: "ITM02", name: "Changed" }, "manage_items");
    expect(response.status).toBe(400);
    expect(tx.execute).not.toHaveBeenCalled();
  });
});