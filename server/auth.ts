import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import { eq, or } from "drizzle-orm";

import { db } from "./db";
import { roles, users } from "@shared/schema";
import type { RolePreviewState } from "../shared/role-preview";

export type AuthenticatedUser = {
  id: number;
  username: string | null;
  display_name: string | null;
  display_name_ar: string | null;
  role_id: number | null;
  role_name: string | null;
  role_name_ar: string | null;
  section_id: string | null;
  preferred_language: "ar" | "en" | null;
  permissions: string[];
  must_change_password: boolean;
  role_preview?: RolePreviewState;
};

declare module "express-session" {
  interface SessionData {
    userId?: number;
    rolePreviewId?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      originalUser?: AuthenticatedUser;
    }
  }
}

export type PreviewRole = {
  id: number;
  name: string;
  name_ar: string | null;
  permissions: string[] | null;
};

export async function resolvePreviewRole(id: number): Promise<PreviewRole | null> {
  return (await db.select().from(roles).where(eq(roles.id, id)).limit(1))[0] ?? null;
}

/** Keep identity/account restrictions; replace only the effective role grants. */
export function withRolePreview(user: AuthenticatedUser, roleId?: number, role?: PreviewRole | null): AuthenticatedUser {
  if (!user.permissions.includes("admin")) return user;
  const active = roleId !== undefined;
  return {
    ...user,
    ...(active ? {
      role_id: roleId,
      role_name: role?.name ?? null,
      role_name_ar: role?.name_ar ?? null,
      // A deleted preview role must never silently restore administrative access.
      permissions: Array.isArray(role?.permissions) ? role.permissions.filter(p => typeof p === "string") : [],
    } : {}),
    role_preview: {
      active,
      role_available: !active || !!role,
      original_role: { id: user.role_id, name: user.role_name, name_ar: user.role_name_ar },
    },
  };
}

export async function resolveUser(userId: number): Promise<AuthenticatedUser | null> {
  const rows = await db
    .select({ user: users, role: roles })
    .from(users)
    .leftJoin(roles, eq(users.role_id, roles.id))
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.status !== "active") return null;
  return withRolePreview({
    id: row.user.id,
    username: row.user.username,
    display_name: row.user.display_name,
    display_name_ar: row.user.display_name_ar,
    role_id: row.user.role_id,
    role_name: row.role?.name ?? null,
    role_name_ar: row.role?.name_ar ?? null,
    section_id: row.user.section_id,
    preferred_language: row.user.preferred_language === "ar" || row.user.preferred_language === "en"
      ? row.user.preferred_language
      : null,
    permissions: Array.isArray(row.role?.permissions) ? row.role.permissions : [],
    must_change_password: Boolean(row.user.must_change_password),
  });
}

export async function populateUser(req: Request, _res: Response, next: NextFunction) {
  if (req.session.userId) {
    try {
      const user = await resolveUser(req.session.userId);
      if (user) {
        req.originalUser = user;
        const roleId = req.session.rolePreviewId;
        if (user.permissions.includes("admin") && roleId !== undefined) {
          req.user = withRolePreview(user, roleId, await resolvePreviewRole(roleId));
        } else {
          delete req.session.rolePreviewId;
          req.user = user;
        }
      }
    } catch (error) {
      return next(error);
    }
  }
  next();
}

// Only the existing session/password screen endpoints are available until the
// database-backed user flag is cleared. Permissions (including admin) cannot
// bypass this restriction.
const passwordChangeEndpoints = new Set([
  "GET /me",
  "HEAD /me",
  "GET /public-branding",
  "HEAD /public-branding",
  "PUT /me/language",
  "POST /login",
  "POST /logout",
  "POST /change-password",
]);

export function enforcePasswordChange(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.must_change_password) return next();
  const path = req.path.replace(/\/+$/, "") || "/";
  if (passwordChangeEndpoints.has(`${req.method} ${path}`)) return next();
  return res.status(403).json({
    code: "PASSWORD_CHANGE_REQUIRED",
    message: "يجب تحديث كلمة المرور قبل متابعة العمل.",
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ message: "تسجيل الدخول مطلوب" });
  next();
}

export function requirePermission(...required: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: "تسجيل الدخول مطلوب" });
    const permissions = ((req.user as unknown as AuthenticatedUser).permissions ?? []);
    // Wildcards cover ordinary permissions, never the explicit admin grant.
    if (required.some((item) => permissions.includes(item) ||
      (item !== "admin" && permissions.includes("*")))) {
      return next();
    }
    return res.status(403).json({ message: "لا تملك صلاحية تنفيذ هذا الإجراء" });
  };
}

export const requireAnyPermission = (...permissions: string[]) =>
  requirePermission(...permissions);

export async function authenticate(identifier: string, password: string) {
  const result = await db
    .select({ user: users, role: roles })
    .from(users)
    .leftJoin(roles, eq(users.role_id, roles.id))
    .where(or(eq(users.username, identifier), eq(users.national_id, identifier)))
    .limit(1);
  const row = result[0];
  if (!row?.user.password || row.user.status !== "active") return null;
  if (!(await bcrypt.compare(password, row.user.password))) return null;
  return resolveUser(row.user.id);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}