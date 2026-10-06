import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { EmptyState, fmtTime, download } from "@/components/common";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Copy, Download, Trash2, ExternalLink, FileJson, FileText } from "lucide-react";
import { DISCLAIMER, CATEGORY_MAP } from "../../contracts/eval";
import { useConfirm } from "@/components/confirm";

export default function ReportsPage() {
  const utils = trpc.useUtils();
  const [confirmDialog, confirmElement] = useConfirm();
  const list = trpc.reports.list.useQuery();
  const [exporting, setExporting] = useState<string | null>(null);

  const remove = trpc.reports.remove.useMutation({
    onSuccess: () => { toast.success("报告已删除"); utils.reports.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const shareUrl = (shareId: string) =>
    `${window.location.origin}${window.location.pathname}?report=${shareId}`;

  const copyLink = (shareId: string) => {
    navigator.clipboard?.writeText(shareUrl(shareId)).then(
      () => toast.success("分享链接已复制"),
      () => toast.info(shareUrl(shareId)),
    );
  };

  /** 导出 JSON（完整数据：题库版本/参数快照/逐题明细/免责声明） */
  const exportJson = async (shareId: string, title: string) => {
    setExporting(shareId);
    try {
      const data = await utils.reports.getByShare.fetch({ shareId });
      download(`${title}.json`, JSON.stringify(data, null, 2));
      toast.success("JSON 报告已导出");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(null);
    }
  };

  /** 导出 Markdown 文档 */
  const exportMd = async (shareId: string, title: string) => {
    setExporting(shareId);
    try {
      const d = await utils.reports.getByShare.fetch({ shareId });
      const cfg = d.run.paramSnapshot as { params: Record<string, unknown>; judgeEnabled: boolean };
      const lines: string[] = [
        `# ${d.title}`,
        "",
        `- 运行：#${d.run.id} ${d.run.name}（${d.run.status}）`,
        `- 题库版本：${d.run.bankVersion} · 内容哈希：${d.run.bankHash}`,
        `- 参数快照：${Object.entries(cfg.params).map(([k, v]) => `${k}=${v}`).join("，")}；评审通道=${cfg.judgeEnabled ? "双通道" : "仅规则"}`,
        `- 时间：${fmtTime(d.run.startedAt)} ~ ${fmtTime(d.run.finishedAt)}`,
        `- 题目任务：共 ${d.run.totalItems}，成功 ${d.run.doneItems}，失败 ${d.run.failedItems}`,
        "",
        "## 模型排名",
        "",
        "| 排名 | 模型 | 总分 | 成功率 | 平均时延 | Tokens | 估算成本 |",
        "|---|---|---|---|---|---|---|",
        ...d.summaries.map((s) => `| ${s.rank} | ${s.modelName} | ${s.total.toFixed(1)} | ${(s.successRate * 100).toFixed(1)}% | ${s.avgLatencyMs}ms | ${s.totalTokens} | $${s.estimatedCost.toFixed(4)} |`),
        "",
        "## 维度得分",
        "",
      ];
      for (const s of d.summaries) {
        lines.push(`### ${s.modelName}`, "");
        for (const [k, v] of Object.entries(s.categories)) {
          lines.push(`- ${CATEGORY_MAP[k]?.name ?? k}：${v.toFixed(1)}`);
        }
        lines.push("");
      }
      lines.push("## 逐题明细", "");
      for (const i of d.items) {
        lines.push(
          `### [${i.seq + 1}] ${i.modelName} · ${CATEGORY_MAP[i.category]?.name ?? i.category} · 第 ${i.repeatIndex + 1} 轮`,
          "",
          `**题目**：${i.prompt}`,
          "",
          i.expectedAnswer ? `**参考答案**：${i.expectedAnswer}` : "",
          `**模型回答**：${(i.responseText ?? i.error ?? "（无）").slice(0, 2000)}`,
          "",
          `**得分**：规则 ${i.ruleScore ?? "—"} / 评审 ${i.judgeScore ?? "—"} / 最终 ${i.finalScore ?? "—"}${i.reviewScore !== null ? `（人工复核 ${i.reviewScore}）` : ""}`,
          "",
          "---",
          "",
        );
      }
      lines.push("## 免责声明", "", DISCLAIMER, "");
      download(`${title}.md`, lines.join("\n"), "text/markdown");
      toast.success("Markdown 报告已导出");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div>
      <PageHeader title="报告中心" desc="一键生成可公开分享的评测报告（网页 / Markdown 文档 / JSON），在运行详情页点击「生成分享报告」" />
      {(list.data?.length ?? 0) === 0 ? (
        <EmptyState text="暂无报告" hint="完成一次评测后，在运行详情页生成分享报告" />
      ) : (
        <div className="space-y-2">
          {list.data!.map((r) => (
            <div key={r.id} className="border border-border rounded-md p-3.5 bg-card/60 flex items-center gap-3">
              <div>
                <div className="text-sm font-medium">{r.title}</div>
                <div className="text-[11px] text-muted-foreground font-data mt-0.5">
                  运行 {r.runName} · 生成于 {fmtTime(r.createdAt)} · share/{r.shareId.slice(0, 8)}
                </div>
              </div>
              <div className="ml-auto flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copyLink(r.shareId)}>
                  <Copy className="h-3 w-3 mr-1" />复制链接
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                  <a href={shareUrl(r.shareId)} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3 w-3 mr-1" />打开
                  </a>
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporting === r.shareId}
                  onClick={() => exportMd(r.shareId, r.title)}>
                  <FileText className="h-3 w-3 mr-1" />文档
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={exporting === r.shareId}
                  onClick={() => exportJson(r.shareId, r.title)}>
                  <FileJson className="h-3 w-3 mr-1" />JSON
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                  onClick={async () => {
                    if (await confirmDialog({ title: "删除该报告？", description: "删除后分享链接将立即失效，无法恢复。", confirmText: "删除报告", destructive: true })) remove.mutate({ id: r.id });
                  }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Download className="h-3 w-3" />
        报告包含：题库版本与内容哈希、参数快照、模型排名与维度得分、逐题明细（题目/回答/判分）、免责声明。
      </div>
      {confirmElement}
    </div>
  );
}
