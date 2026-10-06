/**
 * 数据库初始化（零配置）：首次访问时自动建表 + 写入内置题库、默认套件与测试模型。
 * 使用 CREATE TABLE IF NOT EXISTS，可安全重复执行。
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { questions, evalSuites, models, modelGroups, appMeta } from "./schema";
import { BUILTIN_BANK, BANK_VERSION } from "../api/engine/bank";
import { buildPresetSuites, PRESET_SUITES_VERSION, LEGACY_PRESET_NAMES } from "./presets";
import { MOCK_MODEL_PRESETS } from "../api/engine/mockPresets";

const DDL = [
  `CREATE TABLE IF NOT EXISTS model_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#f5b83d',
    description TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'openai',
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL,
    input_price REAL NOT NULL DEFAULT 0,
    output_price REAL NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    last_test_status TEXT,
    last_test_latency_ms INTEGER,
    last_test_error TEXT,
    last_tested_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS models_group_idx ON models (group_id)`,
  `CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_version TEXT NOT NULL,
    category TEXT NOT NULL,
    difficulty INTEGER NOT NULL DEFAULT 1,
    prompt TEXT NOT NULL,
    expected_answer TEXT,
    scoring_type TEXT NOT NULL,
    scoring_config TEXT,
    rubric TEXT,
    weight REAL NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'builtin',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS questions_cat_idx ON questions (category)`,
  `CREATE INDEX IF NOT EXISTS questions_ver_idx ON questions (bank_version)`,
  `CREATE TABLE IF NOT EXISTS eval_suites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    suite_id INTEGER,
    suite_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    seed INTEGER NOT NULL DEFAULT 42,
    param_snapshot TEXT NOT NULL,
    bank_version TEXT NOT NULL,
    bank_hash TEXT NOT NULL,
    total_items INTEGER NOT NULL DEFAULT 0,
    done_items INTEGER NOT NULL DEFAULT 0,
    failed_items INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at INTEGER,
    finished_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS runs_status_idx ON runs (status)`,
  `CREATE TABLE IF NOT EXISTS run_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    model_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    repeat_index INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    prompt_sent TEXT,
    response_text TEXT,
    latency_ms INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    rule_score REAL,
    judge_score REAL,
    judge_reason TEXT,
    final_score REAL,
    score_detail TEXT,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_score REAL,
    review_note TEXT,
    reviewed_at INTEGER,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS items_run_idx ON run_items (run_id)`,
  `CREATE INDEX IF NOT EXISTS items_run_model_idx ON run_items (run_id, model_id)`,
  `CREATE INDEX IF NOT EXISTS items_review_idx ON run_items (needs_review)`,
  `CREATE TABLE IF NOT EXISTS run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS logs_run_idx ON run_logs (run_id)`,
  `CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    share_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    repeat_index INTEGER NOT NULL DEFAULT 0,
    model_a_id INTEGER NOT NULL,
    model_b_id INTEGER NOT NULL,
    winner TEXT NOT NULL,
    method TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS battles_run_idx ON battles (run_id)`,
  `CREATE INDEX IF NOT EXISTS battles_a_idx ON battles (model_a_id)`,
  `CREATE INDEX IF NOT EXISTS battles_b_idx ON battles (model_b_id)`,
  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  // 幂等/并发安全唯一索引：mock 测试模型、分组名、内置题干
  `CREATE UNIQUE INDEX IF NOT EXISTS models_mock_uniq ON models (provider, model_id) WHERE provider='mock'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS model_groups_name_uniq ON model_groups (name)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS questions_builtin_uniq ON questions (prompt, bank_version) WHERE source='builtin'`,
];

let readyPromise: Promise<void> | null = null;

export function ensureDbReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = initialize().catch((e) => {
      readyPromise = null;
      throw e;
    });
  }
  return readyPromise;
}

async function initialize() {
  const db = getDb();
  // 并发健壮性：WAL 允许读写并行，busy_timeout 让写锁冲突时排队等待而非立刻抛 SQLITE_BUSY。
  // 本地文件库下，应用与自检脚本等进程可能同时访问同一库文件。
  try {
    await db.run(sql.raw("PRAGMA journal_mode = WAL"));
    await db.run(sql.raw("PRAGMA busy_timeout = 8000"));
  } catch {
    // 远程协议（turso/mysql）不支持这些 PRAGMA，忽略即可
  }
  for (const stmt of DDL) {
    await db.run(sql.raw(stmt));
  }
  await runColumnMigrations();
  await seedBuiltinBank();
  await ensureMockModels();
  await seedDefaultSuites();
}

/**
 * 幂等列迁移：SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS，
 * 重复执行时报 "duplicate column name"，忽略该错误即可保证多次启动安全。
 */
async function addColumnIfMissing(ddl: string) {
  try {
    await getDb().run(sql.raw(ddl));
  } catch (e) {
    // drizzle 会把原始错误包在 cause 里，需同时检查两层消息
    const err = e as { message?: string; cause?: { message?: string } };
    const msg = `${err?.message ?? ""} ${err?.cause?.message ?? ""}`;
    if (!/duplicate column name/i.test(msg)) throw e;
  }
}

async function runColumnMigrations() {
  // 旧库升级：runs 增加套件名快照列
  await addColumnIfMissing(`ALTER TABLE runs ADD COLUMN suite_name TEXT`);
}

