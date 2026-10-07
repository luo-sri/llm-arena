/** 功能验证：报告 / 暂停继续取消 / 人工复核 / 配置导出导入 */
import { appRouter } from "../api/router";
import { DEFAULT_SUITE_CONFIG, type SuiteConfig } from "../contracts/eval";

const caller = appRouter.createCaller({
  req: new Request("http://verify.local"),
  resHeaders: new Headers(),
});

function ok(name: string, cond: boolean, extra = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  console.log("== 功能验证 ==\n");

  const { models: allModels } = await caller.models.list();
  const mocks = allModels.filter((m) => m.provider === "mock" && m.enabled);

  // ── 暂停/继续/取消 ──
  console.log("[1] 调度控制：暂停 / 继续 / 取消");
  const cfg: SuiteConfig = JSON.parse(JSON.stringify(DEFAULT_SUITE_CONFIG));
  for (const k of Object.keys(cfg.categories)) cfg.categories[k] = { enabled: k === "reading", count: 0, weight: 1 };
  cfg.params = { ...cfg.params, repeatCount: 3, concurrency: 1, systemPrompt: "" };
  cfg.judgeEnabled = false;
  const suite = await caller.suites.create({ name: `验证套件 ${Date.now()}`, config: cfg });
  const { runId } = await caller.runs.create({ name: `调度验证 ${Date.now()}`, suiteId: suite!.id, modelIds: [mocks[0].id] });

  await caller.runs.pause({ id: runId });
  await new Promise((r) => setTimeout(r, 1500));
  let run = await caller.runs.get({ id: runId });
  ok("暂停生效", run.status === "paused", run.status);
  const doneAtPause = run.doneItems;

  await caller.runs.resume({ id: runId });
  await new Promise((r) => setTimeout(r, 2000));
  run = await caller.runs.get({ id: runId });
  ok("继续后进度推进", run.doneItems > doneAtPause, `${doneAtPause} → ${run.doneItems}`);

  await caller.runs.cancel({ id: runId });
  await new Promise((r) => setTimeout(r, 2500));
  run = await caller.runs.get({ id: runId });
  ok("取消生效", run.status === "cancelled", run.status);

  // ── 报告 ──
  console.log("[2] 报告生成与公开访问");
  const completed = (await caller.runs.list()).find((r) => r.status === "completed");
  ok("存在已完成运行", !!completed);
  if (completed) {
    const rep = await caller.reports.generate({ runId: completed.id });
    ok("报告生成", !!rep.shareId);
    const pub = await caller.reports.getByShare({ shareId: rep.shareId });
    ok("公开访问数据完整",
      !!pub.run.paramSnapshot && pub.summaries.length > 0 && pub.items.length > 0 && pub.disclaimer.length > 0,
      `题目明细 ${pub.items.length} 条，题库 ${pub.run.bankVersion}#${pub.run.bankHash}`);
    const param = pub.run.paramSnapshot as { seed?: number; params?: { temperature?: number } };
    ok("参数快照含种子与温度", param.params?.temperature !== undefined && pub.run.seed === 42);
  }

  // ── 人工复核 ──
  console.log("[3] 人工复核");
  const items = completed ? (await caller.runs.items({ runId: completed.id, limit: 10 })).rows : [];
  const target = items.find((i) => i.status === "done");
  ok("找到可复核记录", !!target);
  if (target) {
    // 模拟分歧：直接提交复核分
    await caller.reports.submitReview({ itemId: target.id, score: 0.95, note: "自检人工裁定" });
    const after = (await caller.runs.items({ runId: completed!.id, modelId: target.modelId, limit: 100 })).rows;
    const updated = after.find((i) => i.id === target.id);
    ok("复核分覆盖最终分", updated?.finalScore === 0.95 && updated?.reviewScore === 0.95);
  }

  // ── 配置导出/导入 ──
  console.log("[4] 配置备份导出 / 导入");
  const exported = await caller.system.exportConfig();
  ok("导出包含模型/套件", exported.models.length > 0 && exported.suites.length > 0,
    `模型 ${exported.models.length}，套件 ${exported.suites.length}`);
  const stats = await caller.system.importConfig({ payload: JSON.stringify(exported) });
  ok("重复导入全部跳过（幂等去重）", stats.models === 0 && stats.skipped > 0, `跳过 ${stats.skipped}`);

  // ── 历史趋势与对比 ──
  console.log("[5] 历史趋势与版本对比");
  const history = await caller.runs.history({ limit: 5 });
  ok("历史趋势", history.length > 0, `${history.length} 次运行`);
  if (history.length >= 1 && completed) {
    const cmp = await caller.runs.compare({ runIdA: completed.id, runIdB: completed.id });
    ok("版本对比", cmp.summaryA.length === cmp.summaryB.length);
  }

  console.log(process.exitCode ? "\n功能验证未通过 ✗" : "\n功能验证全部通过 ✓");
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error("验证异常：", e);
  process.exit(1);
});
