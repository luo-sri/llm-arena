import type { Hono } from "hono";
import fs from "fs";
import path from "path";

/* eslint-disable @typescript-eslint/no-explicit-any */
type App = Hono<any>;

/** 绝对路径解析前端产物目录：生产 boot.js 位于 dist/，同级 dist/public 即前端构建结果 */
const DIST_ROOT = path.resolve(import.meta.dirname, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/** 极简静态文件服务：绝对路径直读，不依赖进程 cwd（Electron 打包后 cwd 不可控） */
export function serveStaticFiles(app: App) {
  app.get("*", (c) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname);
    let filePath = path.normalize(path.join(DIST_ROOT, rel));
    if (!filePath.startsWith(DIST_ROOT)) return c.json({ error: "Not Found" }, 404);
    if (rel === "/" || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_ROOT, "index.html");
    }
    if (!fs.existsSync(filePath)) return c.text("Frontend build not found", 500);
    const body = fs.readFileSync(filePath);
    c.header("Content-Type", MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream");
    if (filePath.endsWith("index.html")) {
      c.header("Cache-Control", "no-store");
      return c.html(body.toString("utf-8"));
    }
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(new Uint8Array(body));
  });
}
