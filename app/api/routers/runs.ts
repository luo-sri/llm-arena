import { z } from "zod";
import { eq, and, desc, gt, sql, inArray } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { runs, runItems, runLogs, questions, models, evalSuites, battles, reports } from "@db/schema";
import { BANK_VERSION, type SuiteConfig } from "../../contracts/eval";
import { computeBankHash } from "../engine/bank";
import { seededShuffle } from "../engine/random";
import { selectQuestions, describeLevels } from "../engine/selection";
import { startRun, pauseRun, resumeRun, cancelRun, retryItem, retryFailedItems, recomputeRunCounts, log, recoverRunsOnce, isRunActive } from "../engine/scheduler";
import { summarizeRun } from "../engine/aggregate";
import { arenaForRun, generateBattles, globalLeaderboard } from "../engine/arena";

export const runsRouter = createRouter({
  /** 创建并启动评测运行：所有模型使用相同题目、相同顺序、相同参数（快照固化） */
  create: publicQuery
    .input(
      z.object({
        name: z.string().min(1).max(128),
        suiteId: z.number(),
        modelIds: z.array(z.number()).min(1, "至少选择一个模型"),
        /** 评审通道覆盖：suite=跟随套件配置 / machine=强制机器规则判分 / model=指定评审模型 */
        judgeOverride: z.enum(["suite", "machine", "model"]).optional(),
        judgeModelId: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await recoverRunsOnce();
      const suite = await db.query.evalSuites.findFirst({ where: eq(evalSuites.id, input.suiteId) });
      if (!suite) throw new Error("测试套件不存在");
      // 深拷贝套件配置，按本次运行的选择覆盖评审通道（快照固化，后续套件改动不影响本次运行）
      const cfg: SuiteConfig = JSON.parse(JSON.stringify(suite.config));
      if (input.judgeOverride === "machine") {
        cfg.judgeEnabled = false;
        cfg.judgeModelId = null;
      } else if (input.judgeOverride === "model") {
        if (!input.judgeModelId) throw new Error("已选择指定评审模型，但未传入评审模型");
        cfg.judgeEnabled = true;
        cfg.judgeModelId = input.judgeModelId;
      }
      const seed = cfg.params.seed;

      const selectedModels = await db.select().from(models).where(inArray(models.id, input.modelIds));
      if (selectedModels.length === 0) throw new Error("未找到所选模型");
      const disabled = selectedModels.filter((m) => !m.enabled);
      if (disabled.length > 0) throw new Error(`以下模型已停用：${disabled.map((m) => m.name).join("、")}`);
      let judgeName = "";
      if (cfg.judgeEnabled && cfg.judgeModelId) {
        const jm = await db.query.models.findFirst({ where: eq(models.id, cfg.judgeModelId) });
        if (!jm) throw new Error("评审模型不存在，请重新选择");
        if (!jm.enabled) throw new Error(`评审模型「${jm.name}」已停用，请先启用或更换`);
        // 选手/裁判回避：评审模型不可同时作为受测模型，杜绝自评自高分
        if (input.modelIds.includes(cfg.judgeModelId)) {
          throw new Error(
            `评审模型「${jm.name}」同时被选为受测模型，违反「选手/裁判回避」原则；请更换评审模型、取消勾选该受测模型，或改用机器审核`,
          );
        }
        judgeName = jm.name;
      }

      // 选题：启用维度 + 难度分层 + 题量限制（按种子确定性抽样，所有模型同一套题）
      const allQuestions = await db.select().from(questions).orderBy(questions.id);
      const chosen = selectQuestions(allQuestions, cfg, seed);
      if (chosen.length === 0) {
        throw new Error(`所选维度在「${describeLevels(cfg.levels)}」下没有题目，请放宽难度分层或启用更多维度`);
      }

      // 固定题目顺序：同一种子 → 同一顺序 → 所有模型顺序一致
      const ordered = seededShuffle(chosen, seed + 1);
      const bankHash = computeBankHash(ordered);
      const repeatCount = cfg.params.repeatCount;
      const totalItems = ordered.length * selectedModels.length * repeatCount;

      const [{ id: runId }] = await db
        .insert(runs)
        .values({
          name: input.name,
          suiteId: input.suiteId,
          suiteName: suite.name,
          status: "pending",
          seed,
          paramSnapshot: cfg,
          bankVersion: BANK_VERSION,
          bankHash,
          totalItems,
        })
        .returning({ id: runs.id });

      const itemValues: {
        runId: number;
        modelId: number;
        questionId: number;
        repeatIndex: number;
        seq: number;
        status: "pending";
      }[] = [];
      for (const model of selectedModels) {
        for (let r = 0; r < repeatCount; r++) {
          ordered.forEach((q, seq) => {
            itemValues.push({
              runId,
              modelId: model.id,
              questionId: q.id,
              repeatIndex: r,
              seq,
              status: "pending" as const,
            });
          });
        }
      }
      // 分批插入
      for (let i = 0; i < itemValues.length; i += 500) {
        await db.insert(runItems).values(itemValues.slice(i, i + 500));
      }

      const judgeDesc = cfg.judgeEnabled && cfg.judgeModelId
        ? `AI 评审「${judgeName}」#${cfg.judgeModelId}`
        : "机器审核（公开规则判分）";
      const overrideNote =
        input.judgeOverride && input.judgeOverride !== "suite" ? "（本次运行已覆盖套件配置）" : "";
      await log(runId, "info",
        `运行创建：${selectedModels.length} 个模型 × ${ordered.length} 题 × ${repeatCount} 轮 = ${totalItems} 项；` +
        `难度分层=${describeLevels(cfg.levels)}；` +
        `种子=${seed}，温度=${cfg.params.temperature}，maxTokens=${cfg.params.maxTokens}，超时=${cfg.params.timeoutMs}ms，重试=${cfg.params.retries}，并发=${cfg.params.concurrency}；` +
        `题库 ${BANK_VERSION}#${bankHash}；评审=${judgeDesc}${overrideNote}`);

      void startRun(runId);
      return { runId, totalItems };
    }),

  list: publicQuery.query(async () => {
    await recoverRunsOnce();
    const db = getDb();
    const rows = await db.select().from(runs).orderBy(desc(runs.id)).limit(50);
    return rows.map((r) => ({ ...r, active: isRunActive(r.id) }));
  }),

  get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const run = await db.query.runs.findFirst({ where: eq(runs.id, input.id) });
    if (!run) throw new Error("运行不存在");
    return { ...run, active: isRunActive(run.id) };
  }),

  /** 运行结果汇总：总分/排名/维度/时延/稳定性/成功率/成本 */
  summary: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    return summarizeRun(input.id);
  }),

  pause: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await pauseRun(input.id);
    return { ok: true };
  }),

  resume: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await resumeRun(input.id);
    return { ok: true };
  }),

  cancel: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await cancelRun(input.id);
    return { ok: true };
  }),

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    await cancelRun(input.id);
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(runLogs).where(eq(runLogs.runId, input.id));
    await db.delete(runItems).where(eq(runItems.runId, input.id));
    await db.delete(battles).where(eq(battles.runId, input.id));
    await db.delete(runs).where(eq(runs.id, input.id));
    return { ok: true };
  }),

  /**
   * 一键清空全部运行记录：级联删除明细、日志、战报与由运行生成的报告。
   * 存在进行中（排队/运行/暂停）的运行时会拒绝，避免后台任务写到已删除的运行上。
   * 题库、模型、套件与人工复核配置不受影响。
   */
  clearAll: publicQuery.mutation(async () => {
    await recoverRunsOnce();
    const db = getDb();
    const all = await db.select({ id: runs.id, status: runs.status }).from(runs);
    if (all.length === 0) return { deleted: 0, reports: 0, skipped: 0 };
    const active = all.filter((r) => r.status === "pending" || r.status === "running" || r.status === "paused");
    if (active.length > 0) {
      throw new Error(`仍有 ${active.length} 个运行处于进行中（排队/运行/暂停），请先全部取消或等待完成后再清空`);
    }
    // 先取消残留的后台任务，确保没有写入竞争
    for (const r of all) await cancelRun(r.id);
    await new Promise((r) => setTimeout(r, 300));
    const ids = all.map((r) => r.id);
    await db.delete(runLogs).where(inArray(runLogs.runId, ids));
    await db.delete(runItems).where(inArray(runItems.runId, ids));
    await db.delete(battles).where(inArray(battles.runId, ids));
    // 报告由运行生成：运行全清后报告必然失效，连同历史遗留的孤儿报告一并清除
    const reportCount = (await db.select({ id: reports.id }).from(reports)).length;
    await db.delete(reports);
    await db.delete(runs).where(inArray(runs.id, ids));
    return { deleted: ids.length, reports: reportCount, skipped: 0 };
  }),

  /** 单次运行的竞技场视图：Bradley-Terry 评级 + 置信区间 + 两两胜率矩阵 */
  arena: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    return arenaForRun(input.id);
  }),

  /** 全局竞技场排行榜：聚合全部运行对战记录的评级与战绩 */
  leaderboard: publicQuery.query(async () => {
    return globalLeaderboard();
  }),

  /** 手动重新生成对战（单题重跑或人工复核后使用；幂等：先清空旧战报） */
  regenBattles: publicQuery.input(z.object({ runId: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    const run = await db.query.runs.findFirst({ where: eq(runs.id, input.runId) });
    if (!run) throw new Error("运行不存在");
    if (run.status !== "completed" && run.status !== "cancelled" && run.status !== "failed") {
      throw new Error("仅已完成的运行可重新生成对战");
    }
    const { total, aiJudged } = await generateBattles(input.runId);
    await log(input.runId, "info", `竞技场对战已重建：${total} 场（${aiJudged > 0 ? `${aiJudged} 场 AI 裁决` : "全部按分差判定"}）`);
    return { total, aiJudged };
  }),

  /** 实时日志（增量拉取） */
  logs: publicQuery
    .input(z.object({ runId: z.number(), sinceId: z.number().default(0) }))
    .query(async ({ input }) => {
      return getDb()
        .select()
        .from(runLogs)
        .where(and(eq(runLogs.runId, input.runId), gt(runLogs.id, input.sinceId)))
        .orderBy(runLogs.id)
        .limit(300);
    }),

  /** 逐题明细（分页）：返回当前页记录与筛选后的总数 */
  items: publicQuery
    .input(
      z.object({
        runId: z.number(),
        modelId: z.number().optional(),
        status: z.string().optional(),
        needsReview: z.boolean().optional(),
        limit: z.number().int().min(1).max(1000).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [eq(runItems.runId, input.runId)];
      if (input.modelId) conds.push(eq(runItems.modelId, input.modelId));
      if (input.status) conds.push(eq(runItems.status, input.status));
      if (input.needsReview !== undefined) conds.push(eq(runItems.needsReview, input.needsReview));
      const where = and(...conds);
      const [countRow] = await db
        .select({ n: sql<number>`count(*)` })
        .from(runItems)
        .where(where);
      const rows = await db
        .select()
        .from(runItems)
        .where(where)
        .orderBy(runItems.seq, runItems.modelId, runItems.repeatIndex)
        .limit(input.limit)
        .offset(input.offset);
      const qIds = [...new Set(rows.map((r) => r.questionId))];
      const mIds = [...new Set(rows.map((r) => r.modelId))];
      const qs = qIds.length ? await db.select().from(questions).where(inArray(questions.id, qIds)) : [];
      const ms = mIds.length ? await db.select().from(models).where(inArray(models.id, mIds)) : [];
      const qMap = new Map(qs.map((q) => [q.id, q]));
      const mMap = new Map(ms.map((m) => [m.id, m]));
      return {
        rows: rows.map((r) => ({
          ...r,
          question: qMap.get(r.questionId) ?? null,
          modelName: mMap.get(r.modelId)?.name ?? `#${r.modelId}`,
        })),
        total: Number(countRow.n),
      };
    }),

  retryItem: publicQuery.input(z.object({ itemId: z.number() })).mutation(async ({ input }) => {
    await retryItem(input.itemId);
    return { ok: true };
  }),

  /** 批量重跑失败题目：给上游限流/网络抖动导致的失败一次补考机会 */
  retryFailed: publicQuery
    .input(z.object({ runId: z.number(), modelId: z.number().optional() }))
    .mutation(async ({ input }) => {
      const retried = await retryFailedItems(input.runId, input.modelId);
      return { retried };
    }),

  recount: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await recomputeRunCounts(input.id);
    return { ok: true };
  }),

  /** 历史趋势：最近 N 次已完成运行的各模型总分 */
  history: publicQuery
    .input(z.object({ limit: z.number().int().min(1).max(20).default(10) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const completed = await db
        .select()
        .from(runs)
        .where(eq(runs.status, "completed"))
        .orderBy(desc(runs.id))
        .limit(input?.limit ?? 10);
      const out = [];
      for (const run of completed.reverse()) {
        const summaries = await summarizeRun(run.id);
        out.push({
          runId: run.id,
          name: run.name,
          finishedAt: run.finishedAt,
          totals: Object.fromEntries(summaries.map((s) => [s.modelName, s.total])),
        });
      }
      return out;
    }),

  /** 版本对比：两次运行逐模型逐维度对比 */
  compare: publicQuery
    .input(z.object({ runIdA: z.number(), runIdB: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [a, b] = await Promise.all([
        db.query.runs.findFirst({ where: eq(runs.id, input.runIdA) }),
        db.query.runs.findFirst({ where: eq(runs.id, input.runIdB) }),
      ]);
      if (!a || !b) throw new Error("运行不存在");
      const [sumA, sumB] = await Promise.all([summarizeRun(a.id), summarizeRun(b.id)]);
      return { runA: a, runB: b, summaryA: sumA, summaryB: sumB };
    }),

  countByStatus: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db.select({ status: runs.status, n: sql<number>`count(*)` }).from(runs).groupBy(runs.status);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }),
});
