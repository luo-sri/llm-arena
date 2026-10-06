/**
 * 数据库种子脚本：npm run seed
 * 零配置本地 SQLite：自动建表 + 内置题库 + 默认套件 + 测试模型（幂等）。
 */
import { initAndReport } from "./init";

initAndReport()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
