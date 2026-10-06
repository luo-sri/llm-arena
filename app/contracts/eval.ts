// 共享契约：前端与后端共用的常量与类型

export const BANK_VERSION = "v2.2.0";

export const CATEGORIES = [
  { key: "logic", name: "逻辑推理", color: "#f5b83d" },
  { key: "math", name: "数学", color: "#7feb00" },
  { key: "coding", name: "编程", color: "#00d5e9" },
  { key: "agent", name: "智能体任务", color: "#60a5fa" },
  { key: "commonsense", name: "常识知识", color: "#ff5872" },
  { key: "multilingual", name: "多语言", color: "#b18cff" },
  { key: "instruction", name: "指令遵循", color: "#ff9f43" },
  { key: "reading", name: "阅读理解", color: "#4dd0a6" },
  { key: "creative", name: "创作", color: "#f472d0" },
  { key: "safety", name: "拒答与安全性", color: "#8d99ae" },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export const CATEGORY_MAP: Record<string, { name: string; color: string }> =
  Object.fromEntries(CATEGORIES.map((c) => [c.key, { name: c.name, color: c.color }]));

/** 难度分级（1~5） */
export const DIFFICULTY_LEVELS = [
  { level: 1, name: "基础", desc: "入门级，所有合格模型都应答对" },
  { level: 2, name: "进阶", desc: "需要扎实的推理与知识" },
  { level: 3, name: "困难", desc: "能明显区分中端与高端模型" },
  { level: 4, name: "专家", desc: "只有少数顶尖模型能稳定通过" },
  { level: 5, name: "地狱", desc: "极限压测，绝大多数模型会失分" },
] as const;

export const DIFFICULTY_MAP: Record<number, { name: string; desc: string }> =
  Object.fromEntries(DIFFICULTY_LEVELS.map((d) => [d.level, { name: d.name, desc: d.desc }]));

export const SCORING_TYPES = [
  { key: "exact", name: "精确匹配", desc: "答案与参考答案规范化后完全一致（可配置大小写敏感）" },
  { key: "numeric", name: "数值匹配", desc: "从回答中提取数值，与参考答案在容差内比较" },
  { key: "regex", name: "正则匹配", desc: "回答须命中公开的正则表达式" },
  { key: "keywords", name: "关键词判分", desc: "按必含关键词比例计分，命中禁用词则判 0，支持长度与藏头等结构约束" },
  { key: "contains", name: "包含匹配", desc: "回答须包含参考答案（规范化后）" },
  { key: "code_exec", name: "代码执行", desc: "在隔离沙箱中真实运行回答中的 JavaScript 代码，比对标准输出——真刀真枪的编程验证" },
  { key: "json_schema", name: "JSON 结构", desc: "校验回答 JSON 的结构与字段约束（数组/对象/键/取值/顺序），逐条公开规则按比例计分" },
  { key: "judge", name: "模型评审", desc: "由评审模型依据公开评分标准打分（0~1），支持多语言等价答案" },
] as const;

export type ScoringType = (typeof SCORING_TYPES)[number]["key"];

export const RUN_STATUSES = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ITEM_STATUSES = ["pending", "running", "done", "failed", "skipped"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** 评测统一参数（每次运行快照保存，所有模型一致） */
export interface EvalParams {
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  retries: number;
  repeatCount: number;
  seed: number;
  concurrency: number;
  systemPrompt: string;
}

export const DEFAULT_PARAMS: EvalParams = {
  temperature: 0,
  maxTokens: 4096,
  timeoutMs: 60000,
  retries: 2,
  repeatCount: 1,
  seed: 42,
  concurrency: 4,
  systemPrompt: "",
};

export interface CategoryConfig {
  enabled: boolean;
  /** 每类抽题数量（0 = 全部） */
  count: number;
  /** 维度权重 */
  weight: number;
}

export interface SuiteConfig {
  categories: Record<string, CategoryConfig>;
  /** 参与抽题的难度级别（缺省 = 全部 1~5 级） */
  levels?: number[];
  judgeEnabled: boolean;
  judgeModelId: number | null;
  /** 双通道判分时，规则分与评审分差异超过该阈值则进入人工复核 */
  reviewThreshold: number;
  params: EvalParams;
}

export const DEFAULT_SUITE_CONFIG: SuiteConfig = {
  categories: Object.fromEntries(
    CATEGORIES.map((c) => [c.key, { enabled: true, count: 0, weight: 1 }]),
  ),
  levels: [1, 2, 3, 4, 5],
  judgeEnabled: false,
  judgeModelId: null,
  reviewThreshold: 0.5,
  params: DEFAULT_PARAMS,
};

export const DISCLAIMER =
  "免责声明：本报告由自动化评测系统生成，结果受题库覆盖范围、判分规则、采样参数与模型版本影响，仅供研究与参考，不构成对任何模型能力的最终结论。题目、评分标准与判分规则全部公开（规则判分 + 评审模型双通道 + 人工复核），欢迎复核与监督。编程类题目通过在隔离沙箱中真实执行代码验证输出，判分客观可复现。模型回答可能包含错误或不当内容，请谨慎采信。";
