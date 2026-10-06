import "dotenv/config";

/** 本地零配置运行：未设置 DATABASE_URL 时使用本地 SQLite 文件 */
export const env = {
  appId: process.env.APP_ID ?? "",
  appSecret: process.env.APP_SECRET ?? "",
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: process.env.DATABASE_URL || "file:./data/llm-eval.db",
};
