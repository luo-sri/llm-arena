import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { StatusBadge, CategoryBadge, ScoreText, fmtMs, fmtTime, useChartTheme } from "@/components/common";
import { useConfirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Play, Pause, Square, RotateCcw, FileText, Eye, Trophy, RefreshCw } from "lucide-react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Cell,
} from "recharts";
import { CATEGORIES, DIFFICULTY_MAP, type SuiteConfig, DISCLAIMER } from "../../contracts/eval";

export default function RunDetail({ runId, onBack }: { runId: number; onBack: () => void }) {
  const utils = trpc.useUtils();
  const chart = useChartTheme();
  const [confirmDialog, confirmElement] = useConfirm();
  const run = trpc.runs.get.useQuery({ id: runId }, { refetchInterval: 2500 });
  const summary = trpc.runs.summary.useQuery({ id: runId }, { refetchInterval: 4000 });
  const arena = trpc.runs.arena.useQuery({ id: runId }, { refetchInterval: run.data?.status === "completed" ? 6000 : 4000 });
  const [logSince, setLogSince] = useState(0);
  const [logs, setLogs] = useState<{ id: number; level: string; message: string; createdAt: Date }[]>([]);
  const logsQuery = trpc.runs.logs.useQuery({ runId, sinceId: logSince }, { refetchInterval: 2000 });
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const items = trpc.runs.items.useQuery(
    {
      runId,
      modelId: modelFilter === "all" ? undefined : Number(modelFilter),
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 500,
    },
    { refetchInterval: 4000 },
  );
  const [itemDetail, setItemDetail] = useState<number | null>(null);
  const logBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsQuery.data && logsQuery.data.length > 0) {
      setLogs((prev) => [...prev, ...logsQuery.data]);
      setLogSince(logsQuery.data[logsQuery.data.length - 1].id);
    }
  }, [logsQuery.data]);

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight });
  }, [logs]);

  const pause = trpc.runs.pause.useMutation({ onSuccess: () => utils.runs.get.invalidate() });
  const resume = trpc.runs.resume.useMutation({ onSuccess: () => utils.runs.get.invalidate() });
  const cancel = trpc.runs.cancel.useMutation({ onSuccess: () => utils.runs.get.invalidate() });
  const retry = trpc.runs.retryItem.useMutation({
    onSuccess: () => { toast.success("已重置并重跑该题"); utils.runs.items.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const regenBattles = trpc.runs.regenBattles.useMutation({
    onSuccess: (r) => {
      toast.success(`竞技场对战已重建：${r.total} 场`);
      utils.runs.arena.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const genReport = trpc.reports.generate.useMutation({
    onSuccess: (r) => {
      const url = `${window.location.origin}${window.location.pathname}?report=${r.shareId}`;
      navigator.clipboard?.writeText(url).catch(() => {});
      toast.success("报告已生成，分享链接已复制到剪贴板");
    },
    onError: (e) => toast.error(e.message),
  });

  const r = run.data;
  const cfg = r?.paramSnapshot as SuiteConfig | undefined;
  const done = r ? r.doneItems + r.failedItems : 0;
  const pct = r?.totalItems ? Math.round((done / r.totalItems) * 100) : 0;

  const radarData = useMemo(() => {
    if (!summary.data) return [];
    return CATEGORIES.map((c) => {
      const row: Record<string, string | number> = { dim: c.name };
      let has = false;
      for (const s of summary.data!) {
        if (s.categories[c.key] !== undefined) { row[s.modelName] = s.categories[c.key]; has = true; }
      }
      return has ? row : null;
    }).filter(Boolean) as Record<string, string | number>[];
  }, [summary.data]);

  const barData = useMemo(() => {
    if (!summary.data) return [];
    return summary.data.map((s) => ({ name: s.modelName, 总分: s.total }));
  }, [summary.data]);

  const latencyData = useMemo(() => {
    if (!summary.data) return [];
    return summary.data.map((s) => ({ name: s.modelName, 平均时延: s.avgLatencyMs, P95时延: s.p95LatencyMs }));
  }, [summary.data]);

  const difficultyData = useMemo(() => {
    if (!summary.data) return [];
    const levels = [...new Set(summary.data.flatMap((s) => Object.keys(s.difficultyScores).map(Number)))]
      .sort((a, b) => a - b);
    return levels.map((lv) => {
      const row: Record<string, string | number> = { level: `L${lv}·${DIFFICULTY_MAP[lv]?.name ?? lv}` };
      for (const s of summary.data!) {
        if (s.difficultyScores[lv] !== undefined) row[s.modelName] = s.difficultyScores[lv];
      }
      return row;
    });
  }, [summary.data]);

  const detailItem = useMemo(() => items.data?.find((i) => i.id === itemDetail) ?? null, [items.data, itemDetail]);

  if (!r) return <div className="text-sm text-muted-foreground">加载中…</div>;

  return (
    <div>
      <PageHeader
        title={`#${r.id} ${r.name}`}
        desc={`创建于 ${fmtTime(r.createdAt)} · 题库 ${r.bankVersion}#${r.bankHash} · 种子 ${r.seed} · 启用维度 ${
          Object.values(cfg?.categories ?? {}).filter((c) => c.enabled).length
        }/${CATEGORIES.length}（维度由所选套件决定；想测全部能力请选择全量套件并新建评测）`}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5 mr-1" />返回</Button>
            {r.status === "running" && <Button size="sm" variant="outline" onClick={() => pause.mutate({ id: r.id })}><Pause className="h-3.5 w-3.5 mr-1" />暂停</Button>}
            {r.status === "paused" && <Button size="sm" variant="outline" onClick={() => resume.mutate({ id: r.id })}><Play className="h-3.5 w-3.5 mr-1" />继续</Button>}
            {(r.status === "running" || r.status === "paused") && (
              <Button size="sm" variant="outline" className="text-destructive"
                onClick={async () => {
                  if (await confirmDialog({ title: "取消该运行？", description: "取消后剩余题目将标记为跳过，已完成的结果保留。", confirmText: "取消运行", destructive: true })) cancel.mutate({ id: r.id });
                }}>
                <Square className="h-3.5 w-3.5 mr-1" />取消
              </Button>
            )}
            {(r.status === "completed" || r.status === "cancelled" || r.status === "failed") && (
              <Button size="sm" onClick={() => genReport.mutate({ runId: r.id })} disabled={genReport.isPending}>
                <FileText className="h-3.5 w-3.5 mr-1" />生成分享报告
              </Button>
            )}
          </>
        }
      />

      {/* 状态与参数快照 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge status={r.status} />
              <span className="text-xs text-muted-foreground font-data">
                {done}/{r.totalItems} 完成 · 失败 {r.failedItems} · {r.startedAt ? `开始 ${fmtTime(r.startedAt)}` : "未开始"}{r.finishedAt ? ` · 结束 ${fmtTime(r.finishedAt)}` : ""}
              </span>
            </div>
            <Progress value={pct} className="h-2" />
            <div className="text-right text-[11px] font-data text-muted-foreground mt-1">{pct}%</div>
            {r.error && <div className="mt-2 text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{r.error}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-2.5"><CardTitle className="text-xs">参数快照（所有模型一致）</CardTitle></CardHeader>
          <CardContent className="pb-3">
            {cfg && (
              <div className="text-[11px] font-data text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1">
                <span>温度 {cfg.params.temperature}</span>
                <span>maxTokens {cfg.params.maxTokens}</span>
                <span>超时 {cfg.params.timeoutMs}ms</span>
                <span>重试 {cfg.params.retries}</span>
                <span>重复 {cfg.params.repeatCount} 轮</span>
                <span>并发 {cfg.params.concurrency}</span>
                <span>种子 {cfg.params.seed}</span>
                <span>评审 {cfg.judgeEnabled ? "双通道" : "仅规则"}</span>
                <span className="col-span-2 truncate" title={cfg.params.systemPrompt}>系统提示词：{cfg.params.systemPrompt || "（无）"}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="charts">
        <TabsList className="mb-3">
          <TabsTrigger value="charts" className="text-xs">结果可视化</TabsTrigger>
          <TabsTrigger value="arena" className="text-xs">竞技场对战（{arena.data?.total ?? 0}）</TabsTrigger>
          <TabsTrigger value="items" className="text-xs">逐题明细（{items.data?.length ?? 0}）</TabsTrigger>
          <TabsTrigger value="logs" className="text-xs">实时日志（{logs.length}）</TabsTrigger>
        </TabsList>

        {/* 图表 */}
        <TabsContent value="charts">
          {(summary.data?.length ?? 0) === 0 ? (
            <div className="text-xs text-muted-foreground py-10 text-center">暂无可汇总的数据</div>
          ) : (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="py-2.5"><CardTitle className="text-xs">维度雷达图</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <RadarChart data={radarData}>
                        <PolarGrid stroke={chart.grid} />
                        <PolarAngleAxis dataKey="dim" tick={{ fill: chart.tick, fontSize: 11 }} />
                        {summary.data!.map((s, i) => (
                          <Radar key={s.modelId} name={s.modelName} dataKey={s.modelName}
                            stroke={chart.series[i % chart.series.length]} fill={chart.series[i % chart.series.length]} fillOpacity={0.12} />
                        ))}
                        <Legend wrapperStyle={{ fontSize: 11, color: chart.legend }} />
                        <Tooltip contentStyle={chart.tooltip} itemStyle={{ color: chart.legend }} labelStyle={{ color: chart.legend }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="py-2.5"><CardTitle className="text-xs">总分对比</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={barData}>
                        <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fill: chart.tick, fontSize: 11 }} />
                        <YAxis domain={[0, 100]} tick={{ fill: chart.tick, fontSize: 10 }} />
                        <Tooltip contentStyle={chart.tooltip} itemStyle={{ color: chart.legend }} labelStyle={{ color: chart.legend }} />
                        <Bar dataKey="总分" radius={[3, 3, 0, 0]}>
                          {barData.map((_, i) => <Cell key={i} fill={chart.series[i % chart.series.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* 单项能力条形图 */}
              <Card className="mt-4">
                <CardHeader className="py-2.5"><CardTitle className="text-xs">单项能力条形图（各维度 × 各模型）</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={Math.max(240, radarData.length * 56)}>
                    <BarChart data={radarData} layout="vertical">
                      <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fill: chart.tick, fontSize: 10 }} />
                      <YAxis type="category" dataKey="dim" tick={{ fill: chart.tick, fontSize: 11 }} width={90} />
                      <Tooltip contentStyle={chart.tooltip} itemStyle={{ color: chart.legend }} labelStyle={{ color: chart.legend }} />
                      <Legend wrapperStyle={{ fontSize: 11, color: chart.legend }} />
                      {summary.data!.map((s, i) => (
                        <Bar key={s.modelId} name={s.modelName} dataKey={s.modelName} fill={chart.series[i % chart.series.length]} radius={[0, 3, 3, 0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* 难度分层得分 */}
              {difficultyData.length > 0 && (
                <Card className="mt-4">
                  <CardHeader className="py-2.5"><CardTitle className="text-xs">难度分层得分（L1 基础 → L5 地狱 · 满分 100）</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={Math.max(200, difficultyData.length * 56)}>
                      <BarChart data={difficultyData} layout="vertical">
                        <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                        <XAxis type="number" domain={[0, 100]} tick={{ fill: chart.tick, fontSize: 10 }} />
                        <YAxis type="category" dataKey="level" tick={{ fill: chart.tick, fontSize: 11 }} width={90} />
                        <Tooltip contentStyle={chart.tooltip} itemStyle={{ color: chart.legend }} labelStyle={{ color: chart.legend }} />
                        <Legend wrapperStyle={{ fontSize: 11, color: chart.legend }} />
                        {summary.data!.map((s, i) => (
                          <Bar key={s.modelId} name={s.modelName} dataKey={s.modelName} fill={chart.series[i % chart.series.length]} radius={[0, 3, 3, 0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
                <Card>
                  <CardHeader className="py-2.5"><CardTitle className="text-xs">响应时延（ms）</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={latencyData}>
                        <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fill: chart.tick, fontSize: 11 }} />
                        <YAxis tick={{ fill: chart.tick, fontSize: 10 }} />
                        <Tooltip contentStyle={chart.tooltip} itemStyle={{ color: chart.legend }} labelStyle={{ color: chart.legend }} />
                        <Legend wrapperStyle={{ fontSize: 11, color: chart.legend }} />
                        <Bar dataKey="平均时延" fill={chart.series[1]} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="P95时延" fill={chart.series[3]} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="py-2.5"><CardTitle className="text-xs">稳定性 / 成功率 / 成本统计</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[520px]">
                      <thead>
                        <tr className="text-muted-foreground text-left border-b border-border">
                          <th className="py-1.5 font-normal">模型</th>
                          <th className="py-1.5 font-normal text-right">成功率</th>
                          <th className="py-1.5 font-normal text-right">pass@1</th>
                          <th className="py-1.5 font-normal text-right">pass@k</th>
                          <th className="py-1.5 font-normal text-right">重复标准差</th>
                          <th className="py-1.5 font-normal text-right">时延抖动</th>
                          <th className="py-1.5 font-normal text-right">Tokens</th>
                          <th className="py-1.5 font-normal text-right">估算成本</th>
                          <th className="py-1.5 font-normal text-right">待复核</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.data!.map((s) => (
                          <tr key={s.modelId} className="border-b border-border/50">
                            <td className="py-1.5">{s.modelName}</td>
                            <td className="py-1.5 text-right font-data">{(s.successRate * 100).toFixed(1)}%</td>
                            <td className="py-1.5 text-right font-data">{s.passAt1 !== null ? `${s.passAt1}%` : "—"}</td>
                            <td className="py-1.5 text-right font-data">{s.passAtK ? `${s.passAtK.value}% @k={s.passAtK.k}` : "—"}</td>
                            <td className="py-1.5 text-right font-data">{s.repeatStd.toFixed(3)}</td>
                            <td className="py-1.5 text-right font-data">{fmtMs(s.latencyStdMs)}</td>
                            <td className="py-1.5 text-right font-data">{s.totalTokens.toLocaleString()}</td>
                            <td className="py-1.5 text-right font-data">${s.estimatedCost.toFixed(4)}</td>
                            <td className="py-1.5 text-right font-data">{s.needsReviewCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>

              {/* 排名单 */}
              <Card className="mt-4">
                <CardHeader className="py-2.5"><CardTitle className="text-xs">模型排名（各维度得分 · 满分 100）</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[760px]">
                    <thead>
                      <tr className="text-muted-foreground text-left border-b border-border">
                        <th className="py-1.5 font-normal w-8">#</th>
                        <th className="py-1.5 font-normal">模型</th>
                        <th className="py-1.5 font-normal text-right">总分</th>
                        <th className="py-1.5 font-normal text-right">总分 95% CI</th>
                        {CATEGORIES.filter((c) => summary.data!.some((s) => s.categories[c.key] !== undefined)).map((c) => (
                          <th key={c.key} className="py-1.5 font-normal text-right">{c.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {summary.data!.map((s) => (
                        <tr key={s.modelId} className="border-b border-border/50">
                          <td className="py-1.5 font-data text-primary">{s.rank}</td>
                          <td className="py-1.5">{s.modelName}</td>
                          <td className="py-1.5 text-right"><ScoreText score={s.total} /></td>
                          <td className="py-1.5 text-right font-data text-muted-foreground">
                            {s.totalCI ? `${s.totalCI[0]}~${s.totalCI[1]}` : "—"}
                          </td>
                          {CATEGORIES.filter((c) => summary.data!.some((x) => x.categories[c.key] !== undefined)).map((c) => (
                            <td key={c.key} className="py-1.5 text-right font-data">
                              {s.categories[c.key] !== undefined ? <ScoreText score={s.categories[c.key]} /> : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* 竞技场对战 */}
        <TabsContent value="arena">
          {(arena.data?.total ?? 0) === 0 ? (
            <div className="text-xs text-muted-foreground py-10 text-center">
              {r.status === "completed"
                ? "暂无对战记录（正在后台生成，稍候自动刷新；单题重跑或人工复核后可点「重新生成对战」）"
                : "暂无对战记录（运行完成后自动生成两两对战并计算 Bradley-Terry 评级）"}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="text-[11px] text-muted-foreground">
                  共 {arena.data!.total} 场对战 · 判定方式：
                  {Object.entries(arena.data!.methods)
                    .map(([m, n]) => `${m === "ai_judge" ? "AI 裁决" : "分差判定"} ${n} 场`)
                    .join(" · ")}
                  {" · "}评级 = 1000 + 400·log₁₀(强度比)，95% CI 由 500 次 bootstrap 重采样得出
                </div>
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  disabled={regenBattles.isPending || r.status !== "completed"}
                  onClick={() => regenBattles.mutate({ runId })}
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${regenBattles.isPending ? "animate-spin" : ""}`} />
                  {regenBattles.isPending ? "重建中…" : "重新生成对战"}
                </Button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="py-2.5">
                    <CardTitle className="text-xs flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5 text-primary" />本次运行 Bradley-Terry 评级</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground text-left border-b border-border">
                          <th className="py-1.5 font-normal w-8">#</th>
                          <th className="py-1.5 font-normal">模型</th>
                          <th className="py-1.5 font-normal text-right">评级</th>
                          <th className="py-1.5 font-normal text-right">95% CI</th>
                          <th className="py-1.5 font-normal text-right">胜/平/负</th>
                          <th className="py-1.5 font-normal text-right">胜率</th>
                        </tr>
                      </thead>
                      <tbody>
                        {arena.data!.ratings.map((r2, i) => (
                          <tr key={r2.modelId} className="border-b border-border/50">
                            <td className="py-1.5 font-data text-primary">{i + 1}</td>
                            <td className="py-1.5">{r2.modelName}</td>
                            <td className="py-1.5 text-right font-data font-medium">{r2.rating.toFixed(1)}</td>
                            <td className="py-1.5 text-right font-data text-muted-foreground">{r2.ciLow.toFixed(0)}~{r2.ciHigh.toFixed(0)}</td>
                            <td className="py-1.5 text-right font-data">
                              <span className="text-success">{r2.wins}</span> / <span className="text-muted-foreground">{r2.ties}</span> / <span className="text-destructive">{r2.losses}</span>
                            </td>
                            <td className="py-1.5 text-right font-data">{(r2.winRate * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-2.5"><CardTitle className="text-xs">两两对战明细（同一题目同轮次各配对一战）</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground text-left border-b border-border">
                          <th className="py-1.5 font-normal">对局</th>
                          <th className="py-1.5 font-normal text-right">A 胜</th>
                          <th className="py-1.5 font-normal text-right">平局</th>
                          <th className="py-1.5 font-normal text-right">B 胜</th>
                          <th className="py-1.5 font-normal text-right">A 胜率</th>
                        </tr>
                      </thead>
                      <tbody>
                        {arena.data!.matrix.map((c) => (
                          <tr key={`${c.modelAId}-${c.modelBId}`} className="border-b border-border/50">
                            <td className="py-1.5">{c.modelAName} vs {c.modelBName}</td>
                            <td className="py-1.5 text-right font-data text-success">{c.aWins}</td>
                            <td className="py-1.5 text-right font-data text-muted-foreground">{c.ties}</td>
                            <td className="py-1.5 text-right font-data text-destructive">{c.bWins}</td>
                            <td className="py-1.5 text-right font-data">
                              {c.total ? `${(((c.aWins + c.ties * 0.5) / c.total) * 100).toFixed(1)}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* 逐题明细 */}
        <TabsContent value="items">
          <div className="flex gap-2 mb-3">
            <Select value={modelFilter} onValueChange={setModelFilter}>
              <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部模型</SelectItem>
                {summary.data?.map((s) => <SelectItem key={s.modelId} value={String(s.modelId)}>{s.modelName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="done">成功</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
                <SelectItem value="pending">待执行</SelectItem>
                <SelectItem value="running">执行中</SelectItem>
                <SelectItem value="skipped">已跳过</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="text-left text-muted-foreground">
                  <th className="px-2.5 py-2 font-normal w-10">序</th>
                  <th className="px-2.5 py-2 font-normal w-32">模型</th>
                  <th className="px-2.5 py-2 font-normal w-24">维度</th>
                  <th className="px-2.5 py-2 font-normal">题目</th>
                  <th className="px-2.5 py-2 font-normal w-10">轮</th>
                  <th className="px-2.5 py-2 font-normal w-16">状态</th>
                  <th className="px-2.5 py-2 font-normal w-14 text-right">规则分</th>
                  <th className="px-2.5 py-2 font-normal w-14 text-right">评审分</th>
                  <th className="px-2.5 py-2 font-normal w-14 text-right">最终分</th>
                  <th className="px-2.5 py-2 font-normal w-16 text-right">时延</th>
                  <th className="px-2.5 py-2 font-normal w-20"></th>
                </tr>
              </thead>
              <tbody>
                {items.data?.map((i) => (
                  <tr key={i.id} className="border-t border-border/60 hover:bg-accent/30">
                    <td className="px-2.5 py-1.5 font-data text-muted-foreground">{i.seq + 1}</td>
                    <td className="px-2.5 py-1.5">{i.modelName}</td>
                    <td className="px-2.5 py-1.5">{i.question ? <CategoryBadge category={i.question.category} /> : "—"}</td>
                    <td className="px-2.5 py-1.5 max-w-0"><div className="truncate" title={i.question?.prompt}>{i.question?.prompt ?? "（题目已删除）"}</div></td>
                    <td className="px-2.5 py-1.5 font-data text-muted-foreground">{i.repeatIndex + 1}</td>
                    <td className="px-2.5 py-1.5">
                      <StatusBadge status={i.status} />
                      {i.needsReview && <span className="ml-1 text-[10px] text-primary">待复核</span>}
                    </td>
                    <td className="px-2.5 py-1.5 text-right"><ScoreText score={i.ruleScore} max={1} /></td>
                    <td className="px-2.5 py-1.5 text-right"><ScoreText score={i.judgeScore} max={1} /></td>
                    <td className="px-2.5 py-1.5 text-right"><ScoreText score={i.finalScore} max={1} /></td>
                    <td className="px-2.5 py-1.5 text-right font-data text-muted-foreground">{fmtMs(i.latencyMs)}</td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex gap-0.5 justify-end">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="查看回答与判分"
                          onClick={() => setItemDetail(i.id)}><Eye className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="单题重跑"
                          onClick={async () => {
                            if (await confirmDialog({ title: "重跑该题？", description: "该题将使用相同参数重新执行，原结果将被覆盖。", confirmText: "重跑" })) retry.mutate({ itemId: i.id });
                          }}>
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* 实时日志 */}
        <TabsContent value="logs">
          <div ref={logBox} className="border border-border rounded-md bg-muted/50 p-3 h-[480px] overflow-y-auto font-data text-[11px] leading-relaxed">
            {logs.length === 0 && <div className="text-muted-foreground">暂无日志</div>}
            {logs.map((l) => (
              <div key={l.id} className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{new Date(l.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                <span className={
                  l.level === "error" ? "text-destructive" : l.level === "warn" ? "text-warning" : "text-foreground/85"
                }>{l.message}</span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* 题目回答详情 */}
      <Dialog open={itemDetail !== null} onOpenChange={(o) => !o && setItemDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailItem && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm flex items-center gap-2">
                  记录 #{detailItem.id} · {detailItem.modelName}
                  {detailItem.question && <CategoryBadge category={detailItem.question.category} />}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-xs">
                <section>
                  <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">题目（公开）</div>
                  <div className="bg-muted/40 rounded p-3 whitespace-pre-wrap">{detailItem.question?.prompt}</div>
                </section>
                {detailItem.question?.expectedAnswer && (
                  <section>
                    <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">参考答案</div>
                    <div className="bg-muted/40 rounded p-3 font-data">{detailItem.question.expectedAnswer}</div>
                  </section>
                )}
                <section>
                  <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">模型回答</div>
                  <div className="bg-muted/40 rounded p-3 whitespace-pre-wrap max-h-56 overflow-y-auto">
                    {detailItem.responseText ?? "（无响应）"}
                  </div>
                </section>
                {detailItem.error && (
                  <section>
                    <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">失败详情</div>
                    <div className="bg-destructive/10 text-destructive rounded p-3 font-data break-all">
                      {detailItem.error}（重试 {detailItem.retryCount} 次）
                    </div>
                  </section>
                )}
                <section>
                  <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">判分明细（公开规则）</div>
                  <div className="bg-muted/40 rounded p-3 space-y-1">
                    <div>规则分：<ScoreText score={detailItem.ruleScore} max={1} /> <span className="text-muted-foreground">{(detailItem.scoreDetail as { rule?: string } | null)?.rule}</span></div>
                    <div>评审分：<ScoreText score={detailItem.judgeScore} max={1} /> <span className="text-muted-foreground">{detailItem.judgeReason ?? ""}</span></div>
                    <div>最终分：<ScoreText score={detailItem.finalScore} max={1} />
                      {detailItem.reviewScore !== null && <span className="text-primary ml-2">（人工复核：{detailItem.reviewScore.toFixed(2)} {detailItem.reviewNote ? `· ${detailItem.reviewNote}` : ""}）</span>}
                    </div>
                    <div className="text-muted-foreground">判分通道：{(detailItem.scoreDetail as { channel?: string } | null)?.channel ?? "—"} · 时延 {fmtMs(detailItem.latencyMs)} · tokens {(detailItem.promptTokens ?? 0) + (detailItem.completionTokens ?? 0)}</div>
                  </div>
                </section>
                {detailItem.question?.rubric && (
                  <section>
                    <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">评分标准（公开）</div>
                    <div className="bg-muted/40 rounded p-3 whitespace-pre-wrap">{detailItem.question.rubric}</div>
                  </section>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <div className="mt-4 text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">{DISCLAIMER}</div>
      {confirmElement}
    </div>
  );
}
