import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { models, modelGroups } from "@db/schema";
import { callModel } from "../engine/provider";
import { ensureMockModels } from "@db/init";
import { DEFAULT_PARAMS } from "../../contracts/eval";

const modelInput = z.object({
  name: z.string().min(1, "名称不能为空").max(128),
  provider: z.enum(["openai", "mock"]).default("openai"),
  baseUrl: z.string().max(512).default(""),
  apiKey: z.string().max(512).default(""),
  modelId: z.string().min(1, "模型标识不能为空").max(256),
  groupId: z.number().nullable().optional(),
  inputPrice: z.number().min(0).default(0),
  outputPrice: z.number().min(0).default(0),
  enabled: z.boolean().default(true),
  notes: z.string().max(2000).optional(),
});

const batchItem = z.object({
  name: z.string().min(1).max(128),
  baseUrl: z.string().default(""),
  apiKey: z.string().default(""),
  modelId: z.string().min(1),
  groupName: z.string().optional(),
  provider: z.enum(["openai", "mock"]).default("openai"),
});

export const modelsRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    const ms = await db.query.models.findMany({ with: { group: true } });
    const groups = await db.query.modelGroups.findMany();
    return {
      models: ms.map((m) => ({
        ...m,
        apiKeyMasked: m.apiKey ? `${m.apiKey.slice(0, 4)}****${m.apiKey.slice(-4)}` : "",
      })),
      groups,
    };
  }),

  create: publicQuery.input(modelInput).mutation(async ({ input }) => {
    const db = getDb();
    const [{ id }] = await db.insert(models).values(input).returning({ id: models.id });
    return db.query.models.findFirst({ where: eq(models.id, id) });
  }),

  update: publicQuery
    .input(z.object({ id: z.number(), data: modelInput.partial() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(models)
        .set({ ...input.data, updatedAt: new Date() })
        .where(eq(models.id, input.id));
      return db.query.models.findFirst({ where: eq(models.id, input.id) });
    }),

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(models).where(eq(models.id, input.id));
    return { ok: true };
  }),

  /** 批量导入：支持分组名自动建组，按 名称+模型标识 去重 */
  importBatch: publicQuery
    .input(z.object({ items: z.array(batchItem).min(1, "至少导入一个模型").max(200) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      let created = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const item of input.items) {
        try {
          let groupId: number | null = null;
          if (item.groupName?.trim()) {
            const gname = item.groupName.trim();
            let g = await db.query.modelGroups.findFirst({ where: eq(modelGroups.name, gname) });
            if (!g) {
              const [{ id }] = await db.insert(modelGroups).values({ name: gname }).returning({ id: modelGroups.id });
              g = (await db.query.modelGroups.findFirst({ where: eq(modelGroups.id, id) }))!;
            }
            groupId = g.id;
          }
          const dup = await db.query.models.findFirst({ where: eq(models.name, item.name) });
          if (dup) {
            skipped++;
            continue;
          }
          await db.insert(models).values({
            name: item.name,
            provider: item.provider,
            baseUrl: item.baseUrl,
            apiKey: item.apiKey,
            modelId: item.modelId,
            groupId,
          });
          created++;
        } catch (e) {
          errors.push(`${item.name}: ${e instanceof Error ? e.message : e}`);
        }
      }
      return { created, skipped, errors };
    }),

  /** 一键补齐内置测试模型（四档位，自检/演示用，无需密钥、零额度消耗） */
  addMockModels: publicQuery.mutation(async () => {
    return ensureMockModels();
  }),

  /** 连接测试：真实调用一次接口，记录时延与错误 */
  test: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    const model = await db.query.models.findFirst({ where: eq(models.id, input.id) });
    if (!model) throw new Error("模型不存在");
    try {
      const r = await callModel(
        model,
        { prompt: "请回答：1+1等于几？只回答数字。", expectedAnswer: "2", scoringType: "numeric", scoringConfig: null },
        { ...DEFAULT_PARAMS, timeoutMs: 30000, retries: 0 },
        0,
      );
      await db
        .update(models)
        .set({ lastTestStatus: "ok", lastTestLatencyMs: r.latencyMs, lastTestError: null, lastTestedAt: new Date() })
        .where(eq(models.id, input.id));
      return { ok: true as const, latencyMs: r.latencyMs, sample: r.text.slice(0, 200) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .update(models)
        .set({ lastTestStatus: "fail", lastTestError: msg, lastTestedAt: new Date() })
        .where(eq(models.id, input.id));
      return { ok: false as const, error: msg };
    }
  }),

  // ─── 分组管理 ───
  createGroup: publicQuery
    .input(z.object({ name: z.string().min(1).max(128), color: z.string().max(16).default("#f5b83d"), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [{ id }] = await db.insert(modelGroups).values(input).returning({ id: modelGroups.id });
      return db.query.modelGroups.findFirst({ where: eq(modelGroups.id, id) });
    }),

  updateGroup: publicQuery
    .input(z.object({ id: z.number(), name: z.string().min(1).max(128), color: z.string().max(16).optional(), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(modelGroups)
        .set({ name: input.name, color: input.color, description: input.description })
        .where(eq(modelGroups.id, input.id));
      return { ok: true };
    }),

  removeGroup: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    await db.update(models).set({ groupId: null }).where(eq(models.groupId, input.id));
    await db.delete(modelGroups).where(eq(modelGroups.id, input.id));
    return { ok: true };
  }),
});
