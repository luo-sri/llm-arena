import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { evalSuites } from "@db/schema";
import { DEFAULT_SUITE_CONFIG } from "../../contracts/eval";

const paramsSchema = z.object({
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(16).max(128000),
  timeoutMs: z.number().int().min(1000).max(600000),
  retries: z.number().int().min(0).max(5),
  repeatCount: z.number().int().min(1).max(10),
  seed: z.number().int().min(0).max(999999),
  concurrency: z.number().int().min(1).max(16),
  systemPrompt: z.string().max(2000),
});

const configSchema = z.object({
  categories: z.record(
    z.string(),
    z.object({
      enabled: z.boolean(),
      count: z.number().int().min(0).max(100),
      weight: z.number().min(0).max(10),
    }),
  ),
  /** 参与抽题的难度级别；缺省或空数组 = 全部 1~5 级 */
  levels: z.array(z.number().int().min(1).max(5)).max(5).optional(),
  judgeEnabled: z.boolean(),
  judgeModelId: z.number().nullable(),
  reviewThreshold: z.number().min(0).max(1),
  params: paramsSchema,
});

const suiteInput = z.object({
  name: z.string().min(1, "套件名称不能为空").max(128),
  description: z.string().max(2000).optional(),
  config: configSchema,
});

export const suitesRouter = createRouter({
  list: publicQuery.query(async () => {
    return getDb().query.evalSuites.findMany({ orderBy: (s, { asc }) => [asc(s.id)] });
  }),

  get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    return getDb().query.evalSuites.findFirst({ where: eq(evalSuites.id, input.id) });
  }),

  create: publicQuery.input(suiteInput).mutation(async ({ input }) => {
    const db = getDb();
    const [{ id }] = await db
      .insert(evalSuites)
      .values({ name: input.name, description: input.description ?? "", config: input.config })
      .returning({ id: evalSuites.id });
    return db.query.evalSuites.findFirst({ where: eq(evalSuites.id, id) });
  }),

  update: publicQuery
    .input(z.object({ id: z.number(), data: suiteInput.partial() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(evalSuites)
        .set({ ...input.data, updatedAt: new Date() })
        .where(eq(evalSuites.id, input.id));
      return { ok: true };
    }),

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(evalSuites).where(eq(evalSuites.id, input.id));
    return { ok: true };
  }),

  defaultConfig: publicQuery.query(() => DEFAULT_SUITE_CONFIG),
});
