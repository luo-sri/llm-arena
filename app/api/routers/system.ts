import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { models, modelGroups, evalSuites, questions, runs, runItems } from "@db/schema";

export const systemRouter = createRouter({
  /** 总览统计（仪表盘） */
  overview: publicQuery.query(async () => {
    const db = getDb();
    const [mc] = await db.select({ n: sql<number>`count(*)` }).from(models);
    const [qc] = await db.select({ n: sql<number>`count(*)` }).from(questions);
    const [rc] = await db.select({ n: sql<number>`count(*)` }).from(runs);
    const [cc] = await db.select({ n: sql<number>`count(*)` }).from(runs).where(eq(runs.status, "completed"));
    const [ic] = await db.select({ n: sql<number>`count(*)` }).from(runItems);
    const [rev] = await db.select({ n: sql<number>`count(*)` }).from(runItems).where(eq(runItems.needsReview, true));
    const [sc] = await db.select({ n: sql<number>`count(*)` }).from(evalSuites);
    return {
      models: Number(mc.n),
      questions: Number(qc.n),
      runs: Number(rc.n),
      completedRuns: Number(cc.n),
      items: Number(ic.n),
      pendingReviews: Number(rev.n),
      suites: Number(sc.n),
    };
  }),

  /** 配置备份导出：模型（含密钥）/分组/套件/自建题目 */
  exportConfig: publicQuery.query(async () => {
    const db = getDb();
    const [ms, gs, ss, qs] = await Promise.all([
      db.select().from(models),
      db.select().from(modelGroups),
      db.select().from(evalSuites),
      db.select().from(questions).where(eq(questions.source, "custom")),
    ]);
    return {
      format: "llm-eval-config",
      version: 1,
      exportedAt: new Date().toISOString(),
      groups: gs,
      models: ms,
      suites: ss,
      customQuestions: qs,
    };
  }),

  /** 配置导入：按名称去重合并，不覆盖现有数据 */
  importConfig: publicQuery
    .input(z.object({ payload: z.string().min(2) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      let data: {
        groups?: { name: string; color?: string; description?: string | null }[];
        models?: { name: string; provider?: string; baseUrl?: string; apiKey?: string; modelId: string; groupName?: string; inputPrice?: number; outputPrice?: number; notes?: string | null }[];
        suites?: { name: string; description?: string | null; config: unknown }[];
        customQuestions?: { category: string; difficulty?: number; prompt: string; expectedAnswer?: string | null; scoringType: string; scoringConfig?: unknown; rubric?: string | null; weight?: number }[];
      };
      try {
        const raw = JSON.parse(input.payload) as Record<string, unknown>;
        // 兼容导出格式（models 里带 groupId）与手写格式（groupName）
        const groups = (raw.groups ?? []) as { id?: number; name: string; color?: string; description?: string | null }[];
        const groupIdName = new Map(groups.map((g) => [g.id, g.name]));
        data = {
          groups,
          models: ((raw.models ?? []) as Record<string, unknown>[]).map((m) => ({
            ...(m as object),
            groupName: (m.groupName as string) ?? (m.groupId != null ? groupIdName.get(m.groupId as number) : undefined),
          })) as NonNullable<typeof data.models>,
          suites: raw.suites as typeof data.suites,
          customQuestions: raw.customQuestions as typeof data.customQuestions,
        };
      } catch {
        throw new Error("配置文件不是合法的 JSON");
      }

      const stats = { groups: 0, models: 0, suites: 0, questions: 0, skipped: 0 };

      const groupNameToId = new Map<string, number>();
      for (const g of data.groups ?? []) {
        if (!g.name) continue;
        const dup = await db.query.modelGroups.findFirst({ where: eq(modelGroups.name, g.name) });
        if (dup) {
          groupNameToId.set(g.name, dup.id);
          stats.skipped++;
          continue;
        }
        const [{ id }] = await db.insert(modelGroups).values({ name: g.name, color: g.color ?? "#f5b83d", description: g.description ?? null }).returning({ id: modelGroups.id });
        groupNameToId.set(g.name, id);
        stats.groups++;
      }

      for (const m of data.models ?? []) {
        if (!m.name || !m.modelId) continue;
        const dup = await db.query.models.findFirst({ where: eq(models.name, m.name) });
        if (dup) {
          stats.skipped++;
          continue;
        }
        await db.insert(models).values({
          name: m.name,
          provider: m.provider ?? "openai",
          baseUrl: m.baseUrl ?? "",
          apiKey: m.apiKey ?? "",
          modelId: m.modelId,
          groupId: m.groupName ? (groupNameToId.get(m.groupName) ?? null) : null,
          inputPrice: m.inputPrice ?? 0,
          outputPrice: m.outputPrice ?? 0,
          notes: m.notes ?? null,
        });
        stats.models++;
      }

      for (const s of data.suites ?? []) {
        if (!s.name || !s.config) continue;
        const dup = await db.query.evalSuites.findFirst({ where: eq(evalSuites.name, s.name) });
        if (dup) {
          stats.skipped++;
          continue;
        }
        await db.insert(evalSuites).values({ name: s.name, description: s.description ?? "", config: s.config });
        stats.suites++;
      }

      for (const q of data.customQuestions ?? []) {
        if (!q.prompt || !q.category || !q.scoringType) continue;
        const dup = await db.query.questions.findFirst({ where: eq(questions.prompt, q.prompt) });
        if (dup) {
          stats.skipped++;
          continue;
        }
        await db.insert(questions).values({
          bankVersion: "custom",
          category: q.category,
          difficulty: q.difficulty ?? 1,
          prompt: q.prompt,
          expectedAnswer: q.expectedAnswer ?? null,
          scoringType: q.scoringType,
          scoringConfig: (q.scoringConfig as object) ?? null,
          rubric: q.rubric ?? null,
          weight: q.weight ?? 1,
          source: "custom",
        });
        stats.questions++;
      }

      return stats;
    }),
});
