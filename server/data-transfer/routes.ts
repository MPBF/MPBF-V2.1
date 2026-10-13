import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import { requirePermission } from "../auth";
import { pool } from "../db";
import { DataTransferService } from "./service";
import { MAX_BYTES } from "./policy";

export function createDataTransferRouter(service = new DataTransferService(pool)) {
const router = Router();
router.use(requirePermission("admin"));
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const uuid = z.string().uuid();
const version = z.string().regex(/^[a-f0-9]{64}$/);
const asyncRoute = (kind: string, handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    void handler(req, res).catch(async error => {
      try { await service.rejection(req.user!.id, kind); } catch { /* Explicit 503 below if storage is unavailable. */ }
      const status = error instanceof z.ZodError ? 400 : Number(error.status) || 500;
      // Database errors may contain business values; never expose SQL details.
      const safe = error instanceof z.ZodError ? "Invalid transfer request" :
        error.status ? error.message : "Transfer failed; no partial changes were saved";
      res.status(status).json({ message: safe, code: `TRANSFER_${status}` });
    });
  };
router.get("/schema", asyncRoute("schema", async (_req, res) => res.json(await service.schema())));
router.get("/operations", asyncRoute("operations", async (req, res) => res.json(await service.operations(req.user!.id))));
router.get("/operations/:id", asyncRoute("report", async (req, res) => {
  const id = uuid.parse(req.params.id);
  res.attachment(`MPBF-report-${id}.json`).json(await service.report(req.user!.id, id));
}));
router.get("/backups/:id", asyncRoute("backup-download", async (req, res) => {
  const id = uuid.parse(req.params.id);
  res.attachment(`MPBF-backup-${id}.json`).json(await service.backup(req.user!.id, id));
}));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 0 } }).single("file");
router.post("/read-file", (req, res, next) => upload(req, res, error => {
  if (error) {
    void service.rejection(req.user!.id, "file").catch(() => {});
    res.status(400).json({ message: "Unsafe upload or file size limit exceeded", code: "TRANSFER_400" });
  } else next();
}), asyncRoute("file", async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "File required" });
  res.json(await service.readFile(req.user!.id, req.file.buffer, req.file.originalname));
}));
router.post("/export", asyncRoute("export", async (req, res) => {
  const input = z.object({ tables: z.array(z.string().max(100)).min(1).max(10),
    format: z.enum(["csv", "xlsx", "json"]), version }).strict().parse(req.body);
  const result = await service.export(req.user!.id, input.tables, input.format, input.version);
  res.type(result.type).attachment(result.filename).send(result.body);
}));
const mapping = z.object({
  table: z.string().max(100), fileTable: z.string().max(100),
  columns: z.record(z.string().max(200), z.string().max(100)),
  matchKey: z.array(z.string().max(100)).min(1).max(10),
  nullColumns: z.array(z.string().max(100)).max(150),
}).strict();
router.post("/preview", asyncRoute("preview", async (req, res) => {
  const input = z.object({ version, file: z.object({
    receipt: uuid, source: z.enum(["external", "same-database"]), schemaVersion: z.string().optional(),
    tables: z.array(z.object({ name: z.string().max(100), headers: z.array(z.string().max(200)).max(150),
      rows: z.array(z.record(z.string().max(200), z.string().max(10000).nullable())).max(2000) }).strict()).max(10),
  }).strict(), mappings: z.array(mapping).min(1).max(10) }).strict().parse(req.body);
  res.json(await service.preview(req.user!.id, input.version, input.file, input.mappings));
}));
router.post("/apply", asyncRoute("apply", async (req, res) => {
  const input = z.object({ previewId: uuid, confirmNew: z.boolean(),
    approvals: z.array(z.object({ index: z.number().int().min(0).max(1999),
      columns: z.array(z.string().max(100)).max(150) }).strict()).max(2000) }).strict().parse(req.body);
  res.json(await service.apply(req.user!.id, input.previewId, input.approvals, input.confirmNew));
}));
router.post("/restore-preview", asyncRoute("restore-preview", async (req, res) => {
  const input = z.object({ operationId: uuid }).strict().parse(req.body);
  res.json(await service.restorePreview(req.user!.id, input.operationId));
}));
router.get("/templates", asyncRoute("templates", async (req, res) => res.json(await service.templates(req.user!.id))));
router.post("/templates", asyncRoute("templates", async (req, res) => {
  const input = z.object({ name: z.string().min(1).max(100), version, mappings: z.array(mapping).min(1).max(10) }).strict().parse(req.body);
  res.json(await service.saveTemplate(req.user!.id, input.name, input.version, input.mappings));
}));
return router;
}
export default createDataTransferRouter();
