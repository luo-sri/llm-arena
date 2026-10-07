import { getDb } from "../queries/connection";
import { runs, runItems, runLogs, models, questions } from "@db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { callModel } from "./provider";
import { ruleScore, buildJudgePrompt, parseJudgeResponse } from "./scoring";
import { generateBattles } from "./arena";
import type { SuiteConfig } from "../../contracts/eval";
import type { ScoringType } from "../../contracts/eval";

interface RunControl {
  paused: boolean;
  cancelled: boolean;
  waiters: Array<() => void>;
}

const controls = new Map<number, RunControl>();
const activeWorkers = new Set<number>();
let recovered = false;

function control(runId: number): RunControl {
  let c = controls.get(runId);
  if (!c) {
    c = { paused: false, cancelled: false, waiters: [] };
    controls.set(runId, c);
  }
  return c;
}

export function isRunActive(runId: number): boolean {
  return activeWorkers.has(runId);
}

export async function log(runId: number, level: "info" | "warn" | "error", message: string) {
  await getDb().insert(runLogs).values({ runId, level, message: message.slice(0, 4000) });
}

/** 服务重启恢复：中断的运行标记为已暂停，执行中的题目重置为待执行，杜绝漏判 */
export async function recoverRunsOnce() {
  if (recovered) return;
  recovered = true;
  const db = getDb();
  await db.update(runs).set({ status: "paused" }).where(eq(runs.status, "running"));
  await db.update(runItems).set({ status: "pending" }).where(eq(runItems.status, "running"));
}

export async function pauseRun(runId: number) {
  control(runId).paused = true;
  await getDb().update(runs).set({ status: "paused" }).where(eq(runs.id, runId));
  await log(runId, "info", "运行已暂停（执行中的题目完成后挂起）");
}

export async function resumeRun(runId: number) {
  const c = control(runId);
  c.paused = false;
  c.cancelled = false;
  for (const w of c.waiters.splice(0)) w();
  await getDb().update(runs).set({ status: "running" }).where(eq(runs.id, runId));
  await log(runId, "info", "运行已继续");
  void startRun(runId);
}

export async function cancelRun(runId: number) {
  const c = control(runId);
  c.cancelled = true;
  c.paused = false;
  for (const w of c.waiters.splice(0)) w();
  await log(runId, "warn", "收到取消请求，正在停止…");
}

async function waitIfPaused(runId: number): Promise<boolean> {
  const c = control(runId);
  while (c.paused && !c.cancelled) {
    await new Promise<void>((resolve) => c.waiters.push(resolve));
  }
  return c.cancelled;
}

export async function recomputeRunCounts(runId: number) {
  const db = getDb();
  const [done] = await db
    .select({ n: sql<number>`count(*)` })
    .from(runItems)
    .where(and(eq(runItems.runId, runId), eq(runItems.status, "done")));
  const [failed] = await db
    .select({ n: sql<number>`count(*)` })
    .from(runItems)
    .where(and(eq(runItems.runId, runId), eq(runItems.status, "failed")));
  await db
    .update(runs)
    .set({ doneItems: Number(done.n), failedItems: Number(failed.n) })
    .where(eq(runs.id, runId));
}

