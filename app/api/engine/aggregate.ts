import { getDb } from "../queries/connection";
import { runs, runItems, questions, models } from "@db/schema";
import { eq, inArray } from "drizzle-orm";
import type { SuiteConfig } from "../../contracts/eval";
import { CATEGORY_MAP } from "../../contracts/eval";
import { stableHash, mulberry32 } from "./random";

export interface ModelSummary {
  modelId: number;
  modelName: string;
  groupId: number | null;
  total: number; // 0~100
  rank: number;
  categories: Record<string, number>; // 0~100
  categoryNames: Record<string, string>;
  avgLatencyMs: number;
  p95LatencyMs: number;
  latencyStdMs: number;
  successRate: number; // 0~1
  doneCount: number;
  failedCount: number;
  skippedCount: number;
  needsReviewCount: number;
  repeatStd: number; // 多次重复得分的平均标准差（稳定性，越小越稳）
  totalTokens: number;
  estimatedCost: number; // 美元
  /** 编程维度 pass@1（HumanEval 惯例：单次采样通过率），无编程题时为 null */
  passAt1: number | null;
  /** 编程维度 pass@k（k=重复轮次，HumanEval 标准公式 1-C(n-c,k)/C(n,k)），无编程题或轮次<2 时为 null */
  passAtK: { k: number; value: number } | null;
  /** 难度分层得分（1~5 级，0~100），仅含有数据的层级 */
  difficultyScores: Record<number, number>;
  /** 总分 95% bootstrap 置信区间（题目级重采样 500 次） */
  totalCI: [number, number] | null;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** HumanEval 标准 pass@k：1 - C(n-c,k)/C(n,k)，连乘形式避免溢出 */
function passAtK(n: number, c: number, k: number): number {
  if (n - c < k) return 1;
  let p = 1;
  for (let i = 0; i < k; i++) {
    p *= (n - c - i) / (n - i);
  }
  return 1 - p;
}

function percentile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 汇总某次运行的全部模型成绩（多次重复取均值，权重来自参数快照，题目权重来自题库） */
export async function summarizeRun(runId: number): Promise<ModelSummary[]> {
  const db = getDb();
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) throw new Error("运行不存在");
  const cfg = run.paramSnapshot as SuiteConfig;

  const items = await db.select().from(runItems).where(eq(runItems.runId, runId));
  const qIds = [...new Set(items.map((i) => i.questionId))];
  const mIds = [...new Set(items.map((i) => i.modelId))];
  const qs = qIds.length ? await db.select().from(questions).where(inArray(questions.id, qIds)) : [];
  const ms = mIds.length ? await db.select().from(models).where(inArray(models.id, mIds)) : [];
  const qMap = new Map(qs.map((q) => [q.id, q]));

  const summaries: ModelSummary[] = [];

