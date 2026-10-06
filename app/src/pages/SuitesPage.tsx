import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { EmptyState, CategoryBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Copy } from "lucide-react";
import { CATEGORIES, DIFFICULTY_LEVELS, DEFAULT_SUITE_CONFIG, type SuiteConfig } from "../../contracts/eval";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm";

function cloneConfig(c: SuiteConfig): SuiteConfig {
  return JSON.parse(JSON.stringify(c));
}

const ALL_LEVELS = [1, 2, 3, 4, 5];

/** 归一化难度分层：缺省或空数组 = 全部 1~5 级 */
function normalizedLevels(c: SuiteConfig): number[] {
  const lv = c.levels && c.levels.length ? [...c.levels] : ALL_LEVELS;
  return [...new Set(lv)].sort((a, b) => a - b);
}

/** 卡片配置摘要：把各套件真正不同的地方一眼摊开 */
function specOf(c: SuiteConfig) {
  const enabled = CATEGORIES.filter((cat) => c.categories?.[cat.key]?.enabled);
  const levels = normalizedLevels(c);
  const unlimited = enabled.some((cat) => (c.categories[cat.key]?.count ?? 0) === 0);
  const fixed = enabled.reduce((a, cat) => a + (c.categories[cat.key]?.count ?? 0), 0);
  const weighted = enabled.filter((cat) => (c.categories[cat.key]?.weight ?? 1) !== 1);
  return {
    enabled,
    levels,
    levelText: levels.length === 5 ? "全难度 1~5" : `${levels.join("/")} 级`,
    countText: enabled.length === 0 ? "—" : unlimited ? `全部（${fixed > 0 ? `${fixed}+` : ""}）` : `${fixed} 题`,
    weighted,
  };
}

function SpecCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/70 rounded-md px-2.5 py-1.5 bg-background/40">
      <div className="text-[10px] text-muted-foreground tracking-wider">{label}</div>
      <div className="text-xs font-data mt-0.5">{value}</div>
    </div>
  );
}