/** 启动/接管运行的工作协程（幂等：已在执行则直接返回） */
export async function startRun(runId: number): Promise<void> {
  if (activeWorkers.has(runId)) return;
  activeWorkers.add(runId);
  const c = control(runId);
  c.cancelled = false;
  try {
    const db = getDb();
    const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (!run) return;
    const cfg = run.paramSnapshot as SuiteConfig;

    await db
      .update(runs)
      .set({ status: "running", startedAt: run.startedAt ?? new Date() })
      .where(eq(runs.id, runId));

    const concurrency = Math.max(1, Math.min(16, cfg.params.concurrency || 4));

    // 后台执行，不阻塞请求
    void (async () => {
      try {
        let cursor = 0;
        for (;;) {
          const cancelled = await waitIfPaused(runId);
          if (cancelled) break;

          const batch = await db
            .select()
            .from(runItems)
            .where(and(eq(runItems.runId, runId), eq(runItems.status, "pending")))
            .orderBy(runItems.seq, runItems.id)
            .limit(concurrency);

          if (batch.length === 0) {
            // 确认没有执行中的题目（单题重跑可能并行）
            const [pendingCount] = await db
              .select({ n: sql<number>`count(*)` })
              .from(runItems)
              .where(and(eq(runItems.runId, runId), eq(runItems.status, "pending")));
            if (Number(pendingCount.n) === 0) break;
            await new Promise((r) => setTimeout(r, 500));
            if (++cursor > 600) break; // 兜底防死循环
            continue;
          }

          await Promise.all(batch.map((item) => executeItem(runId, item.id, cfg)));
        }

        // 收尾
        await recomputeRunCounts(runId);
        const cc = control(runId);
        if (cc.cancelled) {
          await db
            .update(runItems)
            .set({ status: "skipped" })
            .where(and(eq(runItems.runId, runId), eq(runItems.status, "pending")));
          await db
            .update(runs)
            .set({ status: "cancelled", finishedAt: new Date() })
            .where(eq(runs.id, runId));
          await log(runId, "warn", "运行已取消，剩余题目标记为跳过");
        } else {
          const fresh = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
          if (fresh && fresh.status === "running") {
            const [pendingLeft] = await db
              .select({ n: sql<number>`count(*)` })
              .from(runItems)
              .where(and(eq(runItems.runId, runId), eq(runItems.status, "pending")));
            if (Number(pendingLeft.n) === 0) {
              await db
                .update(runs)
                .set({ status: "completed", finishedAt: new Date() })
                .where(eq(runs.id, runId));
              await log(runId, "info", `运行完成：成功 ${fresh.doneItems}，失败 ${fresh.failedItems}`);
              // 运行完成后自动生成竞技场两两对战（AI 裁决模式异步执行，不阻塞完成状态）
              void (async () => {
                try {
                  const { total, aiJudged } = await generateBattles(runId);
                  await log(
                    runId,
                    "info",
                    `竞技场对战已生成：${total} 场（${aiJudged > 0 ? `${aiJudged} 场 AI 裁决` : "全部按分差判定"}），Bradley-Terry 评级见「竞技场对战」与排行榜`,
                  );
                } catch (e) {
                  await log(runId, "warn", `竞技场对战生成失败：${e instanceof Error ? e.message : e}`);
                }
              })();
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await log(runId, "error", `调度器异常：${msg}`);
        await db.update(runs).set({ status: "failed", error: msg }).where(eq(runs.id, runId));
      } finally {
        activeWorkers.delete(runId);
      }
    })();
  } finally {
    // activeWorkers 在后台协程 finally 中清理
  }
}

/** 执行单题：调用模型（含超时与重试）→ 规则判分 → 模型评审 → 分歧进入人工复核 */
export async function executeItem(runId: number, itemId: number, cfg: SuiteConfig): Promise<void> {
  const db = getDb();
  const item = await db.query.runItems.findFirst({ where: eq(runItems.id, itemId) });
  if (!item || item.status !== "pending") return;
  const question = await db.query.questions.findFirst({ where: eq(questions.id, item.questionId) });
  const model = await db.query.models.findFirst({ where: eq(models.id, item.modelId) });
  if (!question || !model) {
    await db.update(runItems).set({ status: "failed", error: "题目或模型已被删除" }).where(eq(runItems.id, itemId));
    return;
  }

  if (await waitIfPaused(runId)) return;

  await db
    .update(runItems)
    .set({ status: "running", promptSent: question.prompt })
    .where(eq(runItems.id, itemId));

  // 调用模型：重试策略 = retries 次重试，指数退避
  let result: Awaited<ReturnType<typeof callModel>> | null = null;
  let lastError = "";
  let attempts = 0;
  const maxAttempts = cfg.params.retries + 1;
  for (; attempts < maxAttempts; attempts++) {
    if (control(runId).cancelled) {
      await db.update(runItems).set({ status: "pending" }).where(eq(runItems.id, itemId));
      return;
    }
    try {
      result = await callModel(model, question, cfg.params, item.repeatIndex);
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempts < maxAttempts - 1) {
        await log(runId, "warn", `[${model.name}] 题目#${question.id} 第 ${attempts + 1} 次调用失败：${lastError}，将重试`);
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempts)));
      }
    }
  }

  if (!result) {
    await db
      .update(runItems)
      .set({ status: "failed", error: `重试 ${maxAttempts} 次均失败：${lastError}`, retryCount: attempts - 1, finishedAt: new Date() })
      .where(eq(runItems.id, itemId));
    await log(runId, "error", `[${model.name}] 题目#${question.id} 失败：${lastError}`);
    await recomputeRunCounts(runId);
    return;
  }

  // 规则判分
  const rule = ruleScore(
    question.scoringType as ScoringType,
    (question.scoringConfig ?? {}) as Record<string, never>,
    question.expectedAnswer,
    result.text,
  );

  // 模型评审通道
  let judgeScore: number | null = null;
  let judgeReason: string | null = null;
  const judgeApplies = cfg.judgeEnabled && !!cfg.judgeModelId;
  if (judgeApplies && cfg.judgeModelId) {
    const judgeModel = await db.query.models.findFirst({ where: eq(models.id, cfg.judgeModelId) });
    if (judgeModel) {
      try {
        const judgePrompt = buildJudgePrompt(question, result.text);
        const jr = await callModel(
          judgeModel,
          { prompt: judgePrompt, expectedAnswer: null, scoringType: "judge", scoringConfig: null },
          { ...cfg.params, systemPrompt: "" },
          0,
        );
        const parsed = parseJudgeResponse(jr.text);
        if (parsed) {
          judgeScore = parsed.score;
          judgeReason = parsed.reason;
        } else {
          await log(runId, "warn", `[${model.name}] 题目#${question.id} 评审输出无法解析，仅采用规则分`);
        }
      } catch (e) {
        await log(runId, "warn", `[评审] 调用失败：${e instanceof Error ? e.message : e}，仅采用规则分`);
      }
    }
  }

  // 合成最终分
  let finalScore: number | null = null;
  let needsReview = false;
  if (question.scoringType === "judge") {
    finalScore = judgeScore ?? rule.score;
  } else if (rule.score !== null && judgeScore !== null) {
    // 双通道：取均值；分歧超阈值进入人工复核
    finalScore = Math.round(((rule.score + judgeScore) / 2) * 1000) / 1000;
    if (Math.abs(rule.score - judgeScore) >= cfg.reviewThreshold) needsReview = true;
  } else {
    finalScore = rule.score ?? judgeScore;
  }
  if (finalScore === null) needsReview = true; // 无任何通道得分必须人工处理，杜绝漏判

  await db
    .update(runItems)
    .set({
      status: "done",
      responseText: result.text,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      ruleScore: rule.score,
      judgeScore,
      judgeReason,
      finalScore,
      needsReview,
      retryCount: attempts - 1 < 0 ? 0 : attempts - 1,
      scoreDetail: { rule: rule.detail, judge: judgeReason, channel: question.scoringType === "judge" ? (judgeScore !== null ? "judge" : "rule-fallback") : judgeScore !== null ? "dual" : "rule" },
      finishedAt: new Date(),
    })
    .where(eq(runItems.id, itemId));
  await recomputeRunCounts(runId);
}

