import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { ScoreText, CategoryBadge, fmtMs, fmtTime, useChartTheme } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import { CATEGORIES } from "../../contracts/eval";
import {
  APP_AUTHOR, APP_NAME, APP_NAME_EN, GITHUB_ICON_PATH,
  REPORT_EXTRA_DISCLAIMER, REPO_NAME, REPO_URL,
} from "@/lib/site";

export default function ShareReport({ shareId, onClose }: { shareId: string; onClose?: () => void }) {
  const report = trpc.reports.getByShare.useQuery({ shareId });
  const chart = useChartTheme();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const radarData = useMemo(() => {
    if (!report.data) return [];
    return CATEGORIES.map((c) => {
      const row: Record<string, string | number> = { dim: c.name };
      let has = false;
      for (const s of report.data!.summaries) {
        if (s.categories[c.key] !== undefined) { row[s.modelName] = s.categories[c.key]; has = true; }
      }
      return has ? row : null;
    }).filter(Boolean) as Record<string, string | number>[];
  }, [report.data]);

  if (report.isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">报告加载中…</div>;
  }
  if (report.error || !report.data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="text-sm text-muted-foreground">报告不存在或已删除</div>
        {onClose && <Button size="sm" variant="outline" onClick={onClose}>进入系统</Button>}
      </div>
    );
  }
  const d = report.data;
  const cfg = d.run.paramSnapshot as { params: Record<string, unknown>; judgeEnabled: boolean; categories: Record<string, { weight: number; enabled: boolean }> };
  const items = showAll ? d.items : d.items.slice(0, 40);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        {/* 品牌页头：应用与仓库宣传 */}
        <div className="flex flex-wrap items-center gap-3 border border-border rounded-md bg-card/60 px-4 py-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-wide">{APP_NAME} · {APP_NAME_EN}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                本报告由开源评测工具「{APP_NAME}」自动生成 · 作者：{APP_AUTHOR}
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <a
              href={REPO_URL} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:border-foreground/40 transition-colors"
              title="打开开源仓库"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path fill="currentColor" d={GITHUB_ICON_PATH} />
              </svg>
              {REPO_NAME}
            </a>
            <span className="text-[11px] text-muted-foreground">开源项目 · 欢迎 Star ⭐</span>
            {onClose && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>进入系统 →</Button>}
          </div>
        </div>
        <h1 className="text-2xl font-semibold">{d.title}</h1>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs text-muted-foreground border border-border rounded-md p-3.5 bg-card/60">
          <span>运行：#{d.run.id} {d.run.name}</span>
          <span>状态：{d.run.status}</span>
          <span>题库版本：<span className="font-data text-foreground">{d.run.bankVersion}</span></span>
          <span>题库哈希：<span className="font-data text-foreground">{d.run.bankHash}</span></span>
          <span>随机种子：<span className="font-data text-foreground">{d.run.seed}</span></span>
          <span>题目任务：{d.run.doneItems}/{d.run.totalItems} 成功（失败 {d.run.failedItems}）</span>
          <span>开始：{fmtTime(d.run.startedAt)}</span>
          <span>结束：{fmtTime(d.run.finishedAt)}</span>
          <span className="col-span-2 md:col-span-4">
            参数快照：<span className="font-data text-foreground">
              {Object.entries(cfg.params).map(([k, v]) => `${k}=${v}`).join(" · ")}
            </span> · 判分通道：{cfg.judgeEnabled ? "规则 + 模型评审（双通道）" : "规则判分"}
          </span>
        </div>

        {/* 排名 */}
        <h2 className="text-base font-semibold mt-8 mb-3">模型排名</h2>
        <div className="border border-border rounded-md overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-muted/40">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-normal w-10">#</th>
                <th className="px-3 py-2 font-normal">模型</th>
                <th className="px-3 py-2 font-normal text-right">总分</th>
                <th className="px-3 py-2 font-normal text-right">成功率</th>
                <th className="px-3 py-2 font-normal text-right">平均时延</th>
                <th className="px-3 py-2 font-normal text-right">P95 时延</th>
                <th className="px-3 py-2 font-normal text-right">重复标准差</th>
                <th className="px-3 py-2 font-normal text-right">Tokens</th>
                <th className="px-3 py-2 font-normal text-right">估算成本</th>
              </tr>
            </thead>
            <tbody>
              {d.summaries.map((s) => (
                <tr key={s.modelId} className="border-t border-border/60">
                  <td className="px-3 py-2 font-data text-primary">{s.rank}</td>
                  <td className="px-3 py-2">{s.modelName}</td>
                  <td className="px-3 py-2 text-right"><ScoreText score={s.total} /></td>
                  <td className="px-3 py-2 text-right font-data">{(s.successRate * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right font-data">{fmtMs(s.avgLatencyMs)}</td>
                  <td className="px-3 py-2 text-right font-data">{fmtMs(s.p95LatencyMs)}</td>
                  <td className="px-3 py-2 text-right font-data">{s.repeatStd.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right font-data">{s.totalTokens.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-data">${s.estimatedCost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 竞技场评级 */}
        {d.arena.ratings.length >= 2 && (
          <>
            <h2 className="text-base font-semibold mt-8 mb-3">竞技场评级（Bradley-Terry）</h2>
            <div className="border border-border rounded-md overflow-x-auto mb-2">
              <table className="w-full text-xs min-w-[640px]">
                <thead className="bg-muted/40">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2 font-normal w-10">#</th>
                    <th className="px-3 py-2 font-normal">模型</th>
                    <th className="px-3 py-2 font-normal text-right">评级</th>
                    <th className="px-3 py-2 font-normal">95% 置信区间</th>
                    <th className="px-3 py-2 font-normal text-right">胜/负/平</th>
                    <th className="px-3 py-2 font-normal text-right">胜率</th>
                  </tr>
                </thead>
                <tbody>
                  {d.arena.ratings.map((r, i) => {
                    const span = d.arena.ratings.length > 1
                      ? Math.max(d.arena.ratings[0].ciHigh - d.arena.ratings[d.arena.ratings.length - 1].ciLow, 1)
                      : 1;
                    const lo = d.arena.ratings[d.arena.ratings.length - 1].ciLow;
                    const pos = (v: number) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
                    return (
                      <tr key={r.modelId} className="border-t border-border/60">
                        <td className="px-3 py-2 font-data text-primary">{i + 1}</td>
                        <td className="px-3 py-2">{r.modelName}</td>
                        <td className="px-3 py-2 text-right font-data font-medium">{r.rating.toFixed(1)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="relative h-4 min-w-[110px] flex-1 bg-muted/50 rounded">
                              <div className="absolute top-1/2 -translate-y-1/2 h-1 bg-primary/30 rounded"
                                style={{ left: `${pos(r.ciLow)}%`, width: `${Math.max(pos(r.ciHigh) - pos(r.ciLow), 0.5)}%` }} />
                              <div className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-primary"
                                style={{ left: `calc(${pos(r.rating)}% - 5px)` }} />
                            </div>
                            <span className="font-data text-muted-foreground shrink-0">[{r.ciLow.toFixed(0)}, {r.ciHigh.toFixed(0)}]</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-data">{r.wins}/{r.losses}/{r.ties}</td>
                        <td className="px-3 py-2 text-right font-data">{(r.winRate * 100).toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              评级 = 1000 + 400·log₁₀(强度比)，由两两对战记录拟合 Bradley-Terry 模型得出；置信区间经 500 次 bootstrap 重采样估计。
              共 {d.arena.total} 场对战（{Object.entries(d.arena.methods).map(([m, n]) => `${m === "ai_judge" ? "AI 盲选裁决" : "分差判定"} ${n} 场`).join(" · ")}）。区间重叠表示排名差异不具统计显著性。
            </p>
          </>
        )}

        {/* 雷达 */}
        {radarData.length > 0 && (
          <>
            <h2 className="text-base font-semibold mt-8 mb-3">能力维度雷达</h2>
            <div className="border border-border rounded-md bg-card/60 p-4">
              <ResponsiveContainer width="100%" height={360}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke={chart.grid} />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: chart.tick, fontSize: 12 }} />
                  {d.summaries.map((s, i) => (
                    <Radar key={s.modelId} name={s.modelName} dataKey={s.modelName}
                      stroke={chart.series[i % chart.series.length]} fill={chart.series[i % chart.series.length]} fillOpacity={0.12} />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 12, color: chart.legend }} />
                  <Tooltip contentStyle={chart.tooltip} itemStyle={{ color: chart.legend }} labelStyle={{ color: chart.legend }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {/* 逐题明细 */}
        <h2 className="text-base font-semibold mt-8 mb-3">逐题明细（{d.items.length} 条，全部公开）</h2>
        <div className="space-y-1.5">
          {items.map((i) => {
            const open = expanded.has(i.id);
            return (
              <div key={i.id} className="border border-border rounded-md bg-card/60">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs"
                  onClick={() => {
                    const next = new Set(expanded);
                    if (open) next.delete(i.id); else next.add(i.id);
                    setExpanded(next);
                  }}
                >
                  {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  <span className="font-data text-muted-foreground w-7">{i.seq + 1}</span>
                  <span className="w-28 truncate">{i.modelName}</span>
                  <CategoryBadge category={i.category} />
                  <span className="truncate flex-1 text-muted-foreground">{i.prompt}</span>
                  <span className="font-data shrink-0"><ScoreText score={i.finalScore} max={1} /></span>
                </button>
                {open && (
                  <div className="px-4 pb-3 pt-1 text-xs space-y-2 border-t border-border/60">
                    <div><span className="text-muted-foreground">题目：</span>{i.prompt}</div>
                    {i.expectedAnswer && <div><span className="text-muted-foreground">参考答案：</span><span className="font-data">{i.expectedAnswer}</span></div>}
                    {i.rubric && <div><span className="text-muted-foreground">评分标准：</span>{i.rubric}</div>}
                    <div>
                      <span className="text-muted-foreground">模型回答：</span>
                      <div className="bg-muted/40 rounded p-2.5 mt-1 whitespace-pre-wrap max-h-48 overflow-y-auto">{i.responseText ?? i.error ?? "（无）"}</div>
                    </div>
                    <div className="font-data text-muted-foreground">
                      规则 {i.ruleScore ?? "—"} · 评审 {i.judgeScore ?? "—"} · 最终 {i.finalScore ?? "—"}
                      {i.reviewScore !== null && ` · 人工复核 ${i.reviewScore}${i.reviewNote ? `（${i.reviewNote}）` : ""}`}
                      {i.latencyMs != null && ` · ${fmtMs(i.latencyMs)}`}
                      {i.retryCount > 0 && ` · 重试 ${i.retryCount} 次`}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {d.items.length > 40 && (
          <div className="text-center mt-3">
            <Button size="sm" variant="outline" onClick={() => setShowAll(!showAll)}>
              {showAll ? "收起" : `展开全部 ${d.items.length} 条`}
            </Button>
          </div>
        )}

        {/* 免责声明 */}
        <div className="mt-8 border-t border-border pt-4 text-[11px] text-muted-foreground leading-relaxed space-y-2">
          <div>{d.disclaimer}</div>
          <div>{REPORT_EXTRA_DISCLAIMER}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>生成工具：
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-foreground underline decoration-dotted underline-offset-2">
                {APP_NAME}（{REPO_NAME}）
              </a>
            </span>
            <span>作者：{APP_AUTHOR}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
