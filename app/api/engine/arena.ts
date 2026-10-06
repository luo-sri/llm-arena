import { eq, inArray, desc } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { runs, runItems, questions, models, battles } from "@db/schema";
import { callModel } from "./provider";
import { stableHash, mulberry32 } from "./random";
import type { SuiteConfig } from "../../contracts/eval";

/** 分差不超过该值判平局（约半档分数） */
const SCORE_TIE_EPSILON = 0.05;
/** Bradley-Terry bootstrap 重采样次数（LMArena 同款方法论，本地取 500 保证速度） */
const BOOTSTRAP_ROUNDS = 500;
/** 评级锚点：平均强度 = 1000，400 分 ≈ 10 倍胜率比（标准 Elo 量纲） */
const ELO_ANCHOR = 1000;
const ELO_SCALE = 400;

export interface BattleRowLite {
  a: number; // modelId
  b: number; // modelId
  winner: "A" | "B" | "tie";
}

export interface ModelRating {
  modelId: number;
  rating: number;
  ciLow: number;
  ciHigh: number;
  wins: number;
  losses: number;
  ties: number;
  battlesCount: number;
  winRate: number; // (wins + ties*0.5) / battles
}

export interface PairwiseCell {
  modelAId: number;
  modelBId: number;
  aWins: number;
  bWins: number;
  ties: number;
  total: number;
}

/**
 * 成对裁判提示词（公开）。
 * 盲选 + 位置随机化（由调用方决定 A/B 摆放），只评内容不评语言，杜绝语言偏差。
 */
export function buildPairwisePrompt(
  q: { prompt: string; expectedAnswer: string | null },
  answerA: string,
  answerB: string,
): string {
  return `你是竞技场裁判，负责对同一道题的两个匿名模型回答做盲选比较，给出更优者。

【判定原则】
1. 只比较内容质量：正确性、完整性、对题目要求的完成度；完全不评回答语言——中文题被英文答（或任何语言互译）绝不扣分，内容等价即视为同等质量。
2. 必须给出明确胜者；仅当两者质量确实难分高下时才允许平局。
3. 回答长度本身不构成优劣，除非明显影响任务完成（过长跑题/过短未完成）。
4. reason 必须引用两个回答中的具体证据，不允许空洞评语。

【题目】
${q.prompt}

${q.expectedAnswer ? `【参考答案】（内容等价即可，不要求逐字一致）\n${q.expectedAnswer}\n\n` : ""}【回答 A】
${answerA}

【回答 B】
${answerB}

【输出要求】
只输出一个 JSON 对象，不要输出任何其他内容，reason 用中文书写：
{"winner":"A"|"B"|"tie","reason":"<不超过 80 字，引用具体证据>"}`;
}

