import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { CategoryBadge, EmptyState, ScoreText } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCheck, ListChecks, X } from "lucide-react";
import { useConfirm } from "@/components/confirm";

/** 统一校验人工分：0~1，保留两位小数 */
function parseScore(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return Math.round(n * 100) / 100;
}

export default function ReviewPage() {
  const utils = trpc.useUtils();
  const [confirmDialog, confirmElement] = useConfirm();
  const queue = trpc.reports.reviewQueue.useQuery(undefined, { refetchInterval: 5000 });
  const queueList = queue.data ?? [];

  const [activeId, setActiveId] = useState<number | null>(null);
  const [scoreInput, setScoreInput] = useState("");
  const [note, setNote] = useState("");

  /** 勾选批量打分 */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchScore, setBatchScore] = useState("0.80");
  const [batchNote, setBatchNote] = useState("");

  const invalidate = () => utils.reports.reviewQueue.invalidate();

  const submit = trpc.reports.submitReview.useMutation({
    onSuccess: () => {
      toast.success("复核已提交，复核分已覆盖最终分");
      setActiveId(null); setNote("");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  /** 批量审批：全部采纳 AI 评审分（无评审分时回退规则分） */
  const approveAll = trpc.reports.approveAllJudgeScores.useMutation({
    onSuccess: (r) => {
      if (r.approved === 0) toast.info("复核队列已是空的");
      else toast.success(
        `已批量审批 ${r.approved} 条：采纳 AI 评审分作为最终分${r.fallback > 0 ? `（其中 ${r.fallback} 条无评审分，已采纳规则分）` : ""}`,
      );
      setSelected(new Set());
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  /** 批量打分：对勾选记录统一写入人工分 */
  const batchReview = trpc.reports.batchReview.useMutation({
    onSuccess: (r) => {
      toast.success(`已为 ${r.updated} 条复核记录统一打分`);
      setBatchOpen(false); setBatchNote(""); setSelected(new Set());
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const ignoreAll = trpc.reports.ignoreAllReviews.useMutation({
    onSuccess: (r) => {
      if (r.ignored === 0) toast.info("复核队列已是空的");
      else toast.success(`已忽略 ${r.ignored} 条复核，采纳自动判分${r.patched ? `（其中 ${r.patched} 条补齐了自动分）` : ""}`);
      setSelected(new Set());
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // 队列刷新后剔除已不在队列中的勾选项
  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(queueList.map((q) => q.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [queueList]);

  const active = queueList.find((q) => q.id === activeId) ?? null;

  const allSelected = queueList.length > 0 && selected.size === queueList.length;
  const selectedCount = selected.size;
  const headerCheckState: boolean | "indeterminate" = allSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;
  const selectedInQueue = useMemo(
    () => queueList.filter((q) => selected.has(q.id)).map((q) => q.id),
    [queueList, selected],
  );

  const toggleOne = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(queueList.map((q) => q.id)) : new Set());
  };

  const openSingle = (q: NonNullable<(typeof queueList)[number]>) => {
    setActiveId(q.id);
    // 默认显示当前判定分（最终分 → 评审分 → 规则分），可手动改写
    setScoreInput((q.finalScore ?? q.judgeScore ?? q.ruleScore ?? 0.5).toFixed(2));
    setNote("");
  };

  const submitSingle = () => {
    if (!active) return;
    const s = parseScore(scoreInput);
    if (s === null) { toast.error("请输入 0 ~ 1 之间的分数（支持两位小数）"); return; }
    submit.mutate({ itemId: active.id, score: s, note: note || undefined });
  };

  const submitBatch = () => {
    const s = parseScore(batchScore);
    if (s === null) { toast.error("请输入 0 ~ 1 之间的分数（支持两位小数）"); return; }
    if (selectedInQueue.length === 0) { toast.error("请先勾选需要打分的复核记录"); return; }
    batchReview.mutate({ itemIds: selectedInQueue, score: s, note: batchNote || undefined });
  };

  return (
    <div>
      <PageHeader
        title="人工复核"
        desc="规则判分与模型评审分歧超过阈值、或无任何通道得分的题目进入此队列，人工裁定后覆盖最终分。AI 裁判模式的任务以评审分作为最终分，不会进入本队列。"
        actions={
          queueList.length > 0 ? (
            <>
              <Button
                size="sm" variant="outline" disabled={approveAll.isPending}
                onClick={async () => {
                  if (await confirmDialog({
                    title: `批量审批全部 ${queueList.length} 条复核？`,
                    description:
                      "将把每条记录当前的 AI 评审分直接作为最终分（无评审分的记录回退采用规则分），等同于全部同意 AI 裁判的评分。此操作不可撤销。",
                    confirmText: "批量审批",
                  })) approveAll.mutate();
                }}
              >
                <ListChecks className="h-3.5 w-3.5 mr-1" />
                {approveAll.isPending ? "处理中…" : `批量审批 AI 评审分（${queueList.length}）`}
              </Button>
              <Button
                size="sm" variant="outline" disabled={ignoreAll.isPending}
                onClick={async () => {
                  if (await confirmDialog({
                    title: `忽略全部 ${queueList.length} 条复核？`,
                    description: "将采纳每条题目当前的自动判分（规则分 / 评审分）作为最终分，等同于默认认可该任务的评分，之后不再需要人工裁定。此操作不可撤销。",
                    confirmText: "全部忽略",
                  })) ignoreAll.mutate();
                }}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                {ignoreAll.isPending ? "处理中…" : `全部忽略（${queueList.length}）`}
              </Button>
            </>
          ) : undefined
        }
      />

      {queueList.length === 0 ? (
        <EmptyState text="复核队列为空" hint="当双通道判分出现显著分歧时，题目会自动进入此队列；AI 裁判模式不会产生复核项" />
      ) : (
        <div className="space-y-2">
          {/* 勾选工具栏：全选 / 取消全选 / 批量打分 */}
          <div className="flex items-center gap-3 border border-border rounded-md px-3 py-2 bg-card/60">
            <Checkbox
              checked={headerCheckState}
              onCheckedChange={(v) => toggleAll(v === true)}
            />
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => toggleAll(!allSelected)}>
              {allSelected ? "取消全选" : "全选"}
            </button>
            <span className="text-[11px] text-muted-foreground font-data">已选 {selectedCount} / {queueList.length}</span>
            <div className="ml-auto flex items-center gap-2">
              {selectedCount > 0 && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
                  <X className="h-3 w-3 mr-1" />清空选择
                </Button>
              )}
              <Button size="sm" className="h-7 text-xs" disabled={selectedCount === 0} onClick={() => setBatchOpen(true)}>
                <ListChecks className="h-3.5 w-3.5 mr-1" />批量打分（{selectedCount}）
              </Button>
            </div>
          </div>

          {queueList.map((q) => (
            <div
              key={q.id}
              className={`border rounded-md p-3.5 bg-card/60 transition-colors ${selected.has(q.id) ? "border-primary/50" : "border-border"}`}
            >
              <div className="flex items-center gap-2 text-xs">
                <Checkbox checked={selected.has(q.id)} onCheckedChange={(v) => toggleOne(q.id, v === true)} />
                <span className="font-data text-muted-foreground">#{q.id}</span>
                <span className="text-muted-foreground">{q.runName}</span>
                <span>{q.modelName}</span>
                {q.question && <CategoryBadge category={q.question.category} />}
                <span className="ml-auto flex items-center gap-3">
                  <span className="text-muted-foreground">规则 <ScoreText score={q.ruleScore} max={1} /></span>
                  <span className="text-muted-foreground">评审 <ScoreText score={q.judgeScore} max={1} /></span>
                  <Button size="sm" className="h-7 text-xs" onClick={() => openSingle(q)}>
                    开始复核
                  </Button>
                </span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground truncate">题目：{q.question?.prompt}</div>
              <div className="mt-1 text-xs truncate">回答：{q.responseText ?? "（无响应）"}</div>
            </div>
          ))}
        </div>
      )}

      {/* 单条复核：直接输入数字，0.01 精度 */}
      <Dialog open={activeId !== null} onOpenChange={(o) => !o && setActiveId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {active && (
            <>
              <DialogHeader><DialogTitle className="text-sm">人工复核 · 记录 #{active.id}</DialogTitle></DialogHeader>
              <div className="space-y-3 text-xs">
                <section>
                  <div className="text-muted-foreground mb-1 text-[10px] uppercase">题目</div>
                  <div className="bg-muted/40 rounded p-3 whitespace-pre-wrap">{active.question?.prompt}</div>
                </section>
                {active.question?.rubric && (
                  <section>
                    <div className="text-muted-foreground mb-1 text-[10px] uppercase">评分标准（公开）</div>
                    <div className="bg-muted/40 rounded p-3 whitespace-pre-wrap">{active.question.rubric}</div>
                  </section>
                )}
                {active.question?.expectedAnswer && (
                  <section>
                    <div className="text-muted-foreground mb-1 text-[10px] uppercase">参考答案</div>
                    <div className="bg-muted/40 rounded p-3 font-data">{active.question.expectedAnswer}</div>
                  </section>
                )}
                <section>
                  <div className="text-muted-foreground mb-1 text-[10px] uppercase">模型回答</div>
                  <div className="bg-muted/40 rounded p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">{active.responseText ?? "（无响应）"}</div>
                </section>
                <section className="bg-muted/40 rounded p-3">
                  <div>规则分：<ScoreText score={active.ruleScore} max={1} /> <span className="text-muted-foreground">{(active.scoreDetail as { rule?: string } | null)?.rule}</span></div>
                  <div className="mt-1">评审分：<ScoreText score={active.judgeScore} max={1} /> <span className="text-muted-foreground">{active.judgeReason ?? ""}</span></div>
                </section>
                <section>
                  <div className="flex items-center justify-between mb-2 gap-3">
                    <span className="text-muted-foreground text-[10px] uppercase">人工裁定分（0 ~ 1，支持两位小数）</span>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={0} max={1} step={0.01}
                        className="h-8 w-24 font-data text-right"
                        value={scoreInput}
                        onChange={(e) => setScoreInput(e.target.value)}
                        onBlur={() => {
                          const s = parseScore(scoreInput);
                          if (s !== null) setScoreInput(s.toFixed(2));
                        }}
                      />
                      <span className="text-muted-foreground text-[11px]">/ 1.00</span>
                    </div>
                  </div>
                  <Textarea className="mt-2" rows={2} placeholder="复核备注（可选，将公开在报告中）" value={note} onChange={(e) => setNote(e.target.value)} />
                </section>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActiveId(null)}>取消</Button>
                <Button onClick={submitSingle} disabled={submit.isPending || parseScore(scoreInput) === null}>
                  {submit.isPending ? "提交中…" : "提交复核"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 批量打分：统一输入一个分数 */}
      <Dialog open={batchOpen} onOpenChange={(o) => !o && setBatchOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">批量打分（{selectedInQueue.length} 条）</DialogTitle></DialogHeader>
          <div className="space-y-3 text-xs">
            <p className="text-muted-foreground leading-relaxed">
              将为勾选的 {selectedInQueue.length} 条复核记录统一写入同一人工分，并覆盖各自最终分。该操作不可撤销。
            </p>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-[11px]">统一分数（0 ~ 1）</span>
              <Input
                type="number" min={0} max={1} step={0.01}
                className="h-8 w-24 font-data text-right"
                value={batchScore}
                onChange={(e) => setBatchScore(e.target.value)}
                onBlur={() => {
                  const s = parseScore(batchScore);
                  if (s !== null) setBatchScore(s.toFixed(2));
                }}
              />
              <span className="text-muted-foreground text-[11px]">/ 1.00</span>
            </div>
            <Textarea rows={2} placeholder="批量备注（可选，将公开在报告中）" value={batchNote} onChange={(e) => setBatchNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>取消</Button>
            <Button onClick={submitBatch} disabled={batchReview.isPending || parseScore(batchScore) === null || selectedInQueue.length === 0}>
              {batchReview.isPending ? "提交中…" : `确认打分（${selectedInQueue.length}）`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmElement}
    </div>
  );
}
