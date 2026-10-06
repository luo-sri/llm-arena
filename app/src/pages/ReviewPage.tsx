import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { CategoryBadge, EmptyState, ScoreText } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export default function ReviewPage() {
  const utils = trpc.useUtils();
  const queue = trpc.reports.reviewQueue.useQuery(undefined, { refetchInterval: 5000 });
  const [activeId, setActiveId] = useState<number | null>(null);
  const [score, setScore] = useState(0.5);
  const [note, setNote] = useState("");

  const submit = trpc.reports.submitReview.useMutation({
    onSuccess: () => {
      toast.success("复核已提交，复核分已覆盖最终分");
      setActiveId(null); setNote("");
      utils.reports.reviewQueue.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const active = queue.data?.find((q) => q.id === activeId) ?? null;

  return (
    <div>
      <PageHeader
        title="人工复核"
        desc="规则判分与模型评审分歧超过阈值、或无任何通道得分的题目进入此队列，人工裁定后覆盖最终分"
      />
      {(queue.data?.length ?? 0) === 0 ? (
        <EmptyState text="复核队列为空" hint="当双通道判分出现显著分歧时，题目会自动进入此队列" />
      ) : (
        <div className="space-y-2">
          {queue.data!.map((q) => (
            <div key={q.id} className="border border-border rounded-md p-3.5 bg-card/60">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-data text-muted-foreground">#{q.id}</span>
                <span className="text-muted-foreground">{q.runName}</span>
                <span>{q.modelName}</span>
                {q.question && <CategoryBadge category={q.question.category} />}
                <span className="ml-auto flex items-center gap-3">
                  <span className="text-muted-foreground">规则 <ScoreText score={q.ruleScore} max={1} /></span>
                  <span className="text-muted-foreground">评审 <ScoreText score={q.judgeScore} max={1} /></span>
                  <Button size="sm" className="h-7 text-xs" onClick={() => { setActiveId(q.id); setScore(q.ruleScore ?? q.judgeScore ?? 0.5); setNote(""); }}>
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
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-muted-foreground text-[10px] uppercase">人工裁定分（0 ~ 1）</span>
                    <span className="font-data text-primary text-base font-semibold">{score.toFixed(2)}</span>
                  </div>
                  <Slider min={0} max={1} step={0.05} value={[score]} onValueChange={(v) => setScore(v[0])} />
                  <Textarea className="mt-3" rows={2} placeholder="复核备注（可选，将公开在报告中）" value={note} onChange={(e) => setNote(e.target.value)} />
                </section>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActiveId(null)}>取消</Button>
                <Button onClick={() => submit.mutate({ itemId: active.id, score, note: note || undefined })} disabled={submit.isPending}>
                  {submit.isPending ? "提交中…" : "提交复核"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
