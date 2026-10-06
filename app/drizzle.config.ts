import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// 本地默认使用 SQLite 文件（与运行时一致）；如需生成迁移请保持 DATABASE_URL 与运行时相同
const connectionString = process.env.DATABASE_URL || "file:./data/llm-eval.db";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: connectionString,
  },
});
