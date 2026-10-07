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
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  ArrowLeft, Play, Pause, Square, RotateCcw, FileText, Eye, Trophy, RefreshCw,
  ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal,
} from "lucide-react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Cell,
} from "recharts";
import { CATEGORIES, DIFFICULTY_MAP, type SuiteConfig, DISCLAIMER } from "../../contracts/eval";

/** 逐题明细分页大小 */
const PAGE_SIZE = 100;

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
  const [page, setPage] = useState(1);
  /** 雷达图/维度类图表要展示的模型；null 表示全部 */
  const [radarModels, setRadarModels] = useState<number[] | null>(null);
  const items = trpc.runs.items.useQuery(
    {
      runId,
      modelId: modelFilter === "all" ? undefined : Number(modelFilter),
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    { refetchInterval: 4000 },
  );
  const itemRows = items.data?.rows ?? [];
  const itemTotal = items.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(itemTotal / PAGE_SIZE));
  const [detailItem, setDetailItem] = useState<NonNullable<typeof items.data>["rows"][number] | null>(null);
  const logBox = useRef<HTMLDivElement>(null);

  // 切换运行或筛选条件时回到第一页
  useEffect(() => { setPage(1); }, [runId, modelFilter, statusFilter]);
  // 记录数变化导致页码越界时回退
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  // 切换运行时重置雷达图勾选
  useEffect(() => { setRadarModels(null); }, [runId]);

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
  const retryFailed = trpc.runs.retryFailed.useMutation({
    onSuccess: (res) => {
      if (res.retried === 0) toast.info("当前没有失败状态的记录");
      else toast.success(`已重新排队 ${res.retried} 条失败记录，正在补跑（可切到「实时日志」查看进度）`);
      utils.runs.items.invalidate();
      utils.runs.get.invalidate();
      utils.runs.summary.invalidate();
    },
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

  const allSummary = useMemo(() => summary.data ?? [], [summary.data]);

  /** 颜色按模型在完整列表中的位置固定，勾选筛选不会改变配色 */
  const colorOf = (modelId: number) =>
    chart.series[Math.max(0, allSummary.findIndex((x) => x.modelId === modelId)) % chart.series.length];

  /** 雷达图 / 单项能力条形图 实际展示的模型集合（null = 全部模型） */
  const shownSummary = useMemo(() => {
    if (radarModels === null) return allSummary;
    const set = new Set(radarModels);
    return allSummary.filter((s) => set.has(s.modelId));
  }, [allSummary, radarModels]);

  const radarData = useMemo(() => {
    if (shownSummary.length === 0) return [];
    return CATEGORIES.map((c) => {
      const row: Record<string, string | number> = { dim: c.name };
      let has = false;
      for (const s of shownSummary) {
        if (s.categories[c.key] !== undefined) { row[s.modelName] = s.categories[c.key]; has = true; }
      }
      return has ? row : null;
    }).filter(Boolean) as Record<string, string | number>[];
  }, [shownSummary]);

  const barData = useMemo(() => {
    if (!summary.data) return [];
    return summary.data.map((s) => ({ name: s.modelName, 总分: s.total }));
  }, [summary.data]);

  const latencyData = useMemo(() => {
    if (!summary.data) return [];
    return summary.data.map((s) => ({ name: s.modelName, 平均时延: s.avgLatencyMs, P95时延: s.p95LatencyMs }));
  }, [summary.data]);

  /** 模型较多时旋转横轴标签，避免 Recharts 自动隐藏导致名称显示不全 */
  const axisDense = barData.length > 5;
  const shortName = (v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v);

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
          <TabsTrigger value="items" className="text-xs">逐题明细（{itemTotal}）</TabsTrigger>
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
                  <CardHeader className="py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-xs">维度雷达图</CardTitle>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="outline" className="h-7 text-xs">
                            <SlidersHorizontal className="h-3 w-3 mr-1" />
                            显示模型（{shownSummary.length}/{allSummary.length}）
                            <ChevronDown className="h-3 w-3 ml-1" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-64 p-0">
                          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                            <span className="text-[11px] text-muted-foreground">勾选要展示的模型</span>
                            <span className="flex gap-2">
                              <button className="text-[11px] text-primary hover:underline" onClick={() => setRadarModels(null)}>全选</button>
                              <button className="text-[11px] text-primary hover:underline" onClick={() => setRadarModels([])}>清空</button>
                            </span>
                          </div>
                          <div className="max-h-64 overflow-y-auto py-1">
                            {allSummary.map((s) => {
                              const checked = radarModels === null || radarModels.includes(s.modelId);
                              return (
                                <label key={s.modelId} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/40 cursor-pointer text-xs">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) => {
                                      const base = radarModels === null ? allSummary.map((x) => x.modelId) : [...radarModels];
                                      if (v) { if (!base.includes(s.modelId)) base.push(s.modelId); }
                                      else { const idx = base.indexOf(s.modelId); if (idx >= 0) base.splice(idx, 1); }
                                      setRadarModels(base);
                                    }}
                                  />
                                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: colorOf(s.modelId) }} />
                                  <span className="truncate" title={s.modelName}>{s.modelName}</span>
                                </label>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {shownSummary.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-16 text-center">未选择任何模型，请在右上角「显示模型」中勾选</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={300}>
                        <RadarChart data={radarData}>
                          <PolarGrid stroke={chart.grid} />
                          <PolarAngleAxis dataKey="dim" tick={{ fill: chart.tick, fontSize: 11 }} />
                          {shownSummary.map((s) => (
                            <Radar key={s.modelId} name={s.modelName} dataKey={s.modelName}
                              stroke={colorOf(s.modelId)} fill={colorOf(s.modelId)} fillOpacity={0.12} />
                          ))}
                          <Legend wrapperStyle={{ fontSize: 11, color: chart.legend }} />
                          <Tooltip contentStyle={chart.tooltip} itemStyle={{ color: chart.legend }} labelStyle={{ color: chart.legend }} />
                        </RadarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="py-2.5"><CardTitle className="text-xs">总分对比</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={barData}>
                        <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                        <XAxis
                          dataKey="name" interval={0}
                          tick={{ fill: chart.tick, fontSize: axisDense ? 10 : 11 }}
                          angle={axisDense ? -40 : 0}
                          textAnchor={axisDense ? "end" : "middle"}
                          height={axisDense ? 96 : 30}
                          tickFormatter={axisDense ? shortName : undefined}
                        />
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
                      {shownSummary.map((s) => (
                        <Bar key={s.modelId} name={s.modelName} dataKey={s.modelName} fill={colorOf(s.modelId)} radius={[0, 3, 3, 0]} />
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
                        <XAxis
                          dataKey="name" interval={0}
                          tick={{ fill: chart.tick, fontSize: axisDense ? 10 : 11 }}
                          angle={axisDense ? -40 : 0}
                          textAnchor={axisDense ? "end" : "middle"}
                          height={axisDense ? 96 : 30}
                          tickFormatter={axisDense ? shortName : undefined}
                        />
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
            <Button
              size="sm" variant="outline" className="h-8 text-xs ml-auto"
              disabled={retryFailed.isPending || (modelFilter === "all" && r.failedItems === 0)}
              onClick={async () => {
                if (await confirmDialog({
                  title: "批量重跑失败题目？",
                  description:
                    "所有失败状态的记录将重置并重新调用模型，原失败记录会被覆盖。适用于上游限流、超时或网络抖动导致的失败（并非模型回答错误），给模型一次公平的补考机会。",
                  confirmText: "批量重跑",
                })) retryFailed.mutate({ runId, modelId: modelFilter === "all" ? undefined : Number(modelFilter) });
              }}
            >
              <RotateCcw className={`h-3.5 w-3.5 mr-1 ${retryFailed.isPending ? "animate-spin" : ""}`} />
              {retryFailed.isPending
                ? "提交中…"
                : `批量重跑失败${modelFilter === "all" ? `（${r.failedItems}）` : ""}`}
            </Button>
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
                {itemRows.length === 0 && (
                  <tr><td colSpan={11} className="px-2.5 py-10 text-center text-muted-foreground">当前筛选下没有记录</td></tr>
                )}
                {itemRows.map((i) => (
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
                          onClick={() => setDetailItem(i)}><Eye className="h-3 w-3" /></Button>
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
          {/* 分页：题目量大时逐页浏览，避免记录显示不全 */}
          <div className="flex items-center justify-between mt-3 text-xs">
            <span className="text-muted-foreground">
              第 {(page - 1) * PAGE_SIZE + (itemRows.length ? 1 : 0)}–{(page - 1) * PAGE_SIZE + itemRows.length} 条 · 共 {itemTotal} 条
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 px-2"
                disabled={page === 1} onClick={() => setPage(1)}>首页</Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                disabled={page === 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="w-14 text-center font-data">{page}/{totalPages}</span>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2"
                disabled={page >= totalPages} onClick={() => setPage(totalPages)}>末页</Button>
            </div>
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
      <Dialog open={detailItem !== null} onOpenChange={(o) => !o && setDetailItem(null)}>
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
