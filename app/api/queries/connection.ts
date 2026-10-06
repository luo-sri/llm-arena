import fs from "fs";
import path from "path";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";
import { ensureDbReady } from "@db/init";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof createDb> | null = null;

function resolveDbPath(url: string): string {
  if (!url.startsWith("file:")) return url; // 远程 turso/mysql 协议直接透传
  const p = url.slice("file:".length).replace(/^\/+/, "");
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  const dir = path.dirname(abs);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return `file:${abs}`;
}

function createDb() {
  const url = resolveDbPath(env.databaseUrl);
  const client = createClient({ url });
  return drizzle(client, { schema: fullSchema });
}

export function getDb() {
  if (!instance) {
    instance = createDb();
    void ensureDbReady();
  }
  return instance;
}

/** 等待建表与种子完成（脚本场景使用） */
export async function getReadyDb() {
  const db = getDb();
  await ensureDbReady();
  return db;
}