/** 单题重跑：重置后异步执行，不影响其他题目结果 */
export async function retryItem(itemId: number): Promise<void> {
  const db = getDb();
  const item = await db.query.runItems.findFirst({ where: eq(runItems.id, itemId) });
  if (!item) throw new Error("题目记录不存在");
  const run = await db.query.runs.findFirst({ where: eq(runs.id, item.runId) });
  if (!run) throw new Error("运行不存在");
  const cfg = run.paramSnapshot as SuiteConfig;
  await db
    .update(runItems)
    .set({
      status: "pending", responseText: null, latencyMs: null, promptTokens: null,
      completionTokens: null, ruleScore: null, judgeScore: null, judgeReason: null,
      finalScore: null, scoreDetail: null, error: null, retryCount: 0,
      needsReview: false, reviewScore: null, reviewNote: null, reviewedAt: null, finishedAt: null,
    })
    .where(eq(runItems.id, itemId));
  await log(item.runId, "info", `题目记录#${itemId} 已重置，开始单题重跑`);
  await recomputeRunCounts(item.runId);
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    // 独立执行该题，不重启整个运行
    void (async () => {
      await executeItem(item.runId, itemId, cfg);
      await recomputeRunCounts(item.runId);
      await log(item.runId, "info", `题目记录#${itemId} 重跑完成`);
    })();
  } else {
    void startRun(item.runId);
  }
}

/**
 * 批量重跑失败题目：把失败状态的记录重置为待执行并重新调度。
 * 用于上游限流 / 网络抖动导致的失败（并非模型回答错误），给模型一次公平的补考机会。
 * 可传 modelId 只重跑某个模型的失败项。
 */
export async function retryFailedItems(runId: number, modelId?: number): Promise<number> {
  const db = getDb();
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) throw new Error("运行不存在");

  const conds = [eq(runItems.runId, runId), eq(runItems.status, "failed")];
  if (modelId !== undefined) conds.push(eq(runItems.modelId, modelId));
  const failed = await db.select({ id: runItems.id }).from(runItems).where(and(...conds));
  if (failed.length === 0) return 0;

  const ids = failed.map((f) => f.id);
  await db
    .update(runItems)
    .set({
      status: "pending", responseText: null, latencyMs: null, promptTokens: null,
      completionTokens: null, ruleScore: null, judgeScore: null, judgeReason: null,
      finalScore: null, scoreDetail: null, error: null, retryCount: 0,
      needsReview: false, reviewScore: null, reviewNote: null, reviewedAt: null, finishedAt: null,
    })
    .where(inArray(runItems.id, ids));

  await log(runId, "info",
    `批量重跑失败题目：共 ${ids.length} 条${modelId !== undefined ? `（仅模型 #${modelId}）` : ""}，已重置为待执行`);
  await recomputeRunCounts(runId);

  // 运行已结束时需重新激活，否则调度器不会继续消费待执行项
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    await db
      .update(runs)
      .set({ status: "running", finishedAt: null, error: null })
      .where(eq(runs.id, runId));
  }
  void startRun(runId);
  return ids.length;
}
