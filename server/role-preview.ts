import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { roles } from "../shared/schema";
import { db } from "./db";
import { requireAuth, resolvePreviewRole, withRolePreview } from "./auth";

/**
 * This is the only capability authorized by the original account while testing
 * another role. All business routes continue to authorize req.user exclusively.
 */
export function requireRolePreviewAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.originalUser?.permissions.includes("admin")) {
    return res.status(403).json({
      message: "تجربة الأدوار متاحة لمدير النظام فقط",
      message_en: "Only a system administrator can test roles.",
    });
  }
  next();
}

const roleInput = z.object({ role_id: z.number().int().positive().max(2147483647) }).strict();
const save = (req: Request) => new Promise<void>((resolve, reject) =>
  req.session.save(error => error ? reject(error) : resolve()));

const router = Router();
router.use(requireAuth, requireRolePreviewAdmin);
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

router.get("/roles", async (_req, res, next) => {
  try {
    const choices = await db.select({ id: roles.id, name: roles.name, name_ar: roles.name_ar })
      .from(roles).orderBy(roles.name, roles.id);
    res.json({ roles: choices });
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  const parsed = roleInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    message: "اختر دوراً صالحاً دون إرسال صلاحيات إضافية",
    message_en: "Select a valid role without submitting additional permissions.",
  });
  try {
    const role = await resolvePreviewRole(parsed.data.role_id);
    if (!role) return res.status(404).json({ message: "الدور غير موجود", message_en: "Role not found." });
    if (role.id === req.originalUser!.role_id) delete req.session.rolePreviewId;
    else req.session.rolePreviewId = role.id;
    await save(req);
    const user = req.session.rolePreviewId === undefined
      ? withRolePreview(req.originalUser!)
      : withRolePreview(req.originalUser!, role.id, role);
    res.json({ success: true, user });
  } catch (error) { next(error); }
});

router.delete("/", async (req, res, next) => {
  try {
    delete req.session.rolePreviewId;
    await save(req);
    res.json({ success: true, user: withRolePreview(req.originalUser!) });
  } catch (error) { next(error); }
});

export default router;
