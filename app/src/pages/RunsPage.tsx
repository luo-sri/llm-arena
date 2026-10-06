import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { StatusBadge, EmptyState, fmtTime } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Play, Pause, Square, Trash2, GitCompareArrows, Search, X, Copy, Eraser } from "lucide-react";
import { CATEGORY_MAP, type SuiteConfig } from "../../contracts/eval";
import { ScoreText } from "@/components/common";
import { useConfirm } from "@/components/confirm";

/** 一键清空的重复确认次数（防止误触） */
const CLEAR_CONFIRM_STEPS = 3;

export default function RunsPage({ onOpenRun }: { onOpenRun: (id: number) => void }) {
  const utils = trpc.useUtils();
  const [confirmDialog, confirmElement] = useConfirm();
  const list = trpc.runs.list.useQuery(undefined, { refetchInterval: 3000 });
  const suites = trpc.suites.list.useQuery();
  const modelsList = trpc.models.list.useQuery();

  const [dialog, setDialog] = useState<"create" | "compare" | null>(null);
  const [name, setName] = useState("");
  const [suiteId, setSuiteId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** 评审通道：suite=跟随套件 / machine=机器审核 / model-<id>=指定评审模型 */
  const [judgeMode, setJudgeMode] = useState<string>("suite");
  const [cmpA, setCmpA] = useState<number | null>(null);
  const [cmpB, setCmpB] = useState<number | null>(null);
  /** 搜索关键词：匹配运行名称 / 编号 / 套件名 */
  const [query, setQuery] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [clearStep, setClearStep] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const invalidate = () => utils.runs.list.invalidate();
  const create = trpc.runs.create.useMutation({
    onSuccess: (r) => {
      toast.success(`运行已创建（${r.totalItems} 个题目任务），后台执行中`);
      setDialog(null); setSelected(new Set()); setName(""); setJudgeMode("suite");
      invalidate();
      onOpenRun(r.runId);
    },
    onError: (e) => toast.error(e.message),
  });
  const pause = trpc.runs.pause.useMutation({ onSuccess: () => { toast.success("已暂停"); invalidate(); } });
  const resume = trpc.runs.resume.useMutation({ onSuccess: () => { toast.success("已继续"); invalidate(); } });
  const cancel = trpc.runs.cancel.useMutation({ onSuccess: () => { toast.success("已取消"); invalidate(); } });
  const remove = trpc.runs.remove.useMutation({
    onSuccess: () => { toast.success("已删除"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const clearAll = trpc.runs.clearAll.useMutation({
    onSuccess: (res) => {
      toast.success(
        `已清空 ${res.deleted} 条评测记录${res.reports > 0 ? `，并移除 ${res.reports} 份关联报告` : ""}`,
      );
      setClearOpen(false); setClearStep(0); invalidate();
    },
    onError: (e) => { toast.error(e.message); setClearStep(0); },
  });

  const compare = trpc.runs.compare.useQuery(
    { runIdA: cmpA ?? -1, runIdB: cmpB ?? -1 },
    { enabled: dialog === "compare" && cmpA !== null && cmpB !== null },
  );

  const suite = useMemo(() => suites.data?.find((s) => s.id === suiteId), [suites.data, suiteId]);

  // 打开新建弹窗时默认选中专业竞赛套件（竞技场深度评测），避免误用裁剪维度的小套件
  useEffect(() => {
    if (dialog === "create" && suiteId === null && suites.data?.length) {
      const pro = suites.data.find((s) => s.name.includes("竞技场深度")) ?? suites.data[0];
      setSuiteId(pro.id);
    }
  }, [dialog, suiteId, suites.data]);

  // 快捷键：Ctrl/Cmd+K 聚焦搜索，Esc 清空搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const enabledModels = modelsList.data?.models.filter((m) => m.enabled) ?? [];
  const completedRuns = list.data?.filter((r) => r.status === "completed") ?? [];

  /** 旧记录没有套件名快照时，回退到套件表实时查找 */
  const suiteNameById = useMemo(
    () => new Map((suites.data ?? []).map((s) => [s.id, s.name])),
    [suites.data],
  );
  const suiteLabelOf = (r: { suiteId: number | null; suiteName: string | null }) =>
    r.suiteName ?? (r.suiteId != null ? suiteNameById.get(r.suiteId) : undefined) ?? "套件已删除";

  const runs = list.data ?? [];
  const activeCount = runs.filter((r) => r.active || r.status === "running" || r.status === "paused" || r.status === "pending").length;
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return runs;
    return runs.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        String(r.id).includes(q) ||
        suiteLabelOf(r).toLowerCase().includes(q),
    );
  }, [runs, q, suiteNameById]);

  /** 套件自带评审配置的描述（跟随套件时展示） */
  const suiteJudgeDesc = useMemo(() => {
    if (!suite) return null;
    const c = suite.config as SuiteConfig;
    if (!c.judgeEnabled || !c.judgeModelId) return "机器审核";
    const n = modelsList.data?.models.find((m) => m.id === c.judgeModelId)?.name ?? `#${c.judgeModelId}`;
    return `AI 评审：${n}`;
  }, [suite, modelsList.data]);

  const estimate = useMemo(() => {
    if (!suite) return null;
    const cfg = suite.config as SuiteConfig;
    return { models: selected.size, repeat: cfg.params.repeatCount };
  }, [suite, selected]);

  return (
    <div>
      <PageHeader
        title="评测任务"
        desc="后台队列批量执行 · 并发控制 · 实时日志 · 暂停/继续/取消 · 单题重跑"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => { setCmpA(null); setCmpB(null); setDialog("compare"); }}>
              <GitCompareArrows className="h-3.5 w-3.5 mr-1" />版本对比
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={runs.length === 0}
              title={activeCount > 0 ? "有进行中的运行，需先全部取消或等待完成" : "清空全部评测记录"}
              onClick={() => { setClearStep(0); setClearOpen(true); }}
            >
              <Eraser className="h-3.5 w-3.5 mr-1" />清空记录
              {runs.length > 0 && <span className="ml-1 text-[10px] text-muted-foreground font-data">({runs.length})</span>}
            </Button>
            <Button size="sm" onClick={() => { setJudgeMode("suite"); setDialog("create"); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />新建评测
            </Button>
          </>
        }
      />

      {runs.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
            <Input
              ref={searchRef}
              className="h-8 pl-8 pr-16 text-xs"
              placeholder="搜索任务名称 / 编号 / 套件名…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button
                className="absolute right-2 top-1.5 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                onClick={() => { setQuery(""); searchRef.current?.focus(); }}
                title="清除搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="absolute right-2 top-1.5 hidden sm:flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground font-data pointer-events-none">
                Ctrl K
              </kbd>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground font-data">
            {q ? `匹配 ${filtered.length} / ${runs.length} 条` : `共 ${runs.length} 条`}
            {activeCount > 0 && <span className="text-info"> · {activeCount} 个进行中</span>}
          </span>
        </div>
      )}

      {runs.length === 0 ? (
        <EmptyState text="暂无评测运行" hint="点击「新建评测」选择套件与模型开始" />
      ) : filtered.length === 0 ? (
        <EmptyState text={`没有匹配「${query}」的评测任务`} hint="试试其他关键词，或清除搜索条件" />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const done = r.doneItems + r.failedItems;
            const pct = r.totalItems ? Math.round((done / r.totalItems) * 100) : 0;
            const suiteName = suiteLabelOf(r);
            return (
              <div
                key={r.id}
                className="group border border-border rounded-md p-3.5 bg-card/60 transition-all duration-150 hover:border-foreground/25 hover:bg-card hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <button
                    className="font-data text-muted-foreground text-xs hover:text-primary transition-colors"
                    title="复制运行编号"
                    onClick={() => {
                      void navigator.clipboard?.writeText(String(r.id));
                      toast.success(`已复制编号 #${r.id}`);
                    }}
                  >
                    #{r.id}
                  </button>
                  <button className="text-sm font-medium hover:text-primary transition-colors" onClick={() => onOpenRun(r.id)}>{r.name}</button>
                  <StatusBadge status={r.status} />
                  {/* 任务说明：自动带出本次运行使用的套件名称 */}
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <span className="text-muted-foreground/60">套件</span>
                    <span className="text-foreground/80">{suiteName}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground font-data">
                    种子={r.seed} · 题库 {r.bankVersion}#{r.bankHash}
                  </span>
                  {(() => {
                    const snap = r.paramSnapshot as SuiteConfig | null;
                    if (!snap?.judgeEnabled || !snap.judgeModelId) {
                      return <span className="text-[11px] text-muted-foreground/70">机器审核</span>;
                    }
                    const n = modelsList.data?.models.find((m) => m.id === snap.judgeModelId)?.name ?? `#${snap.judgeModelId}`;
                    return <span className="text-[11px] text-info">AI 评审·{n}</span>;
                  })()}
                  <span className="text-[11px] text-muted-foreground ml-auto">{fmtTime(r.createdAt)}</span>
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-accent transition-opacity"
                    title="复制运行编号"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`#${r.id} ${r.name}`);
                      toast.success("已复制任务信息");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <Progress value={pct} className="h-1.5 flex-1" />
                  <span className="text-[11px] font-data text-muted-foreground w-28 text-right">
                    {done}/{r.totalItems}（失败 {r.failedItems}）
                  </span>
                  <div className="flex gap-1">
                    {r.status === "running" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => pause.mutate({ id: r.id })}>
                        <Pause className="h-3 w-3 mr-1" />暂停
                      </Button>
                    )}
                    {r.status === "paused" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => resume.mutate({ id: r.id })}>
                        <Play className="h-3 w-3 mr-1" />继续
                      </Button>
                    )}
                    {(r.status === "running" || r.status === "paused") && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-destructive"
                        onClick={async () => {
                          if (await confirmDialog({ title: `取消运行 #${r.id}？`, description: "剩余题目将标记为跳过，已完成的结果保留。", confirmText: "取消运行", destructive: true })) cancel.mutate({ id: r.id });
                        }}>
                        <Square className="h-3 w-3 mr-1" />取消
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpenRun(r.id)}>详情</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                      onClick={async () => {
                        if (await confirmDialog({ title: `删除运行 #${r.id}？`, description: "该运行的全部明细与日志将被永久删除，且无法恢复。", confirmText: "永久删除", destructive: true })) remove.mutate({ id: r.id });
                      }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 新建评测 */}
      <Dialog open={dialog === "create"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>新建评测运行</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <Label>运行名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`评测 ${new Date().toLocaleDateString("zh-CN")}`} />
            </div>
            <div>
              <Label>测试套件（题目/权重/参数/判分通道）</Label>
              <Select value={suiteId ? String(suiteId) : ""} onValueChange={(v) => setSuiteId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="选择套件…" /></SelectTrigger>
                <SelectContent>
                  {suites.data?.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {suite && (
                <p className="text-[11px] text-muted-foreground mt-1 font-data">
                  {Object.entries((suite.config as SuiteConfig).categories).filter(([, c]) => c.enabled)
                    .map(([k]) => CATEGORY_MAP[k]?.name).join(" / ")}
                </p>
              )}
            </div>
            <div>
              <Label>受测模型（{selected.size} 个已选，全部使用相同题目/顺序/参数）</Label>
              <div className="border border-border rounded-md max-h-52 overflow-y-auto mt-1">
                {enabledModels.map((m) => (
                  <label key={m.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-border/50 text-xs hover:bg-accent/40 cursor-pointer">
                    <Checkbox
                      checked={selected.has(m.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        if (v) next.add(m.id); else next.delete(m.id);
                        setSelected(next);
                      }}
                    />
                    <span>{m.name}</span>
                    <span className="text-muted-foreground font-data ml-auto">{m.modelId}</span>
                  </label>
                ))}
                {enabledModels.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无启用的模型，请先在「模型管理」添加</div>
                )}
              </div>
            </div>
            {estimate && estimate.models > 0 && (
              <div className="text-[11px] text-muted-foreground font-data bg-muted/40 rounded px-3 py-2">
                预计任务数 = 题量 × {estimate.models} 模型 × {estimate.repeat} 轮
              </div>
            )}
            <div>
              <Label>评审通道（AI 评审老师 · 可选）</Label>
              <Select value={judgeMode} onValueChange={setJudgeMode}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="suite">
                    跟随套件配置{suiteJudgeDesc ? `（${suiteJudgeDesc}）` : ""}
                  </SelectItem>
                  <SelectItem value="machine">机器审核（公开规则判分，不启用 AI 评审）</SelectItem>
                  {enabledModels.map((m) => (
                    <SelectItem key={m.id} value={`model-${m.id}`} disabled={selected.has(m.id)}>
                      {m.name} · AI 评审老师{selected.has(m.id) ? "（受测中，按回避原则不可兼任）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                AI 评审老师依据每题公开的评分标准与评分锚点独立打分，与规则判分双通道互校，分歧超阈值自动进入人工复核；为绝对公正，评审模型不可同时作为受测模型（选手/裁判回避）。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>取消</Button>
            <Button
              disabled={!suiteId || selected.size === 0 || create.isPending}
              onClick={() => {
                const judgeOverride = judgeMode === "suite" ? "suite" : judgeMode === "machine" ? "machine" : "model";
                create.mutate({
                  name: name.trim() || `评测 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
                  suiteId: suiteId!,
                  modelIds: [...selected],
                  judgeOverride,
                  ...(judgeOverride === "model" ? { judgeModelId: Number(judgeMode.slice(6)) } : {}),
                });
              }}
            >
              {create.isPending ? "创建中…" : "创建并开始"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 版本对比 */}
      <Dialog open={dialog === "compare"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>版本对比（两次已完成运行）</DialogTitle></DialogHeader>
          <div className="flex gap-3 mb-4">
            <Select value={cmpA ? String(cmpA) : ""} onValueChange={(v) => setCmpA(Number(v))}>
              <SelectTrigger className="text-xs"><SelectValue placeholder="运行 A…" /></SelectTrigger>
              <SelectContent>
                {completedRuns.map((r) => <SelectItem key={r.id} value={String(r.id)}>#{r.id} {r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={cmpB ? String(cmpB) : ""} onValueChange={(v) => setCmpB(Number(v))}>
              <SelectTrigger className="text-xs"><SelectValue placeholder="运行 B…" /></SelectTrigger>
              <SelectContent>
                {completedRuns.map((r) => <SelectItem key={r.id} value={String(r.id)}>#{r.id} {r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {compare.data && (
            <CompareTable data={compare.data} />
          )}
        </DialogContent>
      </Dialog>
      {/* 一键清空：需连续点击确认多次，防止误触 */}
      <AlertDialog
        open={clearOpen}
        onOpenChange={(o) => { if (!o) { setClearOpen(false); setClearStep(0); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空全部评测记录？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除全部 <span className="font-data text-foreground">{runs.length}</span> 条评测记录，及其逐题明细、实时日志、竞技场战报与由运行生成的报告。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 text-xs leading-relaxed">
            <p className="text-muted-foreground">题库、模型、测试套件与人工复核配置不受影响。</p>
            {activeCount > 0 ? (
              <p className="text-destructive">检测到 {activeCount} 个进行中的运行，请先取消或等待完成后再清空。</p>
            ) : (
              <p className="text-destructive font-medium">
                为防止误操作，需连续点击下方按钮 {CLEAR_CONFIRM_STEPS} 次方可执行。
              </p>
            )}
            {clearStep > 0 && (
              <div className="flex items-center gap-2">
                <Progress value={(clearStep / CLEAR_CONFIRM_STEPS) * 100} className="h-1.5 flex-1" />
                <span className="font-data text-[11px] text-destructive">
                  {clearStep}/{CLEAR_CONFIRM_STEPS}
                </span>
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setClearOpen(false); setClearStep(0); }}>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={activeCount > 0 || clearAll.isPending}
              onClick={() => {
                const next = clearStep + 1;
                if (next >= CLEAR_CONFIRM_STEPS) {
                  clearAll.mutate();
                } else {
                  setClearStep(next);
                  toast.warning(`还需点击 ${CLEAR_CONFIRM_STEPS - next} 次以确认清空`);
                }
              }}
            >
              {clearAll.isPending
                ? "清空中…"
                : clearStep === 0
                  ? `点击确认清空（共需 ${CLEAR_CONFIRM_STEPS} 次）`
                  : `再点击确认（还剩 ${CLEAR_CONFIRM_STEPS - clearStep} 次）`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {confirmElement}
    </div>
  );
}

function CompareTable({ data }: { data: { summaryA: { modelId: number; modelName: string; total: number; categories: Record<string, number>; categoryNames: Record<string, string> }[]; summaryB: { modelId: number; modelName: string; total: number; categories: Record<string, number>; categoryNames: Record<string, string> }[]; runA: { name: string }; runB: { name: string } } }) {
  const { summaryA, summaryB, runA, runB } = data;
  const cats = [...new Set([...summaryA.flatMap((s) => Object.keys(s.categories)), ...summaryB.flatMap((s) => Object.keys(s.categories))])];
  const modelNames = [...new Set([...summaryA.map((s) => s.modelName), ...summaryB.map((s) => s.modelName)])];
  const findA = (n: string) => summaryA.find((s) => s.modelName === n);
  const findB = (n: string) => summaryB.find((s) => s.modelName === n);
  const diff = (a?: number, b?: number) => {
    if (a === undefined || b === undefined) return <span className="text-muted-foreground">—</span>;
    const d = b - a;
    const cls = d > 0.05 ? "text-success" : d < -0.05 ? "text-destructive" : "text-muted-foreground";
    return <span className={`font-data ${cls}`}>{d > 0 ? "+" : ""}{d.toFixed(1)}</span>;
  };
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr className="text-left text-muted-foreground">
            <th className="px-3 py-2 font-normal">模型</th>
            <th className="px-3 py-2 font-normal text-right">总分 A</th>
            <th className="px-3 py-2 font-normal text-right">总分 B</th>
            <th className="px-3 py-2 font-normal text-right">Δ</th>
            {cats.map((c) => <th key={c} className="px-3 py-2 font-normal text-right">{CATEGORY_MAP[c]?.name ?? c} Δ</th>)}
          </tr>
        </thead>
        <tbody>
          {modelNames.map((n) => {
            const a = findA(n); const b = findB(n);
            return (
              <tr key={n} className="border-t border-border/60">
                <td className="px-3 py-2">{n}</td>
                <td className="px-3 py-2 text-right">{a ? <ScoreText score={a.total} /> : "—"}</td>
                <td className="px-3 py-2 text-right">{b ? <ScoreText score={b.total} /> : "—"}</td>
                <td className="px-3 py-2 text-right">{diff(a?.total, b?.total)}</td>
                {cats.map((c) => <td key={c} className="px-3 py-2 text-right">{diff(a?.categories[c], b?.categories[c])}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">A：{runA.name} · B：{runB.name} · Δ = B − A</div>
    </div>
  );
}
