import { Router, type RequestHandler } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { kgHundredths } from "../../shared/production";
import { ProductionError, type ConnectionPool } from "./core";
import { ProductionExecutionService } from "./execution";
import { ProductionWarehouseService } from "./warehouse";
import { ProductionReadService } from "./read";

const request = z.object({ request_id: z.string().uuid() }).strict();
const id = z.coerce.number().int().positive().max(2147483647);
const weightPattern = /^\d{1,12}(?:\.\d{1,2})?$/;
const weight = z.string().regex(weightPattern).refine(v => weightPattern.test(v) && kgHundredths(v) > 0n);
const machine = z.string().trim().min(1).max(20);
const safeText = (max: number) => z.string().trim().max(max).refine(s => !s.includes("\u0000"));
const labelSelection = z.object({
  roll_ids: z.array(z.number().int().positive().max(2147483647)).min(1).max(100)
    .refine(ids => new Set(ids).size === ids.length),
}).strict();
async function rollQR(req: Parameters<RequestHandler>[0], rollId: number) {
  // Identity only: this URL never grants access. Auth and roll permissions remain
  // enforced by the existing detail route, including after a label is scanned.
  const url = `${req.protocol}://${req.get("host")}/production/rolls/${rollId}`;
  const image = await QRCode.toDataURL(url, {
    width: 600, margin: 4, errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  return { url, image };
}
const handler = (callback: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await callback(req, res, next); } catch (error) {
    if (error instanceof ProductionError) return void res.status(error.status).json({ message: error.message, message_en: error.message_en });
    if (error instanceof z.ZodError) return void res.status(400).json({ message: "تحقق من الحقول؛ الكميات موجبة بمنزلتين عشريتين فقط", message_en: "Check the fields. Weights must be positive with at most two decimal places." });
    const code = (error as { code?: string }).code;
    if (["23505", "23503", "P0011", "55P03", "40P01", "57014"].includes(code ?? ""))
      return void res.status(409).json({ message: "تعارض في البيانات أو انشغال السجل؛ أعد تحميل البيانات أو أعد محاولة العملية نفسها", message_en: "Conflicting data or a busy record. Reload or retry the same operation." });
    next(error);
  }
};
export function createProductionRouter(connectionPool: ConnectionPool = pool) {
const router = Router();
router.use(requireAuth);
const execution = new ProductionExecutionService(connectionPool);
const warehouse = new ProductionWarehouseService(connectionPool);
const read = new ProductionReadService(connectionPool);
router.get("/state", handler(async (req, res) => {
  const scope = z.enum(["management", "film", "printing", "cutting", "hall", "warehouse", "roll"]).default("management").parse(req.query.scope);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await read.state(req.user!, scope));
}));
const historyFilters = z.object({
  before: id.optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
  search: safeText(120).optional(), status: z.enum(["pending","active","in_production","completed","cancelled","archived","film","printing","done"]).optional(),
  from: z.string().date().optional(), to: z.string().date().optional(),
  order_id: id.optional(), location_id: id.optional(),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to);
router.get("/history/:kind", handler(async (req, res) => {
  const kind = z.enum(["orders", "rolls", "receipts", "movements", "inventory"]).parse(req.params.kind);
  const filters = historyFilters.parse(req.query);
  if (filters.status && !["orders", "rolls"].includes(kind)) throw new z.ZodError([]);
  if (filters.status && !(kind === "rolls" ? ["film","printing","done"] : ["pending","active","in_production","completed","cancelled","archived"]).includes(filters.status)) throw new z.ZodError([]);
  if (filters.location_id && ["orders", "rolls"].includes(kind)) throw new z.ZodError([]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await read.history(req.user!, kind, filters));
}));
router.get("/rolls/:id", handler(async (req, res) => { res.json(await read.roll(req.user!, id.parse(req.params.id))); }));
router.get("/rolls/:id/qr", handler(async (req, res) => {
  const roll = await read.roll(req.user!, id.parse(req.params.id));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await rollQR(req, roll.id));
}));
router.get("/labels", handler(async (req, res) => {
  const filters = z.object({
    before: id.optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
    search: safeText(120).optional(),
  }).strict().parse(req.query);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await read.labelPage(req.user!, filters));
}));
router.post("/labels", handler(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const { roll_ids } = labelSelection.parse(req.body);
  const rolls = await read.labelRolls(req.user!, roll_ids);
  const labels = await Promise.all(rolls.map(async roll => ({ roll, qr: await rollQR(req, roll.id) })));
  res.json({ labels });
}));
router.post("/orders/:id/start", handler(async (req, res) => { res.json(await execution.start(req.user!, id.parse(req.params.id), request.parse(req.body))); }));
router.post("/orders/:id/rolls", handler(async (req, res) => {
  const input = request.extend({ machine_id: machine, weight_kg: weight,
    is_last_roll: z.boolean().default(false), inline_printed: z.boolean().default(false) }).strict().parse(req.body);
  res.json(await execution.film(req.user!, id.parse(req.params.id), input));
}));
router.post("/orders/:id/close-film", handler(async (req, res) => { res.json(await execution.closeFilm(req.user!, id.parse(req.params.id), request.parse(req.body))); }));
router.post("/rolls/:id/print", handler(async (req, res) => { res.json(await execution.print(req.user!, id.parse(req.params.id), request.extend({ machine_id: machine }).parse(req.body))); }));
router.post("/rolls/:id/cut", handler(async (req, res) => { res.json(await execution.cut(req.user!, id.parse(req.params.id), request.extend({ machine_id: machine, net_weight_kg: weight }).parse(req.body))); }));
router.post("/queues", handler(async (req, res) => {
  res.json(await execution.queue(req.user!, request.extend({
    production_order_id: id, stage: z.enum(["film", "printing", "cutting"]), machine_id: machine, position: z.number().int().positive().max(1000000),
  }).parse(req.body)));
}));
router.post("/queues/:id/remove", handler(async (req, res) => { res.json(await execution.removeQueue(req.user!, id.parse(req.params.id), request.parse(req.body))); }));
router.post("/queues/reorder", handler(async (req, res) => { res.json(await execution.reorderQueue(req.user!, request.extend({
  first_id: id, second_id: id, first_position: z.number().int().positive(), second_position: z.number().int().positive(),
}).parse(req.body))); }));
router.post("/receipts", handler(async (req, res) => {
  const packaging = z.object({ roll_weight_grams: z.string().regex(/^\d{1,8}(?:\.\d{1,4})?$/), rolls_per_unit: z.number().int().min(1).max(1000000), units: z.number().int().min(1).max(1000000) }).strict();
  const input = request.extend({ notes: safeText(2000).optional(), items: z.array(z.object({
    production_order_id: id, location_id: id, quantity_kg: weight, packaging: packaging.optional(),
  }).strict()).min(1).max(100) }).parse(req.body);
  res.json(await warehouse.receive(req.user!, input));
}));
const locationName = safeText(100).refine(value => value.length > 0);
const location = request.extend({ name: locationName, name_ar: locationName, is_active: z.boolean().optional() });
router.post("/locations", handler(async (req, res) => { res.json(await warehouse.location(req.user!, location.parse(req.body))); }));
router.post("/locations/:id", handler(async (req, res) => { res.json(await warehouse.location(req.user!, location.parse(req.body), id.parse(req.params.id))); }));
return router;
}
export default createProductionRouter();
