import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { StatusBadge, EmptyState, fmtMs, fmtTime } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Upload, Zap, Trash2, Pencil, FlaskConical } from "lucide-react";
import { useConfirm } from "@/components/confirm";

type ModelForm = {
  name: string; provider: "openai" | "mock"; baseUrl: string; apiKey: string;
  modelId: string; groupId: number | null; inputPrice: number; outputPrice: number; notes: string;
};
const emptyForm: ModelForm = {
  name: "", provider: "openai", baseUrl: "", apiKey: "", modelId: "",
  groupId: null, inputPrice: 0, outputPrice: 0, notes: "",
};

export default function ModelsPage() {
  const utils = trpc.useUtils();
  const [confirmDialog, confirmElement] = useConfirm();
  const list = trpc.models.list.useQuery();
  const [dialog, setDialog] = useState<"create" | "edit" | "import" | "group" | null>(null);
  const [form, setForm] = useState<ModelForm>(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [importText, setImportText] = useState("");
  const [groupForm, setGroupForm] = useState({ name: "", color: "#2563eb" });
  const [testingId, setTestingId] = useState<number | null>(null);
  const [filterGroup, setFilterGroup] = useState<string>("all");

  const invalidate = () => utils.models.list.invalidate();

  const create = trpc.models.create.useMutation({
    onSuccess: () => { toast.success("模型已添加"); setDialog(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.models.update.useMutation({
    onSuccess: () => { toast.success("已保存"); setDialog(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.models.remove.useMutation({
    onSuccess: () => { toast.success("已删除"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const importBatch = trpc.models.importBatch.useMutation({
    onSuccess: (r) => {
      toast.success(`导入完成：新增 ${r.created}，跳过重复 ${r.skipped}${r.errors.length ? `，失败 ${r.errors.length}` : ""}`);
      setDialog(null); setImportText(""); invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const addMock = trpc.models.addMockModels.useMutation({
    onSuccess: (r) => { toast.success(r.created > 0 ? `已添加 ${r.created} 个模拟模型` : "模拟模型已存在"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const test = trpc.models.test.useMutation({
    onSuccess: (r) => {
      setTestingId(null);
      if (r.ok) toast.success(`连接正常 · ${r.latencyMs}ms · 样例响应：${r.sample.slice(0, 40)}`);
      else toast.error(`连接失败：${r.error}`);
      invalidate();
    },
    onError: (e) => { setTestingId(null); toast.error(e.message); invalidate(); },
  });
  const createGroup = trpc.models.createGroup.useMutation({
    onSuccess: () => { toast.success("分组已创建"); setDialog(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const removeGroup = trpc.models.removeGroup.useMutation({
    onSuccess: () => { toast.success("分组已删除（组内模型移至未分组）"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const toggle = trpc.models.update.useMutation({ onSuccess: invalidate });

  const groups = list.data?.groups ?? [];
  const models = useMemo(() => {
    const ms = list.data?.models ?? [];
    if (filterGroup === "all") return ms;
    if (filterGroup === "none") return ms.filter((m) => !m.groupId);
    return ms.filter((m) => String(m.groupId) === filterGroup);
  }, [list.data, filterGroup]);

  const openEdit = (m: NonNullable<typeof list.data>["models"][number]) => {
    setEditId(m.id);
    setForm({
      name: m.name, provider: m.provider as "openai" | "mock", baseUrl: m.baseUrl,
      apiKey: m.apiKey, modelId: m.modelId, groupId: m.groupId,
      inputPrice: m.inputPrice, outputPrice: m.outputPrice, notes: m.notes ?? "",
    });
    setDialog("edit");
  };

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText);
      const items = Array.isArray(parsed) ? parsed : parsed.models;
      if (!Array.isArray(items) || items.length === 0) {
        toast.error("JSON 中未找到模型数组");
        return;
      }
      importBatch.mutate({ items });
    } catch {
      toast.error("JSON 格式错误，请检查");
    }
  };

  const submit = () => {
    if (!form.name.trim()) { toast.error("请填写模型名称"); return; }
    if (!form.modelId.trim()) { toast.error("请填写模型标识"); return; }
    if (form.provider === "openai" && !form.baseUrl.trim()) { toast.error("请填写 API 地址"); return; }
    if (dialog === "create") create.mutate({ ...form, enabled: true });
    else if (editId !== null) update.mutate({ id: editId, data: form });
  };

  return (
    <div>
      <PageHeader
        title="模型管理"
        desc="批量导入 / 增删改查 / 连接测试 / 分组管理"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => addMock.mutate()}>
              <FlaskConical className="h-3.5 w-3.5 mr-1" />模拟模型
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("import")}>
              <Upload className="h-3.5 w-3.5 mr-1" />批量导入
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("group")}>
              <Plus className="h-3.5 w-3.5 mr-1" />新建分组
            </Button>
            <Button size="sm" onClick={() => { setForm(emptyForm); setDialog("create"); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />添加模型
            </Button>
          </>
        }
      />

      {/* 分组筛选 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilterGroup("all")}
          className={`text-xs px-3 py-1 rounded-full border ${filterGroup === "all" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
          全部（{list.data?.models.length ?? 0}）
        </button>
        <button onClick={() => setFilterGroup("none")}
          className={`text-xs px-3 py-1 rounded-full border ${filterGroup === "none" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
          未分组
        </button>
        {groups.map((g) => (
          <span key={g.id} className="inline-flex items-center gap-1">
            <button onClick={() => setFilterGroup(String(g.id))}
              className={`text-xs px-3 py-1 rounded-full border ${filterGroup === String(g.id) ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: g.color }} />
              {g.name}
            </button>
            <button className="text-muted-foreground hover:text-destructive" title="删除分组"
              onClick={async () => {
                if (await confirmDialog({ title: `删除分组「${g.name}」？`, description: "组内模型将移至未分组，模型本身不会被删除。", confirmText: "删除分组", destructive: true })) removeGroup.mutate({ id: g.id });
              }}>
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {models.length === 0 ? (
        <EmptyState text="暂无模型" hint="点击「添加模型」接入 OpenAI 兼容接口，或点击「模拟模型」零成本体验完整评测流程" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {models.map((m) => (
            <div key={m.id} className="border border-border rounded-md p-4 bg-card/60">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{m.name}</span>
                {m.provider === "mock" && <Badge variant="outline" className="text-[10px] text-info border-info/40">模拟</Badge>}
                {m.group && (
                  <Badge variant="outline" className="text-[10px]" style={{ color: m.group.color, borderColor: `${m.group.color}55` }}>
                    {m.group.name}
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{m.enabled ? "已启用" : "已停用"}</span>
                  <Switch checked={m.enabled} onCheckedChange={(v) => toggle.mutate({ id: m.id, data: { enabled: v } })} />
                </div>
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground font-data space-y-0.5">
                <div className="truncate">model: {m.modelId}</div>
                <div className="truncate">endpoint: {m.baseUrl || "—"}</div>
                <div>key: {m.apiKeyMasked || "（无）"} · 价格: ${m.inputPrice}/${m.outputPrice} 每百万 tokens</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                {m.lastTestStatus && <StatusBadge status={m.lastTestStatus} />}
                {m.lastTestLatencyMs != null && <span className="text-[10px] text-muted-foreground font-data">{fmtMs(m.lastTestLatencyMs)}</span>}
                {m.lastTestedAt && <span className="text-[10px] text-muted-foreground">{fmtTime(m.lastTestedAt)}</span>}
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={testingId === m.id}
                    onClick={() => { setTestingId(m.id); test.mutate({ id: m.id }); }}>
                    <Zap className="h-3 w-3 mr-1" />{testingId === m.id ? "测试中…" : "连接测试"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(m)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                    onClick={async () => {
                      if (await confirmDialog({ title: `删除模型「${m.name}」？`, description: "历史评测记录会保留，但无法再对该模型复跑。", confirmText: "删除模型", destructive: true })) remove.mutate({ id: m.id });
                    }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              {m.lastTestStatus === "fail" && m.lastTestError && (
                <div className="mt-2 text-[11px] text-destructive bg-destructive/10 rounded px-2 py-1 font-data break-all">
                  {m.lastTestError}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 创建/编辑对话框 */}
      <Dialog open={dialog === "create" || dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{dialog === "create" ? "添加模型" : "编辑模型"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2">
              <Label>自定义名称 *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：GPT-4o 生产环境" />
            </div>
            <div>
              <Label>接口类型</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v as "openai" | "mock" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI 兼容接口</SelectItem>
                  <SelectItem value="mock">内置模拟模型</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>分组</Label>
              <Select value={form.groupId ? String(form.groupId) : "none"} onValueChange={(v) => setForm({ ...form, groupId: v === "none" ? null : Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未分组</SelectItem>
                  {groups.map((g) => <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.provider === "openai" && (
              <>
                <div className="col-span-2">
                  <Label>API 地址（Base URL）*</Label>
                  <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" className="font-data text-xs" />
                  <p className="text-[10px] text-muted-foreground mt-1">将请求 {`{Base URL}/chat/completions`}</p>
                </div>
                <div className="col-span-2">
                  <Label>API 密钥</Label>
                  <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." className="font-data text-xs" />
                </div>
              </>
            )}
            <div>
              <Label>模型标识 *</Label>
              <Input value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} placeholder="gpt-4o / deepseek-v3 ..." className="font-data text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>输入价 $/M</Label>
                <Input type="number" step="0.01" min="0" value={form.inputPrice} onChange={(e) => setForm({ ...form, inputPrice: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <Label>输出价 $/M</Label>
                <Input type="number" step="0.01" min="0" value={form.outputPrice} onChange={(e) => setForm({ ...form, outputPrice: Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="col-span-2">
              <Label>备注</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>取消</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending}>
              {(create.isPending || update.isPending) ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量导入 */}
      <Dialog open={dialog === "import"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>批量导入模型</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            粘贴 JSON 数组，每项包含 name / baseUrl / apiKey / modelId / groupName（可选）。按名称去重。
          </p>
          <Textarea
            rows={10}
            className="font-data text-xs"
            placeholder={`[\n  {\n    "name": "GPT-4o",\n    "baseUrl": "https://api.openai.com/v1",\n    "apiKey": "sk-...",\n    "modelId": "gpt-4o",\n    "groupName": "OpenAI"\n  }\n]`}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>取消</Button>
            <Button onClick={doImport} disabled={importBatch.isPending}>
              {importBatch.isPending ? "导入中…" : "开始导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建分组 */}
      <Dialog open={dialog === "group"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>新建分组</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>分组名称</Label>
              <Input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} />
            </div>
            <div>
              <Label>标识色</Label>
              <Input type="color" value={groupForm.color} onChange={(e) => setGroupForm({ ...groupForm, color: e.target.value })} className="h-9 w-20 p-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>取消</Button>
            <Button onClick={() => {
              if (!groupForm.name.trim()) { toast.error("请填写分组名称"); return; }
              createGroup.mutate(groupForm);
            }}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmElement}
    </div>
  );
}