export function parsePairwiseResponse(text: string): { winner: "A" | "B" | "tie"; reason: string } | null {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { winner?: unknown; reason?: unknown };
    const w = String(j.winner).toUpperCase();
    if (w === "A" || w === "B" || w === "TIE" || w === "平局") {
      return { winner: w === "TIE" || w === "平局" ? "tie" : w, reason: String(j.reason ?? "").slice(0, 400) };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 为某次运行生成两两对战（幂等：先清空该运行旧战报再重建）。
 * 胜负判定双模式（对齐 LMArena / Arena-Hard 实践）：
 *  - ai_judge：启用评审模型时，评审模型对每对战做盲选裁决（A/B 位置随机化消除位置偏差）
 *  - score_diff：机器审核时按最终分差判定（|Δ|≤0.05 平局）
 * AI 裁决失败自动回退分差判定并记录。
 */
export async function generateBattles(runId: number): Promise<{ total: number; aiJudged: number }> {
  const db = getDb();
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) throw new Error("运行不存在");
  const cfg = run.paramSnapshot as SuiteConfig;

  const doneItems = await db
    .select()
    .from(runItems)
    .where(eq(runItems.runId, runId));
  const scored = doneItems.filter((i) => i.status === "done" && i.finalScore !== null && i.responseText);
  if (scored.length === 0) {
    await db.delete(battles).where(eq(battles.runId, runId));
    return { total: 0, aiJudged: 0 };
  }

  const modelIds = [...new Set(scored.map((i) => i.modelId))].sort((x, y) => x - y);
  if (modelIds.length < 2) {
    await db.delete(battles).where(eq(battles.runId, runId));
    return { total: 0, aiJudged: 0 };
  }

  const qIds = [...new Set(scored.map((i) => i.questionId))];
  const qs = await db.select().from(questions).where(inArray(questions.id, qIds));
  const qMap = new Map(qs.map((q) => [q.id, q]));

  let judgeModel: typeof models.$inferSelect | null = null;
  if (cfg.judgeEnabled && cfg.judgeModelId) {
    judgeModel = (await db.query.models.findFirst({ where: eq(models.id, cfg.judgeModelId) })) ?? null;
  }

  // 按 (题目, 轮次) 分组
  const groups = new Map<string, typeof scored>();
  for (const it of scored) {
    const key = `${it.questionId}::${it.repeatIndex}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }

  await db.delete(battles).where(eq(battles.runId, runId));

  const rows: (typeof battles.$inferInsert)[] = [];
  let aiJudged = 0;
  const judgeJobs: Array<() => Promise<void>> = [];

  for (const [key, group] of groups) {
    const [questionId, repeatIndex] = key.split("::").map(Number);
    const q = qMap.get(questionId);
    if (!q) continue;
    for (let i = 0; i < modelIds.length; i++) {
      for (let j = i + 1; j < modelIds.length; j++) {
        const aId = modelIds[i];
        const bId = modelIds[j];
        const itemA = group.find((g) => g.modelId === aId);
        const itemB = group.find((g) => g.modelId === bId);
        if (!itemA || !itemB) continue;

        const pushRow = (winner: "A" | "B" | "tie", method: string, reason: string) => {
          rows.push({
            runId,
            questionId,
            repeatIndex,
            modelAId: aId,
            modelBId: bId,
            winner,
            method,
            reason,
          });
        };

        if (judgeModel) {
          // 位置随机化（确定性）：偶数放 A/B 原序，奇数交换，判后映射回真实模型
          const swap = stableHash(`${runId}:${questionId}:${repeatIndex}:${aId}:${bId}`) % 2 === 1;
          const textA = swap ? itemB.responseText! : itemA.responseText!;
          const textB = swap ? itemA.responseText! : itemB.responseText!;
          judgeJobs.push(async () => {
            try {
              const jr = await callModel(
                judgeModel!,
                {
                  prompt: buildPairwisePrompt(q, textA, textB),
                  expectedAnswer: null,
                  scoringType: "judge",
                  scoringConfig: null,
                },
                { ...cfg.params, systemPrompt: "" },
                0,
              );
              const parsed = parsePairwiseResponse(jr.text);
              if (parsed) {
                let winner: "A" | "B" | "tie" = parsed.winner;
                if (swap && winner !== "tie") winner = winner === "A" ? "B" : "A";
                aiJudged++;
                pushRow(winner, "ai_judge", parsed.reason);
              } else {
                const [w, why] = scoreDiffJudge(itemA.finalScore!, itemB.finalScore!);
                pushRow(w, "score_diff", `${why}；AI 裁决输出无法解析，回退分差判定`);
              }
            } catch {
              const [w, why] = scoreDiffJudge(itemA.finalScore!, itemB.finalScore!);
              pushRow(w, "score_diff", `${why}；AI 裁决调用失败，回退分差判定`);
            }
          });
        } else {
          const [winner, reason] = scoreDiffJudge(itemA.finalScore!, itemB.finalScore!);
          pushRow(winner, "score_diff", reason);
        }
      }
    }
  }

  // AI 裁决限流并发执行，避免压垮评审接口
  const CHUNK = 4;
  for (let k = 0; k < judgeJobs.length; k += CHUNK) {
    await Promise.all(judgeJobs.slice(k, k + CHUNK).map((f) => f()));
  }

  for (let k = 0; k < rows.length; k += 500) {
    await db.insert(battles).values(rows.slice(k, k + 500));
  }
  return { total: rows.length, aiJudged };
}

function scoreDiffJudge(sa: number, sb: number): ["A" | "B" | "tie", string] {
  const d = sa - sb;
  if (Math.abs(d) <= SCORE_TIE_EPSILON) {
    return ["tie", `分差判定：两者得分 ${sa.toFixed(2)} 与 ${sb.toFixed(2)}，差距在 ${SCORE_TIE_EPSILON} 内判平局`];
  }
  return [
    d > 0 ? "A" : "B",
    `分差判定：${d > 0 ? "A" : "B"} 侧得分 ${Math.max(sa, sb).toFixed(2)} 高于对方 ${Math.min(sa, sb).toFixed(2)}`,
  ];
}

/** Bradley-Terry 强度拟合（迭代 MLE；平局各计 0.5 胜；每对加 1 场虚拟平局做正则，低样本自动向均值收缩） */
function fitBradleyTerry(rows: BattleRowLite[], ids: number[]): Map<number, number> {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const wins = new Float64Array(n); // 加权胜场（平局 0.5）
  const games = new Float64Array(n * n); // 对战场次矩阵（含虚拟平局）
  for (const r of rows) {
    const i = idx.get(r.a);
    const j = idx.get(r.b);
    if (i === undefined || j === undefined) continue;
    games[i * n + j] += 1;
    games[j * n + i] += 1;
    if (r.winner === "A") wins[i] += 1;
    else if (r.winner === "B") wins[j] += 1;
    else { wins[i] += 0.5; wins[j] += 0.5; }
  }
  // 正则：每对虚拟平局（防止全胜/全负发散 + 样本少的模型评级收缩到均值附近）
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      games[i * n + j] += 1;
      wins[i] += 0.5;
    }
  }

  const r = new Float64Array(n).fill(1);
  for (let iter = 0; iter < 64; iter++) {
    const next = new Float64Array(n);
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      let denom = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        denom += games[i * n + j] / (r[i] + r[j]);
      }
      next[i] = denom > 0 ? wins[i] / denom : 1;
      maxDelta = Math.max(maxDelta, Math.abs(next[i] - r[i]));
    }
    r.set(next);
    if (maxDelta < 1e-8) break;
  }
  return new Map(ids.map((id, i) => [id, r[i]]));
}

function strengthsToElo(strength: Map<number, number>, ids: number[]): Map<number, number> {
  const vals = ids.map((id) => strength.get(id) ?? 1);
  const geo = Math.exp(vals.reduce((a, b) => a + Math.log(Math.max(b, 1e-12)), 0) / (vals.length || 1));
  return new Map(ids.map((id, i) => [id, ELO_ANCHOR + ELO_SCALE * Math.log10(Math.max(vals[i], 1e-12) / geo)]));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return ELO_ANCHOR;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 由对战记录计算各模型评级 + 95% bootstrap 置信区间 + 战绩。
 * 方法论对齐 LMArena 开源实现：Bradley-Terry 模型拟合 + 有放回重采样。
 */
export function computeRatings(rows: BattleRowLite[], modelIds: number[]): ModelRating[] {
  const ids = modelIds.length ? modelIds : [...new Set(rows.flatMap((r) => [r.a, r.b]))];
  if (ids.length === 0 || rows.length === 0) return [];

  const base = strengthsToElo(fitBradleyTerry(rows, ids), ids);

  // 战绩统计
  const stat = new Map(ids.map((id) => [id, { wins: 0, losses: 0, ties: 0 }]));
  for (const r of rows) {
    if (r.winner === "A") {
      stat.get(r.a)!.wins++;
      stat.get(r.b)!.losses++;
    } else if (r.winner === "B") {
      stat.get(r.b)!.wins++;
      stat.get(r.a)!.losses++;
    } else {
      stat.get(r.a)!.ties++;
      stat.get(r.b)!.ties++;
    }
  }

  // bootstrap 置信区间
  const samples = new Map(ids.map((id) => [id, [] as number[]]));
  const rng = mulberry32(stableHash(`bt-bootstrap::${rows.length}::${ids.join(",")}`));
  for (let b = 0; b < BOOTSTRAP_ROUNDS; b++) {
    const resample: BattleRowLite[] = new Array(rows.length);
    for (let k = 0; k < rows.length; k++) {
      resample[k] = rows[Math.floor(rng() * rows.length)];
    }
    const elo = strengthsToElo(fitBradleyTerry(resample, ids), ids);
    for (const id of ids) samples.get(id)!.push(elo.get(id) ?? ELO_ANCHOR);
  }

  return ids
    .map((id) => {
      const s = stat.get(id)!;
      const total = s.wins + s.losses + s.ties;
      const sorted = samples.get(id)!.slice().sort((x, y) => x - y);
      return {
        modelId: id,
        rating: Math.round((base.get(id) ?? ELO_ANCHOR) * 10) / 10,
        ciLow: Math.round(percentile(sorted, 0.025) * 10) / 10,
        ciHigh: Math.round(percentile(sorted, 0.975) * 10) / 10,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        battlesCount: total,
        winRate: total ? Math.round(((s.wins + s.ties * 0.5) / total) * 1000) / 1000 : 0,
      };
    })
    .sort((a, b) => b.rating - a.rating);
}

/** 两两胜率矩阵（i 行 j 列 = i 对 j 的战绩） */
export function winMatrix(rows: BattleRowLite[], ids: number[]): PairwiseCell[] {
  const cells: PairwiseCell[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const aId = ids[i];
      const bId = ids[j];
      const rel = rows.filter((r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId));
      let aWins = 0;
      let bWins = 0;
      let ties = 0;
      for (const r of rel) {
        if (r.winner === "tie") ties++;
        else if ((r.winner === "A" && r.a === aId) || (r.winner === "B" && r.b === aId)) aWins++;
        else bWins++;
      }
      cells.push({ modelAId: aId, modelBId: bId, aWins, bWins, ties, total: rel.length });
    }
  }
  return cells;
}

/** 读取对战记录（可跨运行） */
async function loadBattleRows(runId?: number): Promise<BattleRowLite[]> {
  const db = getDb();
  const rows = runId
    ? await db.select().from(battles).where(eq(battles.runId, runId))
    : await db.select().from(battles).orderBy(desc(battles.id)).limit(20000);
  return rows.map((r) => ({
    a: r.modelAId,
    b: r.modelBId,
    winner: (r.winner === "A" || r.winner === "B" ? r.winner : "tie") as "A" | "B" | "tie",
  }));
}

/** 单次运行的竞技场视图：评级 + 胜率矩阵 + 判定方式统计 */
export async function arenaForRun(runId: number) {
  const db = getDb();
  const rows = await loadBattleRows(runId);
  const rawRows = await db.select().from(battles).where(eq(battles.runId, runId));
  const modelIds = [...new Set(rows.flatMap((r) => [r.a, r.b]))].sort((x, y) => x - y);
  const ms = modelIds.length
    ? await db.select().from(models).where(inArray(models.id, modelIds))
    : [];
  const nameMap = new Map(ms.map((m) => [m.id, m.name]));
  const methodCount = rawRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.method] = (acc[r.method] ?? 0) + 1;
    return acc;
  }, {});
  return {
    total: rawRows.length,
    methods: methodCount,
    ratings: computeRatings(rows, modelIds).map((r) => ({ ...r, modelName: nameMap.get(r.modelId) ?? `#${r.modelId}` })),
    matrix: winMatrix(rows, modelIds).map((c) => ({
      ...c,
      modelAName: nameMap.get(c.modelAId) ?? `#${c.modelAId}`,
      modelBName: nameMap.get(c.modelBId) ?? `#${c.modelBId}`,
    })),
  };
}

/** 全局排行榜：聚合全部运行的对战 + 各模型近期平均总分 */
export async function globalLeaderboard() {
  const db = getDb();
  const rows = await loadBattleRows();
  const modelIds = [...new Set(rows.flatMap((r) => [r.a, r.b]))].sort((x, y) => x - y);
  const ms = modelIds.length
    ? await db.select().from(models).where(inArray(models.id, modelIds))
    : [];
  const nameMap = new Map(ms.map((m) => [m.id, m.name]));

  // 近期运行的平均总分（最多 20 次）
  const completed = await db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.status, "completed"))
    .orderBy(desc(runs.id))
    .limit(20);
  const totalsByModel = new Map<number, number[]>();
  const runsByModel = new Map<number, Set<number>>();
  // 复用逐题数据轻量计算：直接扫 runItems
  for (const r of completed) {
    const items = await db
      .select({ modelId: runItems.modelId, finalScore: runItems.finalScore, status: runItems.status })
      .from(runItems)
      .where(eq(runItems.runId, r.id));
    for (const it of items) {
      if (it.status !== "done" || it.finalScore === null) continue;
      const arr = totalsByModel.get(it.modelId) ?? [];
      arr.push(it.finalScore);
      totalsByModel.set(it.modelId, arr);
      const s = runsByModel.get(it.modelId) ?? new Set<number>();
      s.add(r.id);
      runsByModel.set(it.modelId, s);
    }
  }

  const ratings = computeRatings(rows, modelIds);
  return ratings.map((r) => ({
    ...r,
    modelName: nameMap.get(r.modelId) ?? `#${r.modelId}`,
    avgItemScore: (() => {
      const arr = totalsByModel.get(r.modelId) ?? [];
      return arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 1000) / 10 : null;
    })(),
    runsCount: runsByModel.get(r.modelId)?.size ?? 0,
  }));
}
