import { z } from "zod";
import { eq, and, like, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { questions } from "@db/schema";
import { BANK_VERSION, CATEGORIES, SCORING_TYPES } from "../../contracts/eval";
import { computeBankHash } from "../engine/bank";
import { OFFLINE_PACKS, ONLINE_SOURCES, fetchOnlineQuestions, probeOnlineSource, type OpenBankQuestion } from "../engine/openBanks";

const questionInput = z.object({
  category: z.enum(CATEGORIES.map((c) => c.key) as [string, ...string[]]),
  difficulty: z.number().int().min(1).max(5).default(1),
  prompt: z.string().min(1, "题干不能为空"),
  expectedAnswer: z.string().nullable().optional(),
  scoringType: z.enum(SCORING_TYPES.map((s) => s.key) as [string, ...string[]]),
  scoringConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  rubric: z.string().nullable().optional(),
  weight: z.number().min(0.1).max(10).default(1),
});

/** 公开题库题目幂等导入：按题干与全库去重，来源标记 openbank:* */
async function insertOpenBankQuestions(items: OpenBankQuestion[], source: string) {
  const db = getDb();
  const existing = new Set(
    (await db.select({ prompt: questions.prompt }).from(questions)).map((r) => r.prompt),
  );
  const toInsert = items.filter((q) => !existing.has(q.prompt));
  for (let i = 0; i < toInsert.length; i += 100) {
    await db
      .insert(questions)
      .values(
        toInsert.slice(i, i + 100).map((q) => ({
          ...q,
          bankVersion: BANK_VERSION,
          source,
        })),
      );
  }
  return { inserted: toInsert.length, skipped: items.length - toInsert.length };
}

export const questionsRouter = createRouter({
  list: publicQuery
    .input(
      z.object({
        category: z.string().optional(),
        difficulty: z.number().int().min(1).max(5).optional(),
        search: z.string().optional(),
        source: z.string().optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.category) conds.push(eq(questions.category, input.category));
      if (input?.difficulty) conds.push(eq(questions.difficulty, input.difficulty));
      if (input?.source) conds.push(eq(questions.source, input.source));
      if (input?.search) conds.push(like(questions.prompt, `%${input.search}%`));
      return db
        .select()
        .from(questions)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(questions.category, questions.id);
    }),

  /** 题库信息：版本、内容哈希、各维度题量、各难度题量（公开可验证） */
  bankInfo: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({ category: questions.category, n: sql<number>`count(*)` })
      .from(questions)
      .groupBy(questions.category);
    const diffRows = await db
      .select({ difficulty: questions.difficulty, n: sql<number>`count(*)` })
      .from(questions)
      .groupBy(questions.difficulty);
    const all = await db.select().from(questions).orderBy(questions.id);
    return {
      version: BANK_VERSION,
      hash: computeBankHash(all),
      total: all.length,
      byCategory: Object.fromEntries(rows.map((r) => [r.category, Number(r.n)])),
      byDifficulty: Object.fromEntries(diffRows.map((r) => [String(r.difficulty), Number(r.n)])),
    };
  }),

  create: publicQuery.input(questionInput).mutation(async ({ input }) => {
    const db = getDb();
    const [{ id }] = await db
      .insert(questions)
      .values({ ...input, bankVersion: BANK_VERSION, source: "custom", expectedAnswer: input.expectedAnswer ?? null, scoringConfig: input.scoringConfig ?? null, rubric: input.rubric ?? null })
      .returning({ id: questions.id });
    return db.query.questions.findFirst({ where: eq(questions.id, id) });
  }),

  update: publicQuery
    .input(z.object({ id: z.number(), data: questionInput.partial() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(questions).set(input.data).where(eq(questions.id, input.id));
      return { ok: true };
    }),

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    const q = await db.query.questions.findFirst({ where: eq(questions.id, input.id) });
    if (!q) throw new Error("题目不存在");
    if (q.source === "builtin") throw new Error("内置公开题库题目不可删除（保证题库版本稳定），可在套件中调整各维度题量");
    await db.delete(questions).where(eq(questions.id, input.id));
    return { ok: true };
  }),

  /** 公开题库清单：离线精选包 + 在线同步源（含已收录/已导入统计） */
  openBanks: publicQuery.query(async () => {
    const db = getDb();
    const prompts = new Set(
      (await db.select({ prompt: questions.prompt }).from(questions)).map((r) => r.prompt),
    );
    const sourceRows = await db
      .select({ source: questions.source, n: sql<number>`count(*)` })
      .from(questions)
      .groupBy(questions.source);
    const bySource = new Map(sourceRows.map((r) => [r.source, Number(r.n)]));
    return {
      packs: OFFLINE_PACKS.map((p) => ({
        key: p.key,
        name: p.name,
        description: p.description,
        license: p.license,
        count: p.questions.length,
        imported: p.questions.filter((q) => prompts.has(q.prompt)).length,
        inDb: bySource.get(`openbank:${p.key}`) ?? 0,
        byCategory: Object.entries(
          p.questions.reduce<Record<string, number>>((acc, q) => {
            acc[q.category] = (acc[q.category] ?? 0) + 1;
            return acc;
          }, {}),
        ).map(([category, count]) => ({ category, count })),
      })),
      sources: ONLINE_SOURCES.map((s) => ({
        key: s.key,
        name: s.name,
        description: s.description,
        host: s.host,
        maxCount: s.maxCount,
        totalCap: s.totalCap,
        hasFallback: s.hasFallback,
        inDb: bySource.get(`openbank:${s.key}`) ?? 0,
      })),
    };
  }),

  /** 在线源可用性检测（打开同步面板时探测，不阻塞题库列表） */
  checkSource: publicQuery
    .input(z.object({ key: z.string() }))
    .mutation(async ({ input }) => {
      return probeOnlineSource(input.key);
    }),

  /** 离线精选包一键导入（按题干幂等去重） */
  syncOffline: publicQuery
    .input(z.object({ key: z.string() }))
    .mutation(async ({ input }) => {
      const pack = OFFLINE_PACKS.find((p) => p.key === input.key);
      if (!pack) throw new Error("离线包不存在");
      const { inserted, skipped } = await insertOpenBankQuestions(pack.questions, `openbank:${pack.key}`);
      return { name: pack.name, inserted, skipped, total: pack.questions.length };
    }),

  /** 在线源同步：实时拉取公开题库并去重导入（含累计上限防护，反复点击不会无限累积题目） */
  syncOnline: publicQuery
    .input(z.object({ key: z.string(), count: z.number().int().min(5).max(50).default(20) }))
    .mutation(async ({ input }) => {
      const source = ONLINE_SOURCES.find((s) => s.key === input.key);
      if (!source) throw new Error("在线源不存在");
      const db = getDb();
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(questions)
        .where(eq(questions.source, `openbank:${input.key}`));
      const current = Number(n);
      const remaining = source.totalCap - current;
      if (remaining <= 0) {
        throw new Error(
          `「${source.name}」已收录 ${current} 题，达到上限 ${source.totalCap} 题，已停止导入以保护系统（重复点击不会无限增加题目）。`,
        );
      }
      const want = Math.min(input.count, source.maxCount, remaining);
      const items = await fetchOnlineQuestions(input.key, want);
      const { inserted, skipped } = await insertOpenBankQuestions(items, `openbank:${input.key}`);
      const total = current + inserted;
      return {
        name: source.name,
        fetched: items.length,
        inserted,
        skipped,
        total,
        cap: source.totalCap,
        capped: total >= source.totalCap,
      };
    }),
});
