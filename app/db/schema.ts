import {
  sqliteTable,
  integer,
  text,
  real,
  index,
} from "drizzle-orm/sqlite-core";

/** 模型分组 */
export const modelGroups = sqliteTable("model_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#f5b83d"),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 受测模型 */
export const models = sqliteTable(
  "models",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id"),
    name: text("name").notNull(),
    /** openai = OpenAI 兼容接口；mock = 内置模拟模型（测试/演示，无需密钥） */
    provider: text("provider").notNull().default("openai"),
    baseUrl: text("base_url").notNull().default(""),
    apiKey: text("api_key").notNull().default(""),
    modelId: text("model_id").notNull(),
    /** 价格：美元 / 百万 tokens，用于成本统计 */
    inputPrice: real("input_price").notNull().default(0),
    outputPrice: real("output_price").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    lastTestStatus: text("last_test_status"),
    lastTestLatencyMs: integer("last_test_latency_ms"),
    lastTestError: text("last_test_error"),
    lastTestedAt: integer("last_tested_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("models_group_idx").on(t.groupId)],
);

/** 题库题目（公开：题干、评分标准、判分规则全部可见） */
export const questions = sqliteTable(
  "questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bankVersion: text("bank_version").notNull(),
    category: text("category").notNull(),
    /** 难度 1~5：1 基础 / 2 进阶 / 3 困难 / 4 专家 / 5 地狱 */
    difficulty: integer("difficulty").notNull().default(1),
    prompt: text("prompt").notNull(),
    expectedAnswer: text("expected_answer"),
    scoringType: text("scoring_type").notNull(),
    /** 判分规则配置（公开）：pattern / keywords / forbidden / caseSensitive / tolerance / mode / expectedOutput / checks 等 */
    scoringConfig: text("scoring_config", { mode: "json" }),
    /** 模型评审用评分标准（公开） */
    rubric: text("rubric"),
    weight: real("weight").notNull().default(1),
    /** builtin=内置公开题库 custom=用户自建 */
    source: text("source").notNull().default("builtin"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("questions_cat_idx").on(t.category),
    index("questions_ver_idx").on(t.bankVersion),
  ],
);

/** 测试套件：维度题量/权重/难度配置 + 统一参数 + 评审配置 */
export const evalSuites = sqliteTable("eval_suites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  config: text("config", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 评测运行 */
export const runs = sqliteTable(
  "runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    suiteId: integer("suite_id"),
    /** 套件名称快照：套件后续改名或删除后，仍可追溯本次运行所用的套件 */
    suiteName: text("suite_name"),
    status: text("status").notNull().default("pending"),
    seed: integer("seed").notNull().default(42),
    /** 参数快照：温度/maxTokens/超时/重试/重复次数/并发/系统提示词/评审配置/维度配置 */
    paramSnapshot: text("param_snapshot", { mode: "json" }).notNull(),
    bankVersion: text("bank_version").notNull(),
    /** 题库内容哈希，保证可追溯、防篡改 */
    bankHash: text("bank_hash").notNull(),
    totalItems: integer("total_items").notNull().default(0),
    doneItems: integer("done_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp" }),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("runs_status_idx").on(t.status)],
);

/** 逐题执行明细（单模型 × 单题 × 单次重复） */
export const runItems = sqliteTable(
  "run_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id").notNull(),
    modelId: integer("model_id").notNull(),
    questionId: integer("question_id").notNull(),
    repeatIndex: integer("repeat_index").notNull().default(0),
    /** 由种子确定性得出的全局顺序，所有模型一致 */
    seq: integer("seq").notNull().default(0),
    status: text("status").notNull().default("pending"),
    promptSent: text("prompt_sent"),
    responseText: text("response_text"),
    latencyMs: integer("latency_ms"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    ruleScore: real("rule_score"),
    judgeScore: real("judge_score"),
    judgeReason: text("judge_reason"),
    finalScore: real("final_score"),
    scoreDetail: text("score_detail", { mode: "json" }),
    error: text("error"),
    retryCount: integer("retry_count").notNull().default(0),
    needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
    reviewScore: real("review_score"),
    reviewNote: text("review_note"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  },
  (t) => [
    index("items_run_idx").on(t.runId),
    index("items_run_model_idx").on(t.runId, t.modelId),
    index("items_review_idx").on(t.needsReview),
  ],
);

/** 运行实时日志 */
export const runLogs = sqliteTable(
  "run_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id").notNull(),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("logs_run_idx").on(t.runId)],
);

/** 评测报告（可公开分享） */
export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull(),
  shareId: text("share_id").notNull().unique(),
  title: text("title").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * 竞技场两两对战记录（Arena 战报）。
 * 同一题目同一轮次下，任意两个受测模型各配对一战；胜者由 AI 裁判或分差规则判定。
 * 用于 Bradley-Terry/Elo 评级（对齐 Chatbot Arena 开源方法论）。
 */
export const battles = sqliteTable(
  "battles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id").notNull(),
    questionId: integer("question_id").notNull(),
    repeatIndex: integer("repeat_index").notNull().default(0),
    modelAId: integer("model_a_id").notNull(),
    modelBId: integer("model_b_id").notNull(),
    /** A / B / tie */
    winner: text("winner").notNull(),
    /** ai_judge=评审模型成对裁决 / score_diff=最终分差判定 */
    method: text("method").notNull(),
    /** 判决依据摘要（公开） */
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("battles_run_idx").on(t.runId),
    index("battles_a_idx").on(t.modelAId),
    index("battles_b_idx").on(t.modelBId),
  ],
);

/** 系统元信息：种子幂等标志等（原子抢锁，防并发重复写入） */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type ModelGroup = typeof modelGroups.$inferSelect;
export type Model = typeof models.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type EvalSuite = typeof evalSuites.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunItem = typeof runItems.$inferSelect;
export type RunLog = typeof runLogs.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Battle = typeof battles.$inferSelect;
export type AppMeta = typeof appMeta.$inferSelect;
