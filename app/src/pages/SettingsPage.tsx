import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { download } from "@/components/common";
import { Download, Upload, Minimize2 } from "lucide-react";
import type { CloseBehavior } from "@/types/desktop";

const CLOSE_OPTIONS: { value: CloseBehavior; label: string; desc: string }[] = [
  { value: "ask", label: "每次询问", desc: "每次点击关闭按钮时弹出确认框，由您临时决定如何关闭" },
  { value: "tray", label: "最小化到托盘", desc: "关闭窗口后应用继续在后台运行，可从任务栏右下角托盘图标重新打开" },
  { value: "quit", label: "直接退出", desc: "关闭窗口即结束应用及其全部后台进程，不再占用系统资源" },
];

export default function SettingsPage() {
  const [importText, setImportText] = useState("");
  const [exporting, setExporting] = useState(false);
  const utils = trpc.useUtils();

  const bridge = typeof window === "undefined" ? undefined : window.arenaDesktop;
  const [closeBehavior, setCloseBehavior] = useState<CloseBehavior>("ask");
  const [savingBehavior, setSavingBehavior] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .getCloseBehavior()
      .then((v) => {
        if (alive) setCloseBehavior(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bridge]);

  const changeBehavior = async (value: string) => {
    if (!bridge) return;
    setCloseBehavior(value as CloseBehavior);
    setSavingBehavior(true);
    try {
      const saved = await bridge.setCloseBehavior(value as CloseBehavior);
      setCloseBehavior(saved);
      toast.success("关闭按钮行为已保存");
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSavingBehavior(false);
    }
  };

  const importCfg = trpc.system.importConfig.useMutation({
    onSuccess: (s) => {
      toast.success(`导入完成：分组 +${s.groups}，模型 +${s.models}，套件 +${s.suites}，自建题 +${s.questions}，跳过重复 ${s.skipped}`);
      setImportText("");
      utils.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const doExport = async () => {
    setExporting(true);
    try {
      const data = await utils.system.exportConfig.fetch();
      download(`llm-eval-配置备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
      toast.success("配置已导出（含模型密钥，请妥善保管）");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader title="设置与备份" desc="数据本地持久化（SQLite 零配置）；配置可整体导出备份 / 导入恢复（按名称去重合并，不覆盖现有数据）" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Download className="h-4 w-4" />导出配置备份</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              导出内容：全部分组、模型（含 API 密钥）、测试套件、自建题目。评测运行与结果存于数据库，不在配置备份范围内。
            </p>
            <Button size="sm" onClick={doExport} disabled={exporting}>
              {exporting ? "导出中…" : "导出 JSON 备份"}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Upload className="h-4 w-4" />导入配置</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              rows={8}
              className="font-data text-xs"
              placeholder="粘贴此前导出的备份 JSON…"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="mt-3 flex items-center gap-3">
              <Button size="sm" disabled={!importText.trim() || importCfg.isPending}
                onClick={() => importCfg.mutate({ payload: importText })}>
                {importCfg.isPending ? "导入中…" : "开始导入"}
              </Button>
              <span className="text-[11px] text-muted-foreground">按名称去重：同名数据自动跳过，不会覆盖</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Minimize2 className="h-4 w-4" />窗口与关闭行为</CardTitle></CardHeader>
        <CardContent>
          {bridge ? (
            <>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                设置点击窗口右上角关闭按钮时的行为。选择「最小化到托盘」时应用继续在后台运行，可在任务栏右下角的托盘图标上右键选择「打开主界面」或「退出应用」。
              </p>
              <RadioGroup value={closeBehavior} onValueChange={changeBehavior} disabled={savingBehavior} className="gap-2">
                {CLOSE_OPTIONS.map((o) => (
                  <div key={o.value} className="flex items-start gap-3 rounded-md border px-3 py-2">
                    <RadioGroupItem value={o.value} id={`close-${o.value}`} className="mt-0.5" />
                    <Label htmlFor={`close-${o.value}`} className="flex-col items-start gap-0.5 font-normal cursor-pointer">
                      <span className="text-xs font-medium">{o.label}</span>
                      <span className="text-[11px] text-muted-foreground leading-relaxed">{o.desc}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <p className="mt-3 text-[11px] text-muted-foreground">
                当前生效：{CLOSE_OPTIONS.find((o) => o.value === closeBehavior)?.label ?? closeBehavior}
                {savingBehavior ? "（保存中…）" : ""}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed">
              当前以浏览器方式访问，窗口关闭行为由浏览器控制。安装桌面版后，可在此设置关闭按钮行为（每次询问 / 最小化到托盘 / 直接退出）。
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="py-3"><CardTitle className="text-sm">自检与工程说明</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground leading-relaxed space-y-2">
          <p>· 单元测试：项目根目录执行 <code className="font-data text-foreground">npm run test</code>（覆盖判分器、确定性随机、题库哈希、模拟模型）。</p>
          <p>· 端到端自检：执行 <code className="font-data text-foreground">npx tsx scripts/selfcheck.ts</code>，自动创建模拟模型与迷你套件并跑通完整评测流程。</p>
          <p>· 判分公平性：每次运行固化参数快照与题库哈希，题目顺序由种子确定性生成，所有模型完全一致；支持多次重复取均值。</p>
          <p>· 服务重启恢复：中断的运行自动转为「已暂停」，执行中的题目重置待执行，可从评测任务页一键继续，杜绝漏判。</p>
        </CardContent>
      </Card>
    </div>
  );
}