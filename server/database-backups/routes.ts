import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import { requirePermission } from "../auth";
import { pool } from "../db";
import { DatabaseBackupService } from "./service";
import { MAX_ARCHIVE_BYTES } from "./crypto";

export function createDatabaseBackupRouter(service = new DatabaseBackupService(pool)) {
  const router = Router();
  router.use(requirePermission("admin"));
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const origin = req.get("origin");
    if (req.get("sec-fetch-site") === "cross-site") return res.status(403).json({ code: "BACKUP_FORBIDDEN" });
    if (origin) {
      try { if (new URL(origin).host !== req.get("host")) return res.status(403).json({ code: "BACKUP_FORBIDDEN" }); }
      catch { return res.status(403).json({ code: "BACKUP_FORBIDDEN" }); }
    }
    next();
  });
  const passphrase = z.string().min(12).max(256).refine(v => /\S/.test(v));
  const id = z.string().uuid();
  const wrap = (handler: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, _next: NextFunction) => {
      void handler(req, res).catch(error => {
        const known = error instanceof Error && /^BACKUP_[A-Z_]+$/.test(error.message);
        const code = error instanceof z.ZodError ? "BACKUP_INVALID" : known ? error.message : "BACKUP_FAILED";
        const status = error instanceof z.ZodError ? 400 : known ? Number((error as Error & { status?: number }).status) || 400 : 500;
        res.status(status).json({ code, message: code });
      });
    };
  const filename = (purpose: string) => `MPBF-${purpose}-${new Date().toISOString().replace(/[:.]/g, "-")}.mpbfbak`;
  router.post("/create", wrap(async (req, res) => {
    const input = z.object({ passphrase }).strict().parse(req.body);
    const archive = await service.create(req.user!.id, input.passphrase);
    res.type("application/octet-stream").attachment(filename("database-backup")).send(archive);
  }));
  const upload = multer({
    storage: multer.memoryStorage(),
    // Busboy emits partsLimit upon reaching the count, even on the final part.
    limits: { fileSize: MAX_ARCHIVE_BYTES, files: 1, fields: 1, fieldSize: 1024, parts: 3 },
  }).single("file");
  router.post("/preview", (req, res, next) => upload(req, res, error => {
    if (error) return res.status(400).json({ code: "BACKUP_INVALID", message: "BACKUP_INVALID" });
    next();
  }), wrap(async (req, res) => {
    const input = z.object({ passphrase }).strict().parse(req.body);
    if (!req.file) return res.status(400).json({ code: "BACKUP_INVALID" });
    res.json(await service.preview(req.user!.id, req.file.buffer, input.passphrase));
  }));
  router.post("/safety", wrap(async (req, res) => {
    const input = z.object({ id, passphrase }).strict().parse(req.body);
    const result = await service.safety(req.user!.id, input.id, input.passphrase);
    res.setHeader("X-Backup-Safety-Checksum", result.checksum);
    res.type("application/octet-stream").attachment(filename("pre-restore")).send(result.archive);
  }));
  router.post("/apply", wrap(async (req, res) => {
    const input = z.object({
      id, passphrase, safetyChecksum: z.string().regex(/^[a-f0-9]{64}$/),
      confirmRestore: z.literal(true), confirmSafetySaved: z.literal(true),
    }).strict().parse(req.body);
    const result = await service.apply(req.user!.id, input);
    if (req.session) await new Promise<void>(resolve => req.session.destroy(() => resolve()));
    res.json(result);
  }));
  return router;
}
export default createDatabaseBackupRouter();
