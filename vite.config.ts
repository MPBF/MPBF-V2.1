// vite.config.ts
import path, { dirname } from "path";
import { fileURLToPath } from "url";

import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(async () => {
  const plugins = [react(), runtimeErrorOverlay()];

  if (process.env.NODE_ENV !== "production" && process.env.REPL_ID) {
    const { cartographer } = await import("@replit/vite-plugin-cartographer");
    plugins.push(cartographer());
  }

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@shared": path.resolve(__dirname, "shared"),
        "@assets": path.resolve(__dirname, "attached_assets"),
      },
    },
    root: path.resolve(__dirname, "client"),

    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
      hmr: {
        overlay: false, // تعطيل ErrorOverlay
      },
      watch: {
        ignored: [
          '**/.cache/**',
          '**/.local/**',
          '**/node_modules/**',
          '**/.config/**',
          '**/.git/**',
          '**/.upm/**',
          '**/attached_assets/**',
          '**/dist/**',
          '**/artifacts/**',
        ],
      },
    },
    optimizeDeps: {
      exclude: ["@replit/vite-plugin-runtime-error-modal"],
    },
  };
});
