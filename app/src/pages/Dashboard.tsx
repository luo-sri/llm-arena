import { useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { StatCard, EmptyState, fmtTime, useChartTheme } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { CATEGORIES, BANK_VERSION } from "../../contracts/eval";

export default function Dashboard({ onOpenRun }: { onOpenRun: (id: number) => void }) {
  const chart = useChartTheme();
  const overview = trpc.system.overview.useQuery(undefined, { refetchInterval: 5000 });
  const runsList = trpc.runs.list.useQuery(undefined, { refetchInterval: 5000 });
  const history = trpc.runs.history.useQuery({ limit: 10 });

  const latestFinished = useMemo(
    () => runsList.data?.find((r) => r.status === "completed"),
    [runsList.data],
  );
  const summary = trpc.runs.summary.useQuery(
    { id: latestFinished?.id ?? -1 },
    { enabled: !!latestFinished },
  );

  const radarData = useMemo(() => {
    if (!summary.data || summary.data.length === 0) return [];
    return CATEGORIES.map((c) => {
      const row: Record<string, string | number> = { dim: c.name };
      for (const s of summary.data!) {
        row[s.modelName] = s.categories[c.key] ?? 0;
      }
      return row;
    }).filter((row) => summary.data!.some((s) => s.categories[CATEGORIES.find((c) => c.name === row.dim)?.key ?? ""] !== undefined));
  }, [summary.data]);

  const trendData = useMemo(() => {
    if (!history.data) return [];
    return history.data.map((h) => ({
      name: `#${h.runId} ${h.name.slice(0, 8)}`,
      ...h.totals,
    }));
  }, [history.data]);

  const trendModels = useMemo(() => {
    const set = new Set<string>();
    trendData.forEach((row) => Object.keys(row).forEach((k) => k !== "name" && set.add(k)));
    return [...set];
  }, [trendData]);

  const activeRuns = runsList.data?.filter((r) => r.status === "running" || r.status === "paused") ?? [];

  return (
    <div>
      <PageHeader title="仪表盘" desc="总览：模型、题库、运行与历史趋势" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
        {overview.isLoading
          ? Array.from({ length: 7 }).map((_, i) => (
              <Card key={i} className="bg-card/70">
                <CardContent className="p-4 space-y-2">
                  <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
                  <div className="h-7 w-1/2 rounded bg-muted animate-pulse" />
                </CardContent>
              </Card>
            ))
          : (
            <>
              <StatCard label="受测模型" value={overview.data?.models ?? "—"} />
              <StatCard label="题库题目" value={overview.data?.questions ?? "—"} />
              <StatCard label="测试套件" value={overview.data?.suites ?? "—"} />
              <StatCard label="评测运行" value={overview.data?.runs ?? "—"} sub={`已完成 ${overview.data?.completedRuns ?? 0}`} />
              <StatCard label="逐题记录" value={overview.data?.items ?? "—"} />
              <StatCard label="待人工复核" value={overview.data?.pendingReviews ?? "—"} accent={(overview.data?.pendingReviews ?? 0) > 0} />
              <StatCard label="进行中" value={activeRuns.length} accent={activeRuns.length > 0} />
            </>
          )}
      </div>

      {activeRuns.length > 0 && (
        <Card className="mb-5 border-info/30">
          <CardHeader className="py-3"><CardTitle className="text-sm">进行中的运行</CardTitle></CardHeader>
          <CardContent className="pb-3 space-y-2">
            {activeRuns.map((r) => (
              <div key={r.id} className="flex items-center gap-3 text-xs">
                <span className="font-data text-muted-foreground">#{r.id}</span>
                <span>{r.name}</span>
                <span className="text-muted-foreground font-data">{r.doneItems + r.failedItems}/{r.totalItems}</span>
                <Button size="sm" variant="outline" className="h-6 text-xs ml-auto" onClick={() => onOpenRun(r.id)}>查看</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">能力雷达（最近一次完成：{latestFinished ? `#${latestFinished.id} ${latestFinished.name}` : "—"}）</CardTitle>
            {latestFinished && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => onOpenRun(latestFinished.id)}>详情</Button>}
          </CardHeader>
          <CardContent>
            {radarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke={chart.grid} />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: chart.tick, fontSize: 11 }} />
                  {summary.data!.map((s, i) => (
                    <Radar key={s.modelId} name={s.modelName} dataKey={s.modelName}
                      stroke={chart.series[i % chart.series.length]}
                      fill={chart.series[i % chart.series.length]} fillOpacity={0.12} />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 11, color: chart.legend }} />
                  <Tooltip contentStyle={chart.tooltip} itemStyle={{ color: chart.legend }} labelStyle={{ color: chart.legend }} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="暂无已完成的评测" hint="前往「评测任务」创建一次运行后，这里将展示维度雷达图" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">历史趋势（各模型总分 · 最近 10 次已完成运行）</CardTitle></CardHeader>
          <CardContent>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={trendData}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: chart.tick, fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: chart.tick, fontSize: 10 }} />
                  <Tooltip contentStyle={chart.tooltip} itemStyle={{ color: chart.legend }} labelStyle={{ color: chart.legend }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: chart.legend }} />
                  {trendModels.map((m, i) => (
                    <Line key={m} type="monotone" dataKey={m} stroke={chart.series[i % chart.series.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="暂无历史运行" />
            )}
          </CardContent>
        </Card>
      </div>

      {latestFinished && summary.data && summary.data.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="py-3"><CardTitle className="text-sm">排名（最近一次完成的运行）</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground text-left border-b border-border">
                  <th className="py-2 font-normal">#</th><th className="font-normal">模型</th>
                  <th className="font-normal text-right">总分</th><th className="font-normal text-right">成功率</th>
                  <th className="font-normal text-right">平均时延</th><th className="font-normal text-right">Tokens</th>
                  <th className="font-normal text-right">估算成本</th><th className="font-normal text-right">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {summary.data.map((s, i) => (
                  <tr key={s.modelId} className="border-b border-border/50">
                    <td className="py-2 font-data text-primary">{i + 1}</td>
                    <td>{s.modelName}</td>
                    <td className="text-right font-data font-semibold">{s.total.toFixed(1)}</td>
                    <td className="text-right font-data">{(s.successRate * 100).toFixed(1)}%</td>
                    <td className="text-right font-data">{s.avgLatencyMs}ms</td>
                    <td className="text-right font-data">{s.totalTokens.toLocaleString()}</td>
                    <td className="text-right font-data">${s.estimatedCost.toFixed(4)}</td>
                    <td className="text-right text-muted-foreground">{fmtTime(latestFinished.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      <div className="mt-4 text-[11px] text-muted-foreground">
        题库 {BANK_VERSION} · 所有运行使用固定种子与统一参数快照，题目、判分规则完全公开。
      </div>
    </div>
  );
}
