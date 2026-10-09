import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { categories, customer_products, orders, production_orders, roles, users } from "../shared/schema";
import router from "../server/routes";
import { db } from "../server/db";

jest.mock("../server/db", () => ({
  db: {
    transaction: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/auth", () => ({
  requireAnyPermission: (...required: string[]) => (req: any, res: any, next: any) => {
    const permission = req.headers["x-test-permission"];
    if (!required.includes(permission)) return res.status(403).end();
    req.user = {
      id: 42,
      permissions: String(req.headers["x-test-permissions"] ?? permission).split(","),
    };
    next();
  },
  requirePermission: (...required: string[]) => (req: any, res: any, next: any) => {
    const permissions = String(req.headers["x-test-permissions"] ?? "").split(",");
    if (!required.some((permission) => permissions.includes(permission))) return res.status(403).end();
    req.user = { id: 42, permissions };
    next();
  },
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  resolveUser: jest.fn(),
  hashPassword: jest.fn(),
}));

describe("privilege escalation routes", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  let rolePermissions: string[] = [];
  let productionOrderCurrent: Record<string, any>;
  let transactionInsert: jest.Mock;
  let transactionUpdate: jest.Mock;
  let transactionDelete: jest.Mock;
  let directInsert: jest.Mock;
  let directUpdate: jest.Mock;
  let productCustomerId: string;
  let categoryPercentage: number;

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
    rolePermissions = ["admin"];
    productCustomerId = "C2";
    categoryPercentage = 10;
    productionOrderCurrent = {
      id: 8,
      production_order_number: "PO-8",
      order_id: 7,
      customer_product_id: null,
      quantity_kg: "10.00",
      overrun_percentage: "0.00",
      final_quantity_kg: "10.00",
      status: "pending",
    };
    transactionInsert = jest.fn();
    transactionUpdate = jest.fn();
    transactionDelete = jest.fn();
    directInsert = jest.fn();
    directUpdate = jest.fn();
    const tx: any = {
      execute: async () => ({ rows: [] }),
      select: (fields?: Record<string, unknown>) => {
        let table: unknown;
        let locked = false;
        const productionSnapshot = fields != null && "order_id" in fields && "id" in fields;
        const query: any = {
          from(value: unknown) { table = value; return query; },
          where() { return query; },
          for() { locked = true; return query; },
          limit: async () => {
            if (table === roles) return [{ permissions: rolePermissions }];
            if (table === users) return [{ id: 42, role_id: 9 }];
            if (table === orders) return [{ id: 7, customer_id: "C1" }];
            if (table === customer_products) return [{ id: 13, customer_id: productCustomerId, category_id: "CAT1" }];
            if (table === categories) return [{ overrun_percentage: categoryPercentage }];
            if (table === production_orders) return locked
              ? [productionOrderCurrent]
              : productionSnapshot
                ? [{ id: productionOrderCurrent.id, order_id: productionOrderCurrent.order_id }]
                : [productionOrderCurrent];
            return [];
          },
          then: (resolve: (value: any[]) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(table === production_orders
              ? locked
                ? [productionOrderCurrent]
                : productionSnapshot
                  ? [{ id: productionOrderCurrent.id, order_id: productionOrderCurrent.order_id }]
                  : [productionOrderCurrent]
              : []).then(resolve, reject),
        };
        return query;
      },
      insert: () => ({
        values: (values: unknown) => ({
          returning: async () => {
            transactionInsert(values);
            return [{ id: 8 }];
          },
        }),
      }),
      update: () => ({
        set: (values: unknown) => {
          transactionUpdate(values);
          Object.assign(productionOrderCurrent, values as object);
          return { where: () => ({ returning: async () => [{ ...productionOrderCurrent }] }) };
        },
      }),
      delete: () => ({
        where: () => ({
          returning: async () => {
            transactionDelete();
            return [{ id: 8 }];
          },
        }),
      }),
    };
    jest.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx) as any);
    jest.mocked(db.insert).mockImplementation(() => ({
      values: (values: unknown) => ({
        returning: async () => {
          directInsert(values);
          return [{ id: 8 }];
        },
      }),
    }) as any);
    jest.mocked(db.update).mockImplementation(() => ({
      set: (values: unknown) => {
        directUpdate(values);
        return { where: () => ({ returning: async () => [{ id: 8 }] }) };
      },
    }) as any);
  });

  const request = (path: string, method: string, body: unknown, permission: string, grants = permission) =>
    fetch(`${url}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-test-permission": permission,
        "x-test-permissions": grants,
      },
      body: JSON.stringify(body),
    });

  it("rejects assigning an admin role through user creation and self-update", async () => {
    const create = await request("/users", "POST", {
      username: "target",
      password: "password123",
      role_id: 7,
    }, "manage_users");
    expect(create.status).toBe(403);
    expect(transactionInsert).not.toHaveBeenCalled();

    const update = await request("/users/42", "PUT", { role_id: 7 }, "manage_users");
    expect(update.status).toBe(403);
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it("does not let a user manager reset an existing admin's password without changing role_id", async () => {
    const response = await request("/users/42", "PUT", { password: "new-password-123" }, "manage_users");
    expect(response.status).toBe(403);
    expect(transactionUpdate).not.toHaveBeenCalled();
  });

  it("rejects role create/update grants outside the role manager's own permissions", async () => {
    const create = await request("/roles", "POST", {
      name: "Limited",
      permissions: ["manage_roles", "manage_users"],
    }, "manage_roles");
    expect(create.status).toBe(403);
    expect(directInsert).not.toHaveBeenCalled();

    const update = await request("/roles/3", "PUT", { permissions: ["*"] }, "manage_roles");
    expect(update.status).toBe(403);
    expect(directUpdate).not.toHaveBeenCalled();
  });

  it("does not let a role manager bypass current-role authorization by downgrading an admin role", async () => {
    const response = await request("/roles/9", "PUT", { permissions: [] }, "manage_roles");
    expect(response.status).toBe(403);
    expect(transactionUpdate).not.toHaveBeenCalled();
  });

  it("requires production order identifiers and derives the planned final quantity", async () => {
    const missing = await request("/production-orders", "POST", {
      production_order_number: "PO-9",
      quantity_kg: "10",
    }, "manage_production");
    expect(missing.status).toBe(400);
    expect(transactionInsert).not.toHaveBeenCalled();

    const created = await request("/production-orders", "POST", {
      production_order_number: "PO-9",
      order_id: "7",
      quantity_kg: "10.25",
      overrun_percentage: "50",
    }, "manage_production");
    expect(created.status).toBe(201);
    expect(transactionInsert).toHaveBeenCalledWith(expect.objectContaining({
      order_id: 7,
      quantity_kg: "10.25",
      overrun_percentage: "0",
      final_quantity_kg: "10.25",
    }));
  });

  it.each([0, 5, 10, 20])("uses category rate %s%% rather than client plan values on creation", async (percentage) => {
    productCustomerId = "C1";
    categoryPercentage = percentage;
    const response = await request("/production-orders", "POST", {
      production_order_number: "PO-9", order_id: 7, customer_product_id: 13,
      quantity_kg: "1000", overrun_percentage: "50", final_quantity_kg: "999",
    }, "manage_production");
    expect(response.status).toBe(201);
    expect(transactionInsert).toHaveBeenCalledWith(expect.objectContaining({
      quantity_kg: "1000", overrun_percentage: String(percentage),
      final_quantity_kg: (1000 * (1 + percentage / 100)).toFixed(2),
    }));
  });

  it("updates only requested production quantity and recomputes the final quantity", async () => {
    productionOrderCurrent.overrun_percentage = "5.00";
    const response = await request("/production-orders/8", "PUT", {
      quantity_kg: "120.50",
    }, "manage_production");
    expect(response.status).toBe(200);
    expect(transactionUpdate).toHaveBeenCalledWith({
      quantity_kg: "120.50", final_quantity_kg: "126.53",
    });
  });

  it("rejects production quantities over the 50% overrun limit and mismatched customer products", async () => {
    const overrun = await request("/production-orders", "POST", {
      production_order_number: "PO-10",
      order_id: 7,
      quantity_kg: "10",
      overrun_percentage: "50.01",
    }, "manage_production");
    expect(overrun.status).toBe(400);

    const mismatch = await request("/production-orders", "POST", {
      production_order_number: "PO-11",
      order_id: 7,
      customer_product_id: 13,
      quantity_kg: "10",
    }, "manage_production");
    expect(mismatch.status).toBe(400);
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it("recalculates a changed planned quantity when final_quantity_kg is omitted", async () => {
    const response = await request("/production-orders/8", "PUT", {
      quantity_kg: "12",
      overrun_percentage: "25",
    }, "manage_production");
    expect(response.status).toBe(200);
    expect(transactionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      final_quantity_kg: "15.00",
    }));
  });

  it("blocks deleting started production orders even for admins but allows unused pending orders", async () => {
    productionOrderCurrent.status = "active";
    const started = await request("/production-orders/8", "DELETE", {}, "admin", "admin");
    expect(started.status).toBe(409);
    expect(transactionDelete).not.toHaveBeenCalled();

    productionOrderCurrent.status = "pending";
    const pending = await request("/production-orders/8", "DELETE", {}, "admin", "admin");
    expect(pending.status).toBe(200);
    expect(transactionDelete).toHaveBeenCalledTimes(1);
  });

  it("rejects resetting an active line to pending and then deleting its history", async () => {
    productionOrderCurrent.status = "active";
    const reset = await request("/production-orders/8", "PUT", {
      status: "pending",
      previous_status: null,
      batch_number: null,
    }, "manage_production");
    expect(reset.status).toBe(409);
    expect(transactionUpdate).not.toHaveBeenCalled();

    const deletion = await request("/production-orders/8", "DELETE", {}, "admin", "admin");
    expect(deletion.status).toBe(409);
    expect(transactionDelete).not.toHaveBeenCalled();
  });

  it("retains pending lines with prior started or batched history on update and parent deletion", async () => {
    productionOrderCurrent.status = "pending";
    productionOrderCurrent.previous_status = "active";
    const clearPrevious = await request("/production-orders/8", "PUT", {
      previous_status: null,
    }, "manage_production");
    expect(clearPrevious.status).toBe(409);
    const deleteParentWithHistory = await request("/orders/7", "DELETE", {}, "admin", "admin");
    expect(deleteParentWithHistory.status).toBe(200);
    expect(transactionDelete).toHaveBeenCalledTimes(1);

    productionOrderCurrent.previous_status = null;
    productionOrderCurrent.batch_number = "BATCH-1";
    const clearBatch = await request("/production-orders/8", "PUT", {
      batch_number: null,
    }, "manage_production");
    expect(clearBatch.status).toBe(409);
    const deleteBatchedParent = await request("/orders/7", "DELETE", {}, "admin", "admin");
    expect(deleteBatchedParent.status).toBe(200);
    expect(transactionDelete).toHaveBeenCalledTimes(2);
  });

  it("allows deleting an order whose production lines are truly pending and unbatched", async () => {
    const response = await request("/orders/7", "DELETE", {}, "admin", "admin");
    expect(response.status).toBe(200);
    expect(transactionDelete).toHaveBeenCalledTimes(1);
  });

  it.each(["completed", "cancelled", "archived"])(
    "allows legitimate active-to-%s transitions while preserving the line as non-deletable",
    async (status) => {
      productionOrderCurrent.status = "active";
      const transition = await request("/production-orders/8", "PUT", { status }, "manage_production");
      expect(transition.status).toBe(200);
      const deletion = await request("/production-orders/8", "DELETE", {}, "admin", "admin");
      expect(deletion.status).toBe(409);
    },
  );
});