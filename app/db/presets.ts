/**
 * 内置专业测试套件预设。
 *
 * 设计原则：每个套件在「维度集合 / 题量上限 / 维度权重 / 难度分层 / 采样参数 / 判分通道」
 * 六个维度上都有实质差异，而不是只换一段说明文字——确保用户能针对不同评测目的
 * （连通性冒烟、日常回归、旗舰深度、极限压测、编程专项、安全对齐）选择真正合适的配置。
 *
 * PRESET_SUITES_VERSION 变更时，init 会按名称幂等同步这些预设（用户自建套件不受影响）。
 */
import { CATEGORIES, DEFAULT_PARAMS, type SuiteConfig, type EvalParams } from "../contracts/eval";

export const PRESET_SUITES_VERSION = "2";

type CatSpec = { enabled?: boolean; count?: number; weight?: number };

function params(patch: Partial<EvalParams>): EvalParams {
  return { ...DEFAULT_PARAMS, ...patch };
}

/** 构造套件配置：默认关闭评审、全维度启用，再按 spec 覆盖 */
function build(opts: {
  levels: number[];
  cats: Record<string, CatSpec>;
  params: Partial<EvalParams>;
  judge?: { enabled: boolean; reviewThreshold?: number };
}): SuiteConfig {
  const categories = Object.fromEntries(
    CATEGORIES.map((c) => {
      const spec = opts.cats[c.key] ?? {};
      return [c.key, { enabled: spec.enabled ?? true, count: spec.count ?? 0, weight: spec.weight ?? 1 }];
    }),
  );
  return {
    categories,
    levels: opts.levels,
    judgeEnabled: opts.judge?.enabled ?? false,
    judgeModelId: null,
    reviewThreshold: opts.judge?.reviewThreshold ?? 0.5,
    params: params(opts.params),
  };
}

export interface PresetSuite {
  name: string;
  description: string;
  config: SuiteConfig;
}

export function buildPresetSuites(flagshipModelId: number | null): PresetSuite[] {
  const all = CATEGORIES.map((c) => c.key);

  const presets: PresetSuite[] = [
    {
      name: "极速冒烟测试",
      description:
        "连通性与基础能力体检：全维度各抽 2 题、仅难度 1~3，单轮、关闭评审、并发 8——约 1 分钟跑完，用于快速验证模型接入是否正常。",
      config: build({
        levels: [1, 2, 3],
        cats: Object.fromEntries(all.map((k) => [k, { count: 2 }])),
        params: { temperature: 0, maxTokens: 2048, timeoutMs: 45000, retries: 1, repeatCount: 1, concurrency: 8 },
      }),
    },
    {
      name: "标准全能评测",
      description:
        "日常回归基线：全维度、全难度、每维度全部题目、单轮、纯规则判分（关闭评审）——判分完全客观可复现，适合快速横向对比。",
      config: build({
        levels: [1, 2, 3, 4, 5],
        cats: {},
        params: { temperature: 0, maxTokens: 4096, timeoutMs: 60000, retries: 2, repeatCount: 1, concurrency: 4 },
      }),
    },
    {
      name: "竞技场深度评测",
      description:
        "旗舰级综合评测：全维度、全难度、每题 3 轮取均值（显著降低采样方差）、启用评审模型双通道判分，规则与评审分歧自动进入人工复核。",
      config: build({
        levels: [1, 2, 3, 4, 5],
        cats: {},
        params: { temperature: 0, maxTokens: 4096, timeoutMs: 90000, retries: 2, repeatCount: 3, concurrency: 4 },
        judge: { enabled: true },
      }),
    },
    {
      name: "地狱难度专项",
      description:
        "极限压测：仅专家级与地狱级（难度 4~5），3 轮 + 评审双通道，并对逻辑、数学、编程、智能体四个硬核维度加倍权重——专为拉开顶尖模型差距设计。",
      config: build({
        levels: [4, 5],
        cats: { logic: { weight: 2 }, math: { weight: 2 }, coding: { weight: 2 }, agent: { weight: 2 } },
        params: { temperature: 0, maxTokens: 8192, timeoutMs: 120000, retries: 2, repeatCount: 3, concurrency: 4 },
        judge: { enabled: true },
      }),
    },
    {
      name: "编程实战专项",
      description:
        "代码能力专项：仅编程与智能体任务两个维度，全难度，3 轮 + 评审双通道；编程题在隔离沙箱中真实执行代码验证输出，杜绝「看起来对」。",
      config: build({
        levels: [1, 2, 3, 4, 5],
        cats: {
          logic: { enabled: false },
          math: { enabled: false },
          commonsense: { enabled: false },
          multilingual: { enabled: false },
          instruction: { enabled: false },
          reading: { enabled: false },
          creative: { enabled: false },
          safety: { enabled: false },
          coding: { weight: 2 },
          agent: { weight: 1.5 },
        },
        params: { temperature: 0, maxTokens: 8192, timeoutMs: 60000, retries: 2, repeatCount: 3, concurrency: 4 },
        judge: { enabled: true },
      }),
    },
    {
      name: "安全对齐专项",
      description:
        "安全对齐专项：仅拒答与安全性维度，全难度，3 轮 + 评审双通道，双向考察——应拒答的有害请求是否拒绝、不该拒答的正当问题是否过度拒答。",
      config: build({
        levels: [1, 2, 3, 4, 5],
        cats: {
          logic: { enabled: false },
          math: { enabled: false },
          coding: { enabled: false },
          agent: { enabled: false },
          commonsense: { enabled: false },
          multilingual: { enabled: false },
          instruction: { enabled: false },
          reading: { enabled: false },
          creative: { enabled: false },
          safety: { weight: 1 },
        },
        params: { temperature: 0, maxTokens: 2048, timeoutMs: 60000, retries: 2, repeatCount: 3, concurrency: 4 },
        judge: { enabled: true },
      }),
    },
  ];

  // 评审模型统一指向内置旗舰测试模型（离线可用、不消耗额度）
  for (const p of presets) {
    if (p.config.judgeEnabled) p.config.judgeModelId = flagshipModelId;
  }
  return presets;
}

/** 旧版本内置预设名（重命名后需清理，避免遗留同名旧配置） */
export const LEGACY_PRESET_NAMES = ["极速全量评测"];
