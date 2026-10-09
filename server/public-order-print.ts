import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";

const validId = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
export function publicOrderPrintKey(id: number, secret = process.env.SESSION_SECRET): string {
  if (!validId(id)) throw new Error("Invalid public print order ID");
  if (!secret) throw new Error("SESSION_SECRET is required for public print links");
  return createHmac("sha256", secret).update(`public-order-print:v1:${id}`).digest("base64url");
}
export function publicOrderPrintPath(id: number, secret?: string): string {
  return `/shared/orders/${id}/print?key=${publicOrderPrintKey(id, secret)}`;
}
export function validPublicOrderPrintKey(id: number, key: unknown, secret?: string): boolean {
  if (!validId(id) || typeof key !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(key)) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(publicOrderPrintKey(id, secret)));
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const pick = (value: unknown, keys: readonly string[]) => record(value)
  ? Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))
  : null;
const personFields = ["display_name", "display_name_ar", "full_name", "username"];

/** Consent covers printed fields, not the complete private order/customer DTO. */
export function publicPrintProjection(source: unknown, path: string) {
  if (!record(source) || !record(source.order) || !Array.isArray(source.production_orders))
    throw new Error("Invalid print source");
  return {
    public_print_path: path,
    order: pick(source.order, ["id", "order_number", "status", "previous_status", "notes", "created_at", "delivery_date", "delivery_days"]),
    customer: pick(source.customer, ["name", "name_ar", "phone", "plate_drawer_code", "code"]),
    creator: pick(source.creator, personFields),
    sales_representative: pick(source.sales_representative, personFields),
    production_orders: source.production_orders.map(value => {
      if (!record(value)) throw new Error("Invalid production print source");
      const product = value.product;
      return {
        ...pick(value, ["id", "quantity_kg", "final_quantity_kg"]),
        product: record(product) ? {
          ...pick(product, ["size_caption", "width", "left_facing", "right_facing", "cutting_length_cm",
            "universal_thickness", "raw_material", "printing_cylinder", "punching", "is_printed",
            "front_print_colors", "back_print_colors", "notes", "cliche_front_design", "cliche_back_design"]),
          item: pick(product.item, ["name", "name_ar"]),
          color: pick(product.color, ["id", "name", "name_ar", "color_hex"]),
        } : null,
      };
    }),
    totals: pick(source.totals, ["planned_kg"]),
    actual_production: { available: false, ...pick(source.actual_production, ["message"]) },
  };
}

export function createPublicOrderPrintRouter(loadOrder: (id: number) => Promise<unknown>, secret?: string) {
  const router = Router();
  router.get("/public/orders/:id/print", async (req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet" });
    try {
      const id = Number(req.params.id);
      if (!/^[1-9]\d{0,9}$/.test(req.params.id) || !validPublicOrderPrintKey(id, req.query.key, secret))
        return res.status(404).json({ message: "الطلب غير موجود", message_en: "Order not found." });
      const details = await loadOrder(id);
      if (!details) return res.status(404).json({ message: "الطلب غير موجود", message_en: "Order not found." });
      return res.json(publicPrintProjection(details, publicOrderPrintPath(id, secret)));
    } catch (error) { next(error); }
  });
  return router;
}