/** 内置公开题库：跨版本按题干去重幂等写入，题库升级时自动补入新增题并同步已有题的公开内容 */
async function seedBuiltinBank() {
  const db = getDb();
  const existing = await db.select().from(questions).where(eq(questions.source, "builtin"));
  const byPrompt = new Map(existing.map((r) => [r.prompt, r]));

  const fieldsOf = (q: (typeof BUILTIN_BANK)[number]) => ({
    bankVersion: BANK_VERSION,
    category: q.category,
    difficulty: q.difficulty,
    prompt: q.prompt,
    expectedAnswer: q.expectedAnswer,
    scoringType: q.scoringType,
    scoringConfig: q.scoringConfig,
    rubric: q.rubric,
    weight: q.weight,
    source: "builtin",
  });

  const toInsert = BUILTIN_BANK.filter((q) => !byPrompt.has(q.prompt));
  if (toInsert.length > 0) {
    await db.insert(questions).values(toInsert.map(fieldsOf)).onConflictDoNothing();
  }

  // 同步已有内置题的公开内容（题干不变，评分标准/权重可能随版本升级）。
  // 仅在内容确有变化时写入：避免每次冷启动产生上百条空更新，既拖慢启动，
  // 也会与其他进程（如并行运行的自检脚本）争抢 SQLite 写锁而报 SQLITE_BUSY。
  for (const q of BUILTIN_BANK) {
    const cur = byPrompt.get(q.prompt);
    if (!cur) continue;
    const next = fieldsOf(q);
    const changed =
      cur.bankVersion !== next.bankVersion ||
      cur.category !== next.category ||
      cur.difficulty !== next.difficulty ||
      cur.expectedAnswer !== next.expectedAnswer ||
      cur.scoringType !== next.scoringType ||
      cur.scoringConfig !== next.scoringConfig ||
      cur.rubric !== next.rubric ||
      cur.weight !== next.weight;
    if (!changed) continue;
    const { prompt: _prompt, ...rest } = next;
    await db.update(questions).set(rest).where(eq(questions.id, cur.id));
  }
}

/** 内置测试模型（模拟，无需密钥，不消耗任何额度）。幂等且并发安全，可重复调用 */
export async function ensureMockModels(): Promise<{ created: number }> {
  const db = getDb();
  let group = await db.query.modelGroups.findFirst({
    where: eq(modelGroups.name, "内置测试模型"),
  });
  if (!group) {
    const inserted = await db
      .insert(modelGroups)
      .values({ name: "内置测试模型", color: "#8d99ae", description: "离线模拟模型，用于流程测试与演示，不消耗任何 API 额度" })
      .onConflictDoNothing()
      .returning();
    group = inserted[0] ?? (await db.query.modelGroups.findFirst({ where: eq(modelGroups.name, "内置测试模型") }))!;
  }
  let created = 0;
  for (const p of MOCK_MODEL_PRESETS) {
    const ins = await db
      .insert(models)
      .values({
        name: p.name,
        provider: "mock",
        baseUrl: "builtin://mock",
        apiKey: "",
        modelId: p.modelId,
        groupId: group.id,
        notes: p.notes,
      })
      .onConflictDoNothing()
      .returning({ id: models.id });
    created += ins.length;
  }
  return { created };
}

/** 默认套件：按名称幂等同步内置专业预设。版本变更时自动升级已有预设，用户自建套件不受影响 */
async function seedDefaultSuites() {
  const db = getDb();
  const [meta] = await db.select().from(appMeta).where(eq(appMeta.key, "preset_suites_version"));
  if (meta?.value === PRESET_SUITES_VERSION) return;

  const flagship = await db.query.models.findFirst({ where: eq(models.modelId, "mock-flagship") });
  const presets = buildPresetSuites(flagship?.id ?? null);

  // 清理已重命名的旧版内置预设（历史运行快照不受影响）
  for (const legacy of LEGACY_PRESET_NAMES) {
    await db.delete(evalSuites).where(eq(evalSuites.name, legacy));
  }

  // 按名称幂等 upsert：已存在则更新配置与说明，否则新建
  for (const p of presets) {
    const existing = await db.query.evalSuites.findFirst({ where: eq(evalSuites.name, p.name) });
    if (existing) {
      await db
        .update(evalSuites)
        .set({ description: p.description, config: p.config, updatedAt: new Date() })
        .where(eq(evalSuites.id, existing.id));
    } else {
      await db.insert(evalSuites).values({ name: p.name, description: p.description, config: p.config });
    }
  }

  await db
    .insert(appMeta)
    .values({ key: "preset_suites_version", value: PRESET_SUITES_VERSION })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: PRESET_SUITES_VERSION } });
}

/** 供 seed.ts 脚本使用：强制初始化并打印统计 */
export async function initAndReport() {
  await ensureDbReady();
  const db = getDb();
  const [q] = await db.select({ n: sql<number>`count(*)` }).from(questions);
  const [m] = await db.select({ n: sql<number>`count(*)` }).from(models);
  const [s] = await db.select({ n: sql<number>`count(*)` }).from(evalSuites);
  console.log(`初始化完成：内置题库 ${Number(q.n)} 题 · 模型 ${Number(m.n)} 个 · 套件 ${Number(s.n)} 个`);
}