export default function SuitesPage() {
  const utils = trpc.useUtils();
  const [confirmDialog, confirmElement] = useConfirm();
  const list = trpc.suites.list.useQuery();
  const modelsList = trpc.models.list.useQuery();
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [cfg, setCfg] = useState<SuiteConfig>(cloneConfig(DEFAULT_SUITE_CONFIG));

  const invalidate = () => utils.suites.list.invalidate();
  const create = trpc.suites.create.useMutation({
    onSuccess: () => { toast.success("套件已创建"); setDialog(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.suites.update.useMutation({
    onSuccess: () => { toast.success("已保存"); setDialog(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.suites.remove.useMutation({
    onSuccess: () => { toast.success("已删除"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditId(null); setName(""); setDesc("");
    setCfg(cloneConfig(DEFAULT_SUITE_CONFIG));
    setDialog("create");
  };
  const openEdit = (s: NonNullable<typeof list.data>[number]) => {
    setEditId(s.id); setName(s.name); setDesc(s.description ?? "");
    setCfg(cloneConfig(s.config as SuiteConfig));
    setDialog("edit");
  };
  const submit = () => {
    if (!name.trim()) { toast.error("请填写套件名称"); return; }
    if (cfg.judgeEnabled && !cfg.judgeModelId) { toast.error("已启用模型评审，请选择评审模型"); return; }
    const enabledCats = Object.values(cfg.categories).filter((c) => c.enabled);
    if (enabledCats.length === 0) { toast.error("至少启用一个维度"); return; }
    if (!cfg.levels || cfg.levels.length === 0) { toast.error("至少选择一个难度级别"); return; }
    if (dialog === "create") create.mutate({ name, description: desc, config: cfg });
    else if (editId !== null) update.mutate({ id: editId, data: { name, description: desc, config: cfg } });
  };

  const setCat = (key: string, patch: Partial<SuiteConfig["categories"][string]>) => {
    setCfg({ ...cfg, categories: { ...cfg.categories, [key]: { ...cfg.categories[key], ...patch } } });
  };
  const setParam = <K extends keyof SuiteConfig["params"]>(k: K, v: SuiteConfig["params"][K]) => {
    setCfg({ ...cfg, params: { ...cfg.params, [k]: v } });
  };
  const toggleLevel = (lv: number) => {
    const cur = normalizedLevels(cfg);
    const next = cur.includes(lv) ? cur.filter((x) => x !== lv) : [...cur, lv].sort((a, b) => a - b);
    setCfg({ ...cfg, levels: next });
  };

  const modelOptions = modelsList.data?.models.filter((m) => m.enabled) ?? [];

  return (
    <div>
      <PageHeader
        title="测试套件"
        desc="配置维度题量与权重、难度分层（L1~L5）、统一评测参数（温度/Token/超时/重试/种子/重复轮次）与判分通道"
        actions={<Button size="sm" onClick={openCreate}><Plus className="h-3.5 w-3.5 mr-1" />新建套件</Button>}
      />

      {(list.data?.length ?? 0) === 0 ? (
        <EmptyState text="暂无套件" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.data!.map((s) => {
            const c = s.config as SuiteConfig;
            const spec = specOf(c);
            return (
              <div key={s.id} className="border border-border rounded-md p-4 bg-card/60">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{s.name}</span>
                  {c.judgeEnabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-primary/40 text-primary">规则+评审</span>
                  )}
                  <span className="ml-auto" />
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                    setEditId(null); setName(`${s.name} 副本`); setDesc(s.description ?? "");
                    setCfg(cloneConfig(c)); setDialog("create");
                  }}><Copy className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(s)}><Pencil className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                    onClick={async () => {
                      if (await confirmDialog({ title: `删除套件「${s.name}」？`, description: "该套件配置将被永久删除，历史运行结果不受影响。", confirmText: "删除套件", destructive: true })) remove.mutate({ id: s.id });
                    }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {s.description && <p className="text-[11px] text-muted-foreground mt-1">{s.description}</p>}

                {/* 配置摘要：维度 / 难度 / 题量 / 判分通道，一眼看清各套件差异 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5">
                  <SpecCell label="维度" value={`${spec.enabled.length} / ${CATEGORIES.length}`} />
                  <SpecCell label="难度" value={spec.levelText} />
                  <SpecCell label="题量" value={spec.countText} />
                  <SpecCell label="判分" value={c.judgeEnabled ? "规则+评审" : "纯规则"} />
                </div>

                <div className="flex flex-wrap gap-1 mt-2.5">
                  {spec.enabled.map((cat) => (
                    <span key={cat.key} className="inline-flex items-center gap-1">
                      <CategoryBadge category={cat.key} />
                      <span className="text-[10px] text-muted-foreground font-data">
                        ×{c.categories[cat.key].weight}{c.categories[cat.key].count > 0 ? `·${c.categories[cat.key].count}题` : ""}
                      </span>
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground font-data">
                  temp={c.params.temperature} · maxTokens={c.params.maxTokens} · 超时={c.params.timeoutMs / 1000}s · 重试={c.params.retries} · 重复={c.params.repeatCount}轮 · 种子={c.params.seed} · 并发={c.params.concurrency}
                  {spec.weighted.length > 0 && ` · 加权维度=${spec.weighted.map((w) => `${w.name}×${c.categories[w.key].weight}`).join("、")}`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{dialog === "create" ? "新建测试套件" : "编辑测试套件"}</DialogTitle></DialogHeader>
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>套件名称 *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>描述</Label>
                <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
            </div>

            {/* 维度配置 */}
            <div>
              <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">维度配置（题量 0 = 该维度全部题目）</div>
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-normal w-14">启用</th>
                      <th className="px-3 py-2 font-normal">维度</th>
                      <th className="px-3 py-2 font-normal w-28">题量上限</th>
                      <th className="px-3 py-2 font-normal w-28">权重</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map((cat) => {
                      const cc = cfg.categories[cat.key] ?? { enabled: true, count: 0, weight: 1 };
                      return (
                        <tr key={cat.key} className="border-t border-border/60">
                          <td className="px-3 py-1.5"><Switch checked={cc.enabled} onCheckedChange={(v) => setCat(cat.key, { enabled: v })} /></td>
                          <td className="px-3 py-1.5"><CategoryBadge category={cat.key} /></td>
                          <td className="px-3 py-1.5">
                            <Input type="number" min={0} className="h-7 w-24 font-data" value={cc.count} disabled={!cc.enabled}
                              onChange={(e) => setCat(cat.key, { count: Math.max(0, Number(e.target.value) || 0) })} />
                          </td>
                          <td className="px-3 py-1.5">
                            <Input type="number" min={0} step={0.5} className="h-7 w-24 font-data" value={cc.weight} disabled={!cc.enabled}
                              onChange={(e) => setCat(cat.key, { weight: Math.max(0, Number(e.target.value) || 0) })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 难度分层 */}
            <div>
              <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">难度分层（参与抽题的难度级别，可多选）</div>
              <div className="flex flex-wrap items-center gap-2">
                {DIFFICULTY_LEVELS.map((d) => {
                  const active = normalizedLevels(cfg).includes(d.level);
                  return (
                    <button
                      key={d.level}
                      type="button"
                      title={d.desc}
                      onClick={() => toggleLevel(d.level)}
                      className={cn(
                        "px-3 py-1.5 rounded-md border text-xs transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-foreground/30",
                      )}
                    >
                      L{d.level} {d.name}
                    </button>
                  );
                })}
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs"
                  onClick={() => setCfg({ ...cfg, levels: [...ALL_LEVELS] })}>全选</Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                当前：{normalizedLevels(cfg).length === 5 ? "全部 1~5 级" : normalizedLevels(cfg).join(" / ") + " 级"}
                {normalizedLevels(cfg).length === 0 && "（至少选择一级）"}
              </p>
            </div>

            {/* 统一参数 */}
            <div>
              <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">统一参数（所有模型一致，运行时快照固化）</div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">温度</Label>
                  <Input type="number" min={0} max={2} step={0.1} className="font-data" value={cfg.params.temperature}
                    onChange={(e) => setParam("temperature", Number(e.target.value) || 0)} />
                </div>
                <div>
                  <Label className="text-xs">最大 Tokens</Label>
                  <Input type="number" min={16} className="font-data" value={cfg.params.maxTokens}
                    onChange={(e) => setParam("maxTokens", Number(e.target.value) || 2048)} />
                </div>
                <div>
                  <Label className="text-xs">超时（毫秒）</Label>
                  <Input type="number" min={1000} step={1000} className="font-data" value={cfg.params.timeoutMs}
                    onChange={(e) => setParam("timeoutMs", Number(e.target.value) || 60000)} />
                </div>
                <div>
                  <Label className="text-xs">重试次数</Label>
                  <Input type="number" min={0} max={5} className="font-data" value={cfg.params.retries}
                    onChange={(e) => setParam("retries", Number(e.target.value) || 0)} />
                </div>
                <div>
                  <Label className="text-xs">重复轮次（取均值）</Label>
                  <Input type="number" min={1} max={10} className="font-data" value={cfg.params.repeatCount}
                    onChange={(e) => setParam("repeatCount", Math.max(1, Number(e.target.value) || 1))} />
                </div>
                <div>
                  <Label className="text-xs">随机种子（固定）</Label>
                  <Input type="number" min={0} className="font-data" value={cfg.params.seed}
                    onChange={(e) => setParam("seed", Number(e.target.value) || 0)} />
                </div>
                <div>
                  <Label className="text-xs">并发数</Label>
                  <Input type="number" min={1} max={16} className="font-data" value={cfg.params.concurrency}
                    onChange={(e) => setParam("concurrency", Math.max(1, Math.min(16, Number(e.target.value) || 1)))} />
                </div>
                <div>
                  <Label className="text-xs">复核分歧阈值</Label>
                  <Input type="number" min={0} max={1} step={0.1} className="font-data" value={cfg.reviewThreshold}
                    onChange={(e) => setCfg({ ...cfg, reviewThreshold: Number(e.target.value) || 0.5 })} />
                </div>
              </div>
              <div className="mt-3">
                <Label className="text-xs">统一系统提示词（留空则不发送）</Label>
                <Textarea rows={2} value={cfg.params.systemPrompt} onChange={(e) => setParam("systemPrompt", e.target.value)} />
              </div>
            </div>

            {/* 判分通道 */}
            <div>
              <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">判分通道（规则判分始终开启，模型评审为第二通道）</div>
              <div className="flex items-center gap-3 border border-border rounded-md p-3">
                <Switch checked={cfg.judgeEnabled} onCheckedChange={(v) => setCfg({ ...cfg, judgeEnabled: v })} />
                <span className="text-xs">启用模型评审（双通道分歧自动进入人工复核）</span>
                {cfg.judgeEnabled && (
                  <Select value={cfg.judgeModelId ? String(cfg.judgeModelId) : "none"}
                    onValueChange={(v) => setCfg({ ...cfg, judgeModelId: v === "none" ? null : Number(v) })}>
                    <SelectTrigger className="w-56 h-8 text-xs"><SelectValue placeholder="选择评审模型" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">选择评审模型…</SelectItem>
                      {modelOptions.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>取消</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending}>
              {(create.isPending || update.isPending) ? "保存中…" : "保存套件"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmElement}
    </div>
  );
}
