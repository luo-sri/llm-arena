import { z } from "zod";
import { eq, and, isNull, desc, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { reports, runs, runItems, questions, models } from "@db/schema";
import { DISCLAIMER, CATEGORY_MAP } from "../../contracts/eval";
import { summarizeRun } from "../engine/aggregate";
import { arenaForRun } from "../engine/arena";

export const reportsRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(reports).orderBy(desc(reports.id)).limit(50);
    const runIds = [...new Set(rows.map((r) => r.runId))];
    const rs = runIds.length ? await db.select().from(runs).where(inArray(runs.id, runIds)) : [];
    const rMap = new Map(rs.map((r) => [r.id, r]));
    return rows.map((r) => ({ ...r, runName: rMap.get(r.runId)?.name ?? `#${r.runId}` }));
  }),

  /** 一键生成可公开分享的评测报告 */
  generate: publicQuery
    .input(z.object({ runId: z.number(), title: z.string().max(255).optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const run = await db.query.runs.findFirst({ where: eq(runs.id, input.runId) });
      if (!run) throw new Error("运行不存在");
      const shareId = randomUUID();
      const [{ id }] = await db
        .insert(reports)
        .values({
          runId: input.runId,
          shareId,
          title: input.title || `${run.name} — 评测报告`,
        })
        .returning({ id: reports.id });
      return { id, shareId };
    }),

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(reports).where(eq(reports.id, input.id));
    return { ok: true };
  }),

  /** 公开访问（无需登录）：完整报告数据，含题库版本/参数快照/逐题明细/免责声明 */
  getByShare: publicQuery.input(z.object({ shareId: z.string() })).query(async ({ input }) => {
    const db = getDb();
    const report = await db.query.reports.findFirst({ where: eq(reports.shareId, input.shareId) });
    if (!report) throw new Error("报告不存在或已删除");
    const run = await db.query.runs.findFirst({ where: eq(runs.id, report.runId) });
    if (!run) throw new Error("关联运行已删除");
    const summaries = await summarizeRun(run.id);
    const arena = await arenaForRun(run.id);

    const items = await db.select().from(runItems).where(eq(runItems.runId, run.id));
    const qIds = [...new Set(items.map((i) => i.questionId))];
    const mIds = [...new Set(items.map((i) => i.modelId))];
    const qs = qIds.length ? await db.select().from(questions).where(inArray(questions.id, qIds)) : [];
    const ms = mIds.length ? await db.select().from(models).where(inArray(models.id, mIds)) : [];
    const qMap = new Map(qs.map((q) => [q.id, q]));
    const mMap = new Map(ms.map((m) => [m.id, m]));

    return {
      title: report.title,
      createdAt: report.createdAt,
      shareId: report.shareId,
      run: {
        id: run.id,
        name: run.name,
        status: run.status,
        seed: run.seed,
        bankVersion: run.bankVersion,
        bankHash: run.bankHash,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        paramSnapshot: run.paramSnapshot,
        totalItems: run.totalItems,
        doneItems: run.doneItems,
        failedItems: run.failedItems,
      },
      summaries,
      arena,
      categoryNames: CATEGORY_MAP,
      items: items.map((i) => ({
        id: i.id,
        modelName: mMap.get(i.modelId)?.name ?? `#${i.modelId}`,
        repeatIndex: i.repeatIndex,
        seq: i.seq,
        status: i.status,
        category: qMap.get(i.questionId)?.category ?? "",
        difficulty: qMap.get(i.questionId)?.difficulty ?? 1,
        prompt: qMap.get(i.questionId)?.prompt ?? "",
        expectedAnswer: qMap.get(i.questionId)?.expectedAnswer ?? null,
        scoringType: qMap.get(i.questionId)?.scoringType ?? "",
        rubric: qMap.get(i.questionId)?.rubric ?? null,
        responseText: i.responseText,
        latencyMs: i.latencyMs,
        ruleScore: i.ruleScore,
        judgeScore: i.judgeScore,
        finalScore: i.finalScore,
        reviewScore: i.reviewScore,
        reviewNote: i.reviewNote,
        needsReview: i.needsReview,
        error: i.error,
        retryCount: i.retryCount,
      })),
      disclaimer: DISCLAIMER,
    };
  }),

  /** 人工复核队列：双通道分歧题 + 无通道得分题 */
  reviewQueue: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(runItems)
      .where(and(eq(runItems.needsReview, true), isNull(runItems.reviewedAt)))
      .orderBy(desc(runItems.id))
      .limit(200);
    const qIds = [...new Set(rows.map((r) => r.questionId))];
    const mIds = [...new Set(rows.map((r) => r.modelId))];
    const rIds = [...new Set(rows.map((r) => r.runId))];
    const qs = qIds.length ? await db.select().from(questions).where(inArray(questions.id, qIds)) : [];
    const ms = mIds.length ? await db.select().from(models).where(inArray(models.id, mIds)) : [];
    const rs = rIds.length ? await db.select().from(runs).where(inArray(runs.id, rIds)) : [];
    const qMap = new Map(qs.map((q) => [q.id, q]));
    const mMap = new Map(ms.map((m) => [m.id, m]));
    const rMap = new Map(rs.map((r) => [r.id, r]));
    return rows.map((r) => ({
      ...r,
      question: qMap.get(r.questionId) ?? null,
      modelName: mMap.get(r.modelId)?.name ?? `#${r.modelId}`,
      runName: rMap.get(r.runId)?.name ?? `#${r.runId}`,
    }));
  }),

  /** 提交人工复核：复核分覆盖最终分 */
  submitReview: publicQuery
    .input(
      z.object({
        itemId: z.number(),
        score: z.number().min(0).max(1),
        note: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const item = await db.query.runItems.findFirst({ where: eq(runItems.id, input.itemId) });
      if (!item) throw new Error("记录不存在");
      await db
        .update(runItems)
        .set({
          reviewScore: input.score,
          reviewNote: input.note ?? null,
          reviewedAt: new Date(),
          needsReview: false,
          finalScore: input.score,
        })
        .where(eq(runItems.id, input.itemId));
      return { ok: true };
    }),
});
