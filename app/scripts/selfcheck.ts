/**
 * 端到端自检脚本：npx tsx scripts/selfcheck.ts
 * 1. 数据库连接检查
 * 2. 确保内置题库与模拟模型就绪
 * 3. 创建迷你套件（3 维度 × 2 题 × 2 轮）并发起真实评测运行
 * 4. 轮询直至完成，校验汇总结果与公平性不变量
 * 5. 专业指标（难度分层 / pass@k / 置信区间）
 * 6. 竞技场对战（生成 / Bradley-Terry 评级 / 排行榜 / 幂等重建）
 */
import { appRouter } from "../api/router";
import { getDb, getReadyDb } from "../api/queries/connection";
import { questions, models } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { DEFAULT_SUITE_CONFIG, type SuiteConfig } from "../contracts/eval";

const caller = appRouter.createCaller({
  req: new Request("http://selfcheck.local"),
  resHeaders: new Headers(),
});

function ok(name: string, cond: boolean, extra = "") {
  if (cond) console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`);
  else {
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log("== 多模型评测系统 · 端到端自检 ==\n");

  // 1. 数据库
  console.log("[1/6] 数据库连接");
  const db = await getReadyDb();
  const [qc] = await db.select({ n: sql<number>`count(*)` }).from(questions);
  ok("数据库可连接", Number(qc.n) > 0, `题库共 ${Number(qc.n)} 题`);

  // 2. 模拟模型
  console.log("[2/6] 模拟模型与连接测试");
  await caller.models.addMockModels();
  const { models: allModels } = await caller.models.list();
  const mocks = allModels.filter((m) => m.provider === "mock" && m.enabled);
  ok("模拟模型就绪", mocks.length >= 2, `${mocks.length} 个`);
  const t = await caller.models.test({ id: mocks[0].id });
  ok("连接测试通过", t.ok, t.ok ? `${t.latencyMs}ms` : "");

  // 3. 迷你套件
  console.log("[3/6] 创建迷你套件（逻辑/数学/指令 × 2 题 × 2 轮，种子固定）");
  const cfg: SuiteConfig = JSON.parse(JSON.stringify(DEFAULT_SUITE_CONFIG));
  for (const k of Object.keys(cfg.categories)) {
    cfg.categories[k] = { enabled: ["logic", "math", "instruction"].includes(k), count: 2, weight: 1 };
  }
  cfg.params = { ...cfg.params, repeatCount: 2, seed: 42, concurrency: 4, systemPrompt: "" };
  cfg.judgeEnabled = false;
  const suite = await caller.suites.create({
    name: `自检套件 ${Date.now()}`,
    description: "由自检脚本创建",
    config: cfg,
  });
  ok("套件创建", !!suite?.id);

  // 4. 创建并执行运行
  console.log("[4/6] 执行评测运行");
  const { runId, totalItems } = await caller.runs.create({
    name: `自检运行 ${new Date().toISOString()}`,
    suiteId: suite!.id,
    modelIds: mocks.slice(0, 3).map((m) => m.id),
  });
  // 2 题 × 3 维度 × 3 模型 × 2 轮 = 36
  ok("任务数正确", totalItems === 36, `期望 36，实际 ${totalItems}`);

  const deadline = Date.now() + 120_000;
  let run = await caller.runs.get({ id: runId });
  while (run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled") {
    if (Date.now() > deadline) {
      ok("运行在规定时间内完成", false, run.status);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
    run = await caller.runs.get({ id: runId });
  }
  ok("运行完成", run.status === "completed", `成功 ${run.doneItems}，失败 ${run.failedItems}`);
  ok("无失败任务", run.failedItems === 0);
  ok("无漏判", run.doneItems + run.failedItems === run.totalItems);

  // 5. 汇总与公平性不变量
  console.log("[5/6] 汇总结果与公平性校验");
  const summaries = await caller.runs.summary({ id: runId });
  ok("产出各模型汇总", summaries.length === mocks.slice(0, 3).length);
  ok("总分在 0~100", summaries.every((s) => s.total >= 0 && s.total <= 100));
  ok("维度得分齐全", summaries.every((s) => ["logic", "math", "instruction"].every((c) => s.categories[c] !== undefined)));
  ok("排名有序", summaries.every((s, i) => i === 0 || summaries[i - 1].total >= s.total));
  ok("成功率统计", summaries.every((s) => s.successRate >= 0 && s.successRate <= 1));

  // 公平性：同一 run 内所有模型同一 seq 对应同一题目
  const items = await caller.runs.items({ runId, limit: 1000 });
  const seqToQ = new Map<number, number>();
  let fair = true;
  for (const it of items) {
    const prev = seqToQ.get(it.seq);
    if (prev === undefined) seqToQ.set(it.seq, it.questionId);
    else if (prev !== it.questionId) fair = false;
  }
  ok("所有模型题目顺序一致", fair);

  for (const s of summaries) {
    console.log(
      `    ${String(s.rank).padStart(2)}. ${s.modelName.padEnd(10)} 总分 ${s.total.toFixed(1).padStart(5)} | ` +
      ["logic", "math", "instruction"].map((c) => `${c}=${s.categories[c]?.toFixed(0)}`).join(" ") +
      ` | 成功率 ${(s.successRate * 100).toFixed(0)}% | 均延 ${s.avgLatencyMs}ms`,
    );
  }

  // 专业指标
  ok("难度分层得分", summaries.every((s) => Object.values(s.difficultyScores).length > 0
    && Object.values(s.difficultyScores).every((v) => v >= 0 && v <= 100)));
  ok("pass@k 仅编程维度计算", summaries.every((s) => s.passAtK === null || (s.passAtK.value >= 0 && s.passAtK.value <= 100)));
  ok("总分置信区间", summaries.every((s) => s.totalCI === null || (s.totalCI[0] <= s.total && s.totalCI[1] >= s.total)));

  // 竞技场对战（运行完成后由调度器异步生成，需轮询等待）
  console.log("[6/6] 竞技场对战与 Bradley-Terry 评级");
  const battleDeadline = Date.now() + 30_000;
  let arena = await caller.runs.arena({ id: runId });
  while (arena.total === 0 && Date.now() < battleDeadline) {
    await new Promise((r) => setTimeout(r, 500));
    arena = await caller.runs.arena({ id: runId });
  }
  // 3 维度 × 2 题 × 2 轮 = 12 组，每组 C(3,2)=3 对 → 36 场
  ok("对战自动生成", arena.total === 36, `${arena.total} 场`);
  ok("判定方式统计", (arena.methods["score_diff"] ?? 0) + (arena.methods["ai_judge"] ?? 0) === arena.total,
    Object.entries(arena.methods).map(([m, n]) => `${m}=${n}`).join(" "));
  ok("评级覆盖全部模型", arena.ratings.length === 3);
  ok("评级降序排列", arena.ratings.every((r, i) => i === 0 || arena.ratings[i - 1].rating >= r.rating));
  ok("评级在置信区间内", arena.ratings.every((r) => r.ciLow <= r.rating && r.rating <= r.ciHigh));
  ok("评级围绕锚点 1000 收缩", arena.ratings.every((r) => r.rating > 500 && r.rating < 1500));
  ok("胜率矩阵完整", arena.matrix.length === 3 && arena.matrix.every((c) => c.total > 0));

  // 幂等重建：清空后重建，数量一致
  const regen = await caller.runs.regenBattles({ runId });
  ok("对战重建幂等", regen.total === arena.total, `重建 ${regen.total} 场`);
  const arena2 = await caller.runs.arena({ id: runId });
  ok("重建后评级一致", JSON.stringify(arena2.ratings.map((r) => r.rating)) === JSON.stringify(arena.ratings.map((r) => r.rating)));

  // 全局排行榜：跨运行聚合
  const board = await caller.runs.leaderboard();
  ok("排行榜产出评级", board.length >= 3, `${board.length} 个模型`);
  ok("排行榜含战绩", board.every((r) => r.battlesCount >= 0 && r.winRate >= 0 && r.winRate <= 1));

  for (const r of arena.ratings) {
    console.log(
      `    ${r.modelName.padEnd(12)} Elo ${r.rating.toFixed(1).padStart(6)}  CI [${r.ciLow.toFixed(0)}, ${r.ciHigh.toFixed(0)}]  ` +
      `${r.wins}胜/${r.losses}负/${r.ties}平  胜率 ${(r.winRate * 100).toFixed(1)}%`,
    );
  }

  // 清理：删除本次自检创建的临时运行与套件，避免污染「评测任务」「报告中心」等列表
  try {
    await caller.runs.remove({ id: runId });
    await caller.suites.remove({ id: suite.id });
    ok("清理自检临时运行与套件", true);
  } catch (e) {
    ok("清理自检临时运行与套件", false, e instanceof Error ? e.message : String(e));
  }

  console.log(process.exitCode ? "\n自检未通过 ✗" : "\n自检全部通过 ✓");
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error("自检异常：", e);
  process.exit(1);
});
