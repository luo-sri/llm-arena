/**
 * 选题：按套件配置从题库中确定性抽取题目。
 * 规则（所有模型必须拿到完全相同的题集与顺序）：
 *  1. 维度启用（categories[cat].enabled）
 *  2. 难度分层（levels；缺省或空数组 = 全部 1~5 级）
 *  3. 题量上限（count，0 = 该维度全部题目）
 * 抽样使用固定种子，保证同一种子 → 同一题集，可复现、可复核。
 */
import { seededShuffle } from "./random";
import type { SuiteConfig } from "../../contracts/eval";

export interface SelectableQuestion {
  id: number;
  category: string;
  difficulty: number;
}

export function selectQuestions<T extends SelectableQuestion>(
  all: T[],
  cfg: Pick<SuiteConfig, "categories" | "levels">,
  seed: number,
): T[] {
  const levels = cfg.levels && cfg.levels.length > 0 ? new Set(cfg.levels) : null;
  const chosen: T[] = [];
  for (const [cat, catCfg] of Object.entries(cfg.categories)) {
    if (!catCfg?.enabled) continue;
    const inCat = all.filter((q) => q.category === cat && (!levels || levels.has(q.difficulty)));
    if (inCat.length === 0) continue;
    if (catCfg.count > 0 && catCfg.count < inCat.length) {
      chosen.push(...seededShuffle(inCat, seed).slice(0, catCfg.count));
    } else {
      chosen.push(...inCat);
    }
  }
  return chosen;
}

/** 难度分层的人类可读描述，用于日志与报错提示 */
export function describeLevels(levels?: number[]): string {
  if (!levels || levels.length === 0 || levels.length === 5) return "全部 1~5 级";
  return `${[...levels].sort((a, b) => a - b).join("/")} 级`;
}
