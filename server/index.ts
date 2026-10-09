import http from "node:http";

import connectPgSimple from "connect-pg-simple";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";

import { enforcePasswordChange, populateUser } from "./auth";
import { pool, sessionPool } from "./db";
import api from "./routes";
import { serveStatic, setupVite } from "./vite";

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 5000);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  if (/^\/shared\/orders\/[^/]+\/print\/?$/.test(req.path)) {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet" });
  }
  next();
});
app.use("/api/customer-products", express.json({ limit: "16mb" }));
app.use("/api/orders", express.json({ limit: "16mb" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "10mb" }));

const PgSession = connectPgSimple(session);
const sessionStore = new PgSession({
  pool: sessionPool as any,
  tableName: "sessions",
  createTableIfMissing: false,
  pruneSessionInterval: 60 * 60,
});

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || (isProduction ? (() => { throw new Error("SESSION_SECRET must be set in production"); })() : "development-session-secret"),
    name: "plastic-bag-session",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", populateUser);
app.use("/api", enforcePasswordChange);
app.use("/api", api);
app.use("/api", (_req, res) => res.status(404).json({ message: "المسار غير موجود" }));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("API error:", error instanceof Error ? error.message : error);
  if (res.headersSent) return;
  if ((error as { name?: string })?.name === "ZodError") {
    return res.status(400).json({
      message: "البيانات المدخلة غير صالحة",
      details: (error as { issues?: unknown }).issues,
    });
  }
  const status = Number((error as { status?: number })?.status) || 500;
  const code = (error as { code?: unknown; cause?: { code?: unknown } })?.code
    ?? (error as { cause?: { code?: unknown } })?.cause?.code;
  if (code === "P0011") return res.status(409).json({
    message: "لا يمكن تعديل خطة أو حالة أمر بدأ تنفيذه أو حذف سجلاته؛ استخدم إجراءات الإنتاج",
    message_en: "A started production plan cannot be edited or deleted. Use the production actions.",
  });
  if (status === 413) {
    const limit = /^\/api\/(?:orders|customer-products)(?:\/|\?|$)/.test(_req.originalUrl) ? "16 ميجابايت" : "10 ميجابايت";
    return res.status(413).json({ message: `حجم البيانات أكبر من الحد المسموح به (${limit})` });
  }
  res.status(status).json({
    message: status === 500 ? "حدث خطأ داخلي" : String((error as Error)?.message || error),
    ...(typeof code === "string" && code ? { code } : {}),
  });
});

async function start() {
  const server = http.createServer(app);
  if (!isProduction) await setupVite(app, server);
  else serveStatic(app);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Minimal ERP server listening on 0.0.0.0:${port}`);
  });
}

void start().catch((error) => {
  console.error("Unable to start server:", error);
  void pool.end();
  void sessionPool.end();
  process.exitCode = 1;
});