  for (const modelId of mIds) {
    const model = ms.find((m) => m.id === modelId);
    const mItems = items.filter((i) => i.modelId === modelId);
    const done = mItems.filter((i) => i.status === "done");
    const failed = mItems.filter((i) => i.status === "failed");
    const skipped = mItems.filter((i) => i.status === "skipped");

    // 题目级得分 = 多次重复的均值
    const byQuestion = new Map<number, number[]>();
    for (const it of done) {
      if (it.finalScore === null) continue;
      const arr = byQuestion.get(it.questionId) ?? [];
      arr.push(it.finalScore);
      byQuestion.set(it.questionId, arr);
    }

    // 维度得分 = 维度内题目加权均值（0~100）
    const categories: Record<string, number> = {};
    const catGroups = new Map<string, { score: number; weight: number }[]>();
    for (const [qId, scores] of byQuestion) {
      const q = qMap.get(qId);
      if (!q) continue;
      const arr = catGroups.get(q.category) ?? [];
      arr.push({ score: mean(scores), weight: q.weight });
      catGroups.set(q.category, arr);
    }
    for (const [cat, arr] of catGroups) {
      const wSum = arr.reduce((a, b) => a + b.weight, 0);
      categories[cat] = wSum ? Math.round((arr.reduce((a, b) => a + b.score * b.weight, 0) / wSum) * 1000) / 10 : 0;
    }

    // 难度分层得分（1~5 级，加权均值 0~100）
    const difficultyScores: Record<number, number> = {};
    const diffGroups = new Map<number, { score: number; weight: number }[]>();
    for (const [qId, scores] of byQuestion) {
      const q = qMap.get(qId);
      if (!q) continue;
      const darr = diffGroups.get(q.difficulty) ?? [];
      darr.push({ score: mean(scores), weight: q.weight });
      diffGroups.set(q.difficulty, darr);
    }
    for (const [lv, arr] of diffGroups) {
      const wSum = arr.reduce((a, b) => a + b.weight, 0);
      difficultyScores[lv] = wSum ? Math.round((arr.reduce((a, b) => a + b.score * b.weight, 0) / wSum) * 1000) / 10 : 0;
    }

    // 编程维度 pass@k（HumanEval 标准公式；correct = 最终分 ≥ 0.5，编程题为二元判分）
    let passAt1: number | null = null;
    let passAtKOut: { k: number; value: number } | null = null;
    const codingStats: { n: number; c: number }[] = [];
    for (const [qId, scores] of byQuestion) {
      const q = qMap.get(qId);
      if (!q || q.category !== "coding") continue;
      codingStats.push({ n: scores.length, c: scores.filter((s) => s >= 0.5).length });
    }
    if (codingStats.length > 0) {
      passAt1 = Math.round((codingStats.reduce((a, s) => a + s.c / s.n, 0) / codingStats.length) * 1000) / 10;
      const k = Math.min(...codingStats.map((s) => s.n));
      if (k >= 2) {
        const v = codingStats.reduce((a, s) => a + passAtK(s.n, s.c, k), 0) / codingStats.length;
        passAtKOut = { k, value: Math.round(v * 1000) / 10 };
      }
    }

    // 总分 95% bootstrap 置信区间（题目级有放回重采样 500 次，确定性种子保证可复现）
    let totalCI: [number, number] | null = null;
    const qScores = [...byQuestion.entries()].flatMap(([qId, scores]) => {
      const q = qMap.get(qId);
      if (!q) return [];
      return [{ category: q.category, weight: q.weight, score: mean(scores) }];
    });
    if (qScores.length >= 2) {
      const rng = mulberry32(stableHash(`ci::${runId}::${modelId}`));
      const totals: number[] = [];
      const BOOT = 500;
      for (let b = 0; b < BOOT; b++) {
        const byCat = new Map<string, { s: number; w: number }[]>();
        for (let i = 0; i < qScores.length; i++) {
          const pick = qScores[Math.floor(rng() * qScores.length)];
          const arr = byCat.get(pick.category) ?? [];
          arr.push({ s: pick.score, w: pick.weight });
          byCat.set(pick.category, arr);
        }
        let t = 0;
        let wT = 0;
        for (const [cat, arr] of byCat) {
          const wSum = arr.reduce((a, x) => a + x.w, 0);
          const catScore = wSum ? arr.reduce((a, x) => a + x.s * x.w, 0) / wSum : 0;
          const w = cfg.categories?.[cat]?.weight ?? 1;
          t += catScore * w;
          wT += w;
        }
        totals.push(wT ? t / wT : 0);
      }
      totals.sort((a, b) => a - b);
      totalCI = [
        Math.round(percentile(totals, 0.025) * 1000) / 10,
        Math.round(percentile(totals, 0.975) * 1000) / 10,
      ];
    }

    // 总分 = 维度得分按套件维度权重加权（0~100）
    let total = 0;
    let wTotal = 0;
    for (const [cat, score] of Object.entries(categories)) {
      const w = cfg.categories?.[cat]?.weight ?? 1;
      total += score * w;
      wTotal += w;
    }
    total = wTotal ? Math.round((total / wTotal) * 10) / 10 : 0;

    const lat = done.map((i) => i.latencyMs ?? 0).filter((x) => x > 0).sort((a, b) => a - b);
    const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.95) - 1)] : 0;

    // 稳定性：每题多次重复得分的标准差，取均值
    const repeatStds = [...byQuestion.values()].filter((s) => s.length > 1).map(std);

    const promptTokens = mItems.reduce((a, i) => a + (i.promptTokens ?? 0), 0);
    const completionTokens = mItems.reduce((a, i) => a + (i.completionTokens ?? 0), 0);
    const cost = model
      ? (promptTokens * model.inputPrice + completionTokens * model.outputPrice) / 1_000_000
      : 0;

    const attempted = done.length + failed.length;
    summaries.push({
      modelId,
      modelName: model?.name ?? `#${modelId}`,
      groupId: model?.groupId ?? null,
      total,
      rank: 0,
      categories,
      categoryNames: Object.fromEntries(Object.keys(categories).map((k) => [k, CATEGORY_MAP[k]?.name ?? k])),
      avgLatencyMs: Math.round(mean(lat)),
      p95LatencyMs: Math.round(p95),
      latencyStdMs: Math.round(std(lat)),
      successRate: attempted ? Math.round((done.length / attempted) * 1000) / 1000 : 0,
      doneCount: done.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
      needsReviewCount: done.filter((i) => i.needsReview).length,
      repeatStd: Math.round(mean(repeatStds) * 1000) / 1000,
      totalTokens: promptTokens + completionTokens,
      estimatedCost: Math.round(cost * 10000) / 10000,
      passAt1,
      passAtK: passAtKOut,
      difficultyScores,
      totalCI,
    });
  }

  summaries.sort((a, b) => b.total - a.total);
  summaries.forEach((s, i) => (s.rank = i + 1));
  return summaries;
}
