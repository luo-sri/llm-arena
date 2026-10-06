import { stableHash } from "./random";

/**
 * 内置模拟测试模型（四档位）—— 离线、确定性、零额度消耗。
 * 用于全流程逻辑测试与无密钥演示：旗舰/进阶/标准/入门四档能力值（skill）
 * 决定各自答题正确率，与种子结合后每题结果完全可复现。
 */
export interface MockModelPreset {
  modelId: string;
  name: string;
  /** 能力值 0~1：每题答对的确定性采样概率（结合运行种子） */
  skill: number;
  /** 模拟响应时延范围（ms） */
  latency: [number, number];
  notes: string;
}

export const MOCK_MODEL_PRESETS: MockModelPreset[] = [
  {
    modelId: "mock-flagship",
    name: "测试模型·旗舰档",
    skill: 0.96,
    latency: [70, 200],
    notes: "模拟旗舰档：基础/进阶/困难全对，专家级接近全对，地狱级偶有失手。离线确定性，不消耗任何 API 额度。",
  },
  {
    modelId: "mock-advanced",
    name: "测试模型·进阶档",
    skill: 0.8,
    latency: [90, 280],
    notes: "模拟进阶档：低难度稳定答对，专家级多数答对，地狱级明显失分。离线确定性，不消耗任何 API 额度。",
  },
  {
    modelId: "mock-standard",
    name: "测试模型·标准档",
    skill: 0.62,
    latency: [120, 380],
    notes: "模拟标准档：基础题基本答对，难度升高后正确率显著下滑。离线确定性，不消耗任何 API 额度。",
  },
  {
    modelId: "mock-basic",
    name: "测试模型·入门档",
    skill: 0.42,
    latency: [150, 500],
    notes: "模拟入门档：即使基础题也会出错，用于验证排名与判分链路的区分度。离线确定性，不消耗任何 API 额度。",
  },
];

/** 按 modelId 取能力值；未知 mock ID 回退到确定性哈希（兼容历史数据） */
export function getMockSkill(modelId: string): number {
  const preset = MOCK_MODEL_PRESETS.find((p) => p.modelId === modelId);
  if (preset) return preset.skill;
  return 0.45 + (stableHash(modelId) % 50) / 100; // 0.45~0.94
}

/** 按 modelId 取时延范围；未知 ID 使用默认范围 */
export function getMockLatencyRange(modelId: string): [number, number] {
  const preset = MOCK_MODEL_PRESETS.find((p) => p.modelId === modelId);
  return preset?.latency ?? [120, 680];
}
