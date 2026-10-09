import fs from "fs";
import { type Server } from "http";
import path from "path";

import express, { type Express } from "express";
import { nanoid } from "nanoid";
import { createServer as createViteServer, createLogger } from "vite";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
    watch: {
      ignored: [
        "**/.cache/**",
        "**/.local/**",
        "**/node_modules/**",
        "**/.config/**",
        "**/.git/**",
        "**/.upm/**",
        "**/attached_assets/**",
        "**/dist/**",
        "**/artifacts/**",
      ],
    },
  };

  const vite = await createViteServer({
    configFile: path.resolve(import.meta.dirname, "..", "vite.config.ts"),
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));
  const indexPath = path.resolve(distPath, "index.html");
  let cachedHtml: string;
  try {
    cachedHtml = fs.readFileSync(indexPath, "utf-8");
  } catch (e) {
    log(`Warning: could not pre-read index.html: ${(e as Error).message}`);
    cachedHtml = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>MPBF</title></head><body><p style="font-family:system-ui;padding:2rem">جاري تحميل التطبيق… أعد تحميل الصفحة.</p></body></html>`;
  }

  app.use("*", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(cachedHtml);
  });
}
