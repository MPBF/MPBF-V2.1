import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  categories,
  customer_products,
  customers,
  items,
  master_batch_colors,
  orders,
  production_orders,
} from "../shared/schema";
import router from "../server/routes";
import { db } from "../server/db";

jest.mock("../server/db", () => ({ db: { transaction: jest.fn(), selectDistinct: jest.fn() } }));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/auth", () => ({
  requireAnyPermission: (...permissions: string[]) => (req: any, res: any, next: any) => {
    if (!permissions.includes(req.headers["x-test-permission"])) return res.status(403).end();
    req.user = { id: 42 };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  resolveUser: jest.fn(),
  hashPassword: jest.fn(),
}));

describe("customer product routes", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  let itemCategoryId: string | null = "CAT1";
  let masterBatchActive = true;
  let currentProduct: Record<string, any> | null = null;
  let sourceProduct: Record<string, any> | null = null;
  let savedInsert: Record<string, any> | null = null;
  let savedUpdate: Record<string, any> | null = null;
  let fixtureCategoryName = "Bag";
  let productionOrderReference = false;

  const fixtureCategory = () => ({ id: "CAT1", name: fixtureCategoryName, name_ar: fixtureCategoryName, overrun_percentage: 20 });
  const fixtureItem = () => ({ id: "IT1", category_id: itemCategoryId });

  function transactionForTest() {
    const tx: any = {
      execute: async () => ({ rows: [{ max_number: null }] }),
      select: () => {
        let table: unknown;
        let locked = false;
        let joined = false;
        let condition: any;
        const builder: any = {
          from(value: unknown) { table = value; return builder; },
          where(value: unknown) { condition = value; return builder; },
          innerJoin() { joined = true; return builder; },
          for() { locked = true; return builder; },
          limit: async () => {
            if (table === production_orders && joined) return productionOrderReference ? [{ id: 44 }] : [];
            if (table === customers) return [{ id: "C1" }];
            if (table === categories) return [fixtureCategory()];
            if (table === items) return [fixtureItem()];
            if (table === master_batch_colors) {
              const id = condition?.queryChunks?.find((part: any) => typeof part.value === "string")?.value;
              return id ? [{ id, is_active: masterBatchActive }] : [];
            }
            if (table === customer_products) {
              if (locked) return currentProduct ? [currentProduct] : [];
              const id = condition?.queryChunks?.find((part: any) => typeof part.value === "number")?.value;
              if (id === 18 && savedInsert) return [{ id: 18, ...savedInsert }];
              return sourceProduct && sourceProduct.id === id ? [sourceProduct] : [];
            }
            return [];
          },
        };
        return builder;
      },
      insert: (table: unknown) => ({
        values: (values: Record<string, any>) => ({
          returning: async () => {
            if (table === customer_products) savedInsert = values;
            return [{ id: table === orders ? 9 : table === customer_products ? 18 : 23, ...values }];
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, any>) => {
          savedUpdate = values;
          return {
            where: () => ({
              returning: async () => [{ ...(currentProduct ?? {}), ...values }],
            }),
          };
        },
      }),
    };
    jest.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx) as any);
  }

  const request = (path: string, method: string, body?: unknown, permission = "manage_customers") =>
    fetch(`${url}/api/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-test-permission": permission,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: "16mb" }));
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.name === "ZodError" ? 400 : error.status || 500).json({ message: error.message }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  beforeEach(() => {
    itemCategoryId = "CAT1";
    fixtureCategoryName = "Bag";
    masterBatchActive = true;
    productionOrderReference = false;
    currentProduct = null;
    sourceProduct = null;
    savedInsert = null;
    savedUpdate = null;
    jest.clearAllMocks();
    transactionForTest();
  });

  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  const createInput = () => ({
    customer_id: "C1",
    category_id: "CAT1",
    item_id: "IT1",
    width: "20",
    left_facing: "2",
    right_facing: "3",
    thickness: "20",
    density: "0.95",
    printing_cylinder: "8\"",
    unit_weight_kg: "1.250",
    unit_quantity: 4,
  });

  it("denies form-options access without the existing customer-product read permission", async () => {
    const response = await request("customer-products/form-options", "GET", undefined, "view_production");
    expect(response.status).toBe(403);
  });

  it("returns canonical cylinder options combined with legacy database values", async () => {
    jest.mocked(db.selectDistinct).mockReturnValue({
      from: async () => [{ printing_cylinder: "antique 7 inch" }, { printing_cylinder: "8\"" }, { printing_cylinder: "" }],
    } as any);
    const response = await request("customer-products/form-options", "GET");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.printing_cylinders).toContain("antique 7 inch");
    expect(result.printing_cylinders.filter((value: string) => value === "8\"")).toHaveLength(1);
    expect(result.printing_cylinders).toContain("بدون طباعة");
  });

  it("rejects forged derived fields and fractional dimensions before a write", async () => {
    const forged = await request("customer-products", "POST", { ...createInput(), bag_weight_grams: "1" });
    expect(forged.status).toBe(400);
    const fraction = await request("customer-products", "POST", { ...createInput(), width: "20.5" });
    expect(fraction.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("writes server-derived product measurements and calculated fields", async () => {
    const response = await request("customer-products", "POST", createInput());
    expect(response.status).toBe(201);
    expect(savedInsert).toMatchObject({
      size_caption: "20+2+3X20",
      cutting_length_cm: 20,
      bag_weight_grams: "5",
      bags_per_kilo: "211",
      package_weight_kg: "5.00",
      is_printed: true,
    });
    expect(savedInsert).not.toHaveProperty("universal_thickness");
  });

  it("allows a customer-only product with optional category and item", async () => {
    const response = await request("customer-products", "POST", { customer_id: "C1" });
    expect(response.status).toBe(201);
    expect(savedInsert).toMatchObject({
      customer_id: "C1",
      size_caption: null,
      bag_weight_grams: null,
      is_printed: false,
    });
    expect(savedInsert).not.toHaveProperty("category_id");
    expect(savedInsert).not.toHaveProperty("item_id");
  });

  it.each(["10", "11"])("blocks new products when the facing sum meets or exceeds width %s", async (right) => {
    const response = await request("customer-products", "POST", {
      ...createInput(), width: "20", left_facing: "10", right_facing: right,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("مجموع الجانب الأيمن والجانب الأيسر");
    expect(savedInsert).toBeNull();
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("checks partial updates against the locked, merged product, not the patch alone", async () => {
    currentProduct = { id: 5, ...createInput() };
    const response = await request("customer-products/5", "PUT", { left_facing: "17" });
    expect(response.status).toBe(400);
    expect(savedUpdate).toBeNull();
  });
  it("prevents transferring a product already used by another customer's production order", async () => {
    currentProduct = { id: 5, ...createInput() };
    productionOrderReference = true;
    const response = await request("customer-products/5", "PUT", { customer_id: "C2" });
    expect(response.status).toBe(409);
    expect((await response.json()).message).toContain("لا يمكن نقل المنتج");
    expect(savedUpdate).toBeNull();
  });
  it("blocks unrelated edits on an existing product whose facing sum is already invalid", async () => {
    currentProduct = { id: 5, ...createInput(), width: "5" };
    const response = await request("customer-products/5", "PUT", { notes: "unchanged invalid dimensions" });
    expect(response.status).toBe(400);
    expect(savedUpdate).toBeNull();
  });

  it("normalizes a blank density to the same 0.95 value used by shared calculations", async () => {
    const response = await request("customer-products", "POST", { ...createInput(), density: null });
    expect(response.status).toBe(201);
    expect(savedInsert).toMatchObject({
      density: "0.95",
      bag_weight_grams: "5",
      bags_per_kilo: "211",
    });
  });

  it("rejects an item whose category does not match the selected category", async () => {
    itemCategoryId = "CAT2";
    const response = await request("customer-products", "POST", createInput());
    expect(response.status).toBe(400);
    expect(savedInsert).toBeNull();
  });

  it("rejects a selected category when the referenced item has no category", async () => {
    itemCategoryId = null;
    const response = await request("customer-products", "POST", createInput());
    expect(response.status).toBe(400);
    expect(savedInsert).toBeNull();
  });

  it("validates submitted image MIME and actual file signatures", async () => {
    const response = await request("customer-products", "POST", {
      ...createInput(),
      cliche_front_design: `data:image/png;base64,${Buffer.from("<html>").toString("base64")}`,
    });
    expect(response.status).toBe(400);
    expect(savedInsert).toBeNull();
  });

  it("accepts safe image data URLs with matching magic bytes", async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const response = await request("customer-products", "POST", {
      ...createInput(),
      cliche_front_design: `data:image/png;base64,${pngHeader.toString("base64")}`,
    });
    expect(response.status).toBe(201);
    expect(savedInsert?.cliche_front_design).toContain("data:image/png;base64,");
  });

  it("rejects images larger than five MiB", async () => {
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 1);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    const response = await request("customer-products", "POST", {
      ...createInput(),
      cliche_front_design: `data:image/png;base64,${bytes.toString("base64")}`,
    });
    expect(response.status).toBe(400);
  });

  it("preserves historic cutting and computed values on an unrelated partial update", async () => {
    currentProduct = {
      id: 5,
      customer_id: "C1",
      category_id: "CAT1",
      item_id: "IT1",
      width: null,
      left_facing: "2",
      right_facing: "3",
      thickness: "20",
      density: "0.95",
      printing_cylinder: "8\"",
      cutting_length_cm: 18,
      bag_weight_grams: "historic-weight",
      bags_per_kilo: "historic-count",
      package_weight_kg: "historic-package",
      cliche_front_design: null,
      cliche_back_design: null,
      master_batch_id: null,
      size_caption: "legacy-size",
    };
    const response = await request("customer-products/5", "PUT", { notes: "Updated" });
    expect(response.status).toBe(200);
    expect(savedUpdate).toMatchObject({
      cutting_length_cm: 18,
      size_caption: "legacy-size",
      bag_weight_grams: "historic-weight",
      bags_per_kilo: "historic-count",
      package_weight_kg: "historic-package",
    });
  });

  it("allows an unchanged inactive master-batch color but rejects selecting it anew", async () => {
    masterBatchActive = false;
    currentProduct = {
      id: 5, customer_id: "C1", category_id: "CAT1", item_id: "IT1",
      width: null, left_facing: null, right_facing: null, thickness: null,
      printing_cylinder: "legacy-cylinder", cutting_length_cm: 18,
      density: "0.95", master_batch_id: "MB1", cliche_front_design: null, cliche_back_design: null,
    };
    const unchanged = await request("customer-products/5", "PUT", { notes: "Still using it" });
    expect(unchanged.status).toBe(200);

    currentProduct = { ...currentProduct, master_batch_id: null };
    const newlySelected = await request("customer-products/5", "PUT", { master_batch_id: "MB1" });
    expect(newlySelected.status).toBe(400);
  });

  it("allows clearing category and item and editing legacy rows without either reference", async () => {
    currentProduct = {
      id: 5, customer_id: "C1", category_id: "CAT1", item_id: "IT1",
      width: null, left_facing: null, right_facing: null, thickness: null,
      printing_cylinder: "legacy-cylinder", cutting_length_cm: 18,
      density: null, master_batch_id: null, cliche_front_design: null, cliche_back_design: null,
    };
    const cleared = await request("customer-products/5", "PUT", { category_id: null, item_id: null });
    expect(cleared.status).toBe(200);
    expect(savedUpdate).toMatchObject({ category_id: null, item_id: null });

    currentProduct = {
      ...currentProduct,
      category_id: null,
      item_id: null,
      width: null,
      bag_weight_grams: "legacy",
      bags_per_kilo: "legacy",
      package_weight_kg: "legacy",
    };
    const notesOnly = await request("customer-products/5", "PUT", { notes: "Legacy product" });
    expect(notesOnly.status).toBe(200);
    expect(savedUpdate).toMatchObject({
      notes: "Legacy product",
      bag_weight_grams: "legacy",
      bags_per_kilo: "legacy",
      package_weight_kg: "legacy",
    });
  });

  it("permits cloned products to retain exactly their source image URLs and inactive color without copying source fields", async () => {
    masterBatchActive = false;
    sourceProduct = {
      id: 7,
      master_batch_id: "MB1",
      cliche_front_design: "/assets/front.png",
      cliche_back_design: "https://assets.example/back.jpg",
      bag_weight_grams: "source-weight",
      size_caption: "source-caption",
    };
    const response = await request("customer-products", "POST", {
      ...createInput(),
      clone_source_id: 7,
      master_batch_id: "MB1",
      cliche_front_design: "/assets/front.png",
      cliche_back_design: "https://assets.example/back.jpg",
    });
    expect(response.status).toBe(201);
    expect(savedInsert).toMatchObject({
      cliche_front_design: "/assets/front.png",
      cliche_back_design: "https://assets.example/back.jpg",
      master_batch_id: "MB1",
      bag_weight_grams: "5",
      size_caption: "20+2+3X20",
    });
    expect(savedInsert?.bag_weight_grams).not.toBe("source-weight");
  });

  it("rejects cloned image URLs from the other side, new inactive colors, invalid metadata, and missing sources", async () => {
    masterBatchActive = false;
    sourceProduct = {
      id: 7,
      master_batch_id: "MB1",
      cliche_front_design: "/assets/front.png",
      cliche_back_design: "/assets/back.png",
    };
    const otherSideUrl = await request("customer-products", "POST", {
      ...createInput(),
      clone_source_id: 7,
      cliche_front_design: "/assets/back.png",
    });
    expect(otherSideUrl.status).toBe(400);

    const otherInactiveColor = await request("customer-products", "POST", {
      ...createInput(),
      clone_source_id: 7,
      master_batch_id: "MB2",
    });
    expect(otherInactiveColor.status).toBe(400);

    const invalidMetadata = await request("customer-products", "POST", { ...createInput(), clone_source_id: 0 });
    expect(invalidMetadata.status).toBe(400);
    sourceProduct = null;
    const missingSource = await request("customer-products", "POST", { ...createInput(), clone_source_id: 7 });
    expect(missingSource.status).toBe(400);
    const unauthorized = await request("customer-products", "POST", { ...createInput(), clone_source_id: 7 }, "manage_production");
    expect(unauthorized.status).toBe(403);
  });

  it("recomputes changed source dimensions from the merged current row", async () => {
    currentProduct = {
      id: 5,
      customer_id: "C1",
      category_id: "CAT1",
      item_id: "IT1",
      width: "20",
      left_facing: "2",
      right_facing: "3",
      thickness: "20",
      density: "0.95",
      printing_cylinder: "بدون طباعة",
      cutting_length_cm: 20,
      bag_weight_grams: "old",
      bags_per_kilo: "old",
      unit_weight_kg: "1.250",
      unit_quantity: 4,
      package_weight_kg: "5.00",
      cliche_front_design: null,
      cliche_back_design: null,
      master_batch_id: null,
      size_caption: "legacy-size",
    };
    const response = await request("customer-products/5", "PUT", { width: "30" });
    expect(response.status).toBe(200);
    expect(savedUpdate).toMatchObject({
      width: "30",
      cutting_length_cm: 20,
      size_caption: "30+2+3X20",
      bag_weight_grams: "7",
      bags_per_kilo: "151",
      package_weight_kg: "5.00",
    });
  });

  it("keeps an unselected item category null and derives numeric-cylinder cutting for create and clone", async () => {
    fixtureCategoryName = "Table cover";
    const source = {
      id: 7,
      master_batch_id: null,
      cliche_front_design: null,
      cliche_back_design: null,
      category_id: "CAT1",
      size_caption: "historical source caption",
    };
    sourceProduct = structuredClone(source);

    const unselectedCategoryProduct = {
      ...createInput(),
      category_id: null,
      printing_cylinder: "8\"",
      cutting_length_cm: 18,
    };
    const created = await request("customer-products", "POST", unselectedCategoryProduct);
    expect(created.status).toBe(201);
    expect(savedInsert).toMatchObject({
      category_id: null,
      item_id: "IT1",
      cutting_length_cm: 20,
      size_caption: "20+2+3X20",
      is_printed: true,
    });

    const cloned = await request("customer-products", "POST", {
      ...unselectedCategoryProduct,
      clone_source_id: 7,
    });
    expect(cloned.status).toBe(201);
    expect(savedInsert).toMatchObject({
      category_id: null,
      cutting_length_cm: 20,
      size_caption: "20+2+3X20",
    });
    expect(savedInsert?.size_caption).not.toBe(source.size_caption);
    expect(sourceProduct).toEqual(source);
  });

  const orderProductInput = () => ({
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

  const createOrderWithProduct = (new_product: Record<string, any>) => ({
    customer_id: "C1",
    delivery_days: 5,
    items: [{ quantity_kg: "10.00", new_product }],
  });

  it("creates full order draft products through the same normalized fields as standalone products", async () => {
    const response = await request("orders/with-items", "POST", {
      ...createOrderWithProduct(orderProductInput()),
    }, "manage_orders");
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.production_orders[0]).toMatchObject({
      quantity_kg: "10.00", overrun_percentage: "20", final_quantity_kg: "12.00",
    });
    expect(savedInsert).toMatchObject({
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
    expect(savedInsert).not.toHaveProperty("universal_thickness");
  });

  it("allows asymmetric facings after client confirmation but always blocks a sum at the width", async () => {
    const accepted = await request("orders/with-items", "POST", createOrderWithProduct(orderProductInput()), "manage_orders");
    expect(accepted.status).toBe(201);
    expect(savedInsert).toMatchObject({ left_facing: "2", right_facing: "3" });

    savedInsert = null;
    const blocked = await request("orders/with-items", "POST", createOrderWithProduct({
      ...orderProductInput(), left_facing: "10", right_facing: "10",
    }), "manage_orders");
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).message).toContain("مجموع الجانب الأيمن والجانب الأيسر");
    expect(savedInsert).toBeNull();
  });

  it("keeps category and item optional for order draft products", async () => {
    const response = await request("orders/with-items", "POST", createOrderWithProduct({}), "manage_orders");
    expect(response.status).toBe(201);
    expect(savedInsert).toMatchObject({ customer_id: "C1", is_printed: false });
    expect(savedInsert).not.toHaveProperty("category_id");
    expect(savedInsert).not.toHaveProperty("item_id");
  });

  it("does not infer category from an item for order draft products", async () => {
    fixtureCategoryName = "Table cover";
    const response = await request("orders/with-items", "POST", createOrderWithProduct({
      ...orderProductInput(),
      category_id: null,
      printing_cylinder: "8\"",
      cutting_length_cm: 18,
    }), "manage_orders");
    expect(response.status).toBe(201);
    expect(savedInsert).toMatchObject({
      category_id: null,
      item_id: "IT1",
      cutting_length_cm: 20,
      size_caption: "20+2+3X20",
      is_printed: true,
    });
  });

  it("derives manual-cutting fields from the referenced category", async () => {
    fixtureCategoryName = "Table cover";
    const response = await request("orders/with-items", "POST", createOrderWithProduct({
      ...orderProductInput(),
      printing_cylinder: "بدون طباعة",
      cutting_length_cm: 18,
    }), "manage_orders");
    expect(response.status).toBe(201);
    expect(savedInsert).toMatchObject({
      density: "0.95",
      cutting_length_cm: 18,
      size_caption: "20+2+3X18",
      is_printed: false,
    });
  });

  it.each([
    ["forged customer", { ...orderProductInput(), customer_id: "OTHER" }],
    ["forged computed field", { ...orderProductInput(), size_caption: "forged caption" }],
    ["forged universal thickness", { ...orderProductInput(), universal_thickness: "99" }],
  ])("rejects %s in an order draft product", async (_label, product) => {
    const response = await request("orders/with-items", "POST", createOrderWithProduct(product), "manage_orders");
    expect(response.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects order draft products with invalid references or image signatures", async () => {
    itemCategoryId = "CAT2";
    const wrongReference = await request("orders/with-items", "POST",
      createOrderWithProduct(orderProductInput()), "manage_orders");
    expect(wrongReference.status).toBe(400);
    expect(savedInsert).toBeNull();

    itemCategoryId = "CAT1";
    const badImage = await request("orders/with-items", "POST", createOrderWithProduct({
      ...orderProductInput(),
      cliche_back_design: `data:image/png;base64,${Buffer.from("<html>").toString("base64")}`,
    }), "manage_orders");
    expect(badImage.status).toBe(400);
    expect(savedInsert).toBeNull();
  });
});