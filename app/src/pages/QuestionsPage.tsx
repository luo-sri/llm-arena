import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { CategoryBadge, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CATEGORIES, CATEGORY_MAP, DIFFICULTY_LEVELS, SCORING_TYPES } from "../../contracts/eval";
import { Search, Eye, Download, Globe, Package, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function QuestionsPage() {
  const utils = trpc.useUtils();
  const [category, setCategory] = useState<string>("all");
  const [difficulty, setDifficulty] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  const bankInfo = trpc.questions.bankInfo.useQuery();
  const list = trpc.questions.list.useQuery(
    {
      category: category === "all" ? undefined : category,
      difficulty: difficulty === "all" ? undefined : difficulty,
      search: search || undefined,
    },
  );
  const banks = trpc.questions.openBanks.useQuery(undefined, { enabled: syncOpen });

  const invalidateBank = () => {
    utils.questions.list.invalidate();
    utils.questions.bankInfo.invalidate();
    utils.questions.openBanks.invalidate();
  };

  const detail = useMemo(
    () => list.data?.find((q) => q.id === detailId) ?? null,
    [list.data, detailId],
  );

  const scoringName = (t: string) => SCORING_TYPES.find((s) => s.key === t)?.name ?? t;
  const scoringDesc = (t: string) => SCORING_TYPES.find((s) => s.key === t)?.desc ?? "";
  const sourceLabel = (s: string) =>
    s === "builtin" ? "内置" : s.startsWith("openbank") ? "公开题库" : "自建";
  const sourceBadgeCls = (s: string) =>
    s === "builtin"
      ? "text-muted-foreground"
      : s.startsWith("openbank")
        ? "text-info border-info/40"
        : "text-success border-success/40";

  return (
    <div>
      <PageHeader
        title="题库中心"
        desc="内置公开题库：题目、参考答案、判分规则、评分标准完全公开可验证；支持一键同步公开基准题库"
        actions={
          <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)}>
            <Download className="h-3.5 w-3.5 mr-1" />公开题库同步
          </Button>
        }
      />

      {/* 题库信息条 */}
      <div className="border border-border rounded-md bg-card/60 px-4 py-3 mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
          <span>版本 <span className="font-data text-primary">{bankInfo.data?.version ?? "…"}</span></span>
          <span>内容哈希 <span className="font-data text-primary">{bankInfo.data?.hash ?? "…"}</span></span>
          <span>总题量 <span className="font-data">{bankInfo.data?.total ?? "…"}</span></span>
          <span className="text-muted-foreground">任何题目或规则变动都会改变哈希，每次运行记录哈希快照，杜绝篡改</span>
        </div>
        {/* 难度分布：一眼看清题库难度结构（点击可筛选） */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">难度分布</span>
          {DIFFICULTY_LEVELS.map((d) => {
            const n = bankInfo.data?.byDifficulty?.[String(d.level)] ?? 0;
            const total = bankInfo.data?.total ?? 0;
            const pct = total ? Math.round((n / total) * 100) : 0;
            const hard = d.level >= 4;
            const active = difficulty === d.level;
            return (
              <button
                key={d.level}
                title={d.desc}
                onClick={() => setDifficulty(active ? "all" : d.level)}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border transition-colors ${
                  active ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-foreground/30"
                }`}
              >
                <span className={hard ? "font-medium" : ""}>L{d.level} {d.name}</span>
                <span className="font-data">{n}</span>
                <span className="text-muted-foreground/70 font-data">{pct}%</span>
              </button>
            );
          })}
          {(difficulty !== "all" || category !== "all" || search) && (
            <button
              onClick={() => { setDifficulty("all"); setCategory("all"); setSearch(""); }}
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* 维度筛选 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => setCategory("all")}
          className={`text-xs px-3 py-1 rounded-full border ${category === "all" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
          全部
        </button>
        {CATEGORIES.map((c) => (
          <button key={c.key} onClick={() => setCategory(c.key)}
            className={`text-xs px-3 py-1 rounded-full border ${category === c.key ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
            {c.name}（{bankInfo.data?.byCategory[c.key] ?? 0}）
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input className="h-8 w-56 pl-8 text-xs" placeholder="搜索题干…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* 当前筛选结果条数 */}
      <div className="text-[11px] text-muted-foreground mb-2">
        当前筛选：{category === "all" ? "全部维度" : CATEGORY_MAP[category]?.name ?? category}
        {difficulty !== "all" && ` · L${difficulty} ${DIFFICULTY_LEVELS.find((d) => d.level === difficulty)?.name}`}
        {search && ` · 搜索「${search}」`}
        ，共 <span className="font-data text-foreground">{list.data?.length ?? 0}</span> 题
      </div>

      {(list.data?.length ?? 0) === 0 ? (
        <EmptyState text="没有匹配的题目" />
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-normal w-12">ID</th>
                <th className="px-3 py-2 font-normal w-24">维度</th>
                <th className="px-3 py-2 font-normal">题干</th>
                <th className="px-3 py-2 font-normal w-14">难度</th>
                <th className="px-3 py-2 font-normal w-20">判分方式</th>
                <th className="px-3 py-2 font-normal w-14">权重</th>
                <th className="px-3 py-2 font-normal w-16">来源</th>
                <th className="px-3 py-2 font-normal w-14"></th>
              </tr>
            </thead>
            <tbody>
              {list.data!.map((q) => (
                <tr key={q.id} className="border-t border-border/60 hover:bg-accent/30">
                  <td className="px-3 py-2 font-data text-muted-foreground">#{q.id}</td>
                  <td className="px-3 py-2"><CategoryBadge category={q.category} /></td>
                  <td className="px-3 py-2 max-w-0"><div className="truncate" title={q.prompt}>{q.prompt}</div></td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap" title={DIFFICULTY_LEVELS.find((d) => d.level === q.difficulty)?.desc}>
                    <span className={q.difficulty >= 4 ? "text-primary" : ""}>{"★".repeat(q.difficulty)}</span>
                    <span className="ml-1 text-[10px]">{DIFFICULTY_LEVELS.find((d) => d.level === q.difficulty)?.name}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{scoringName(q.scoringType)}</td>
                  <td className="px-3 py-2 font-data">{q.weight}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={`text-[10px] font-normal ${sourceBadgeCls(q.source)}`}>
                      {sourceLabel(q.source)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setDetailId(q.id)}>
                      <Eye className="h-3 w-3 mr-1" />公开
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 公开题库同步面板 */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Download className="h-4 w-4" />公开题库一键同步
            </DialogTitle>
          </DialogHeader>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            离线精选包开箱即用（原创改编、风格对齐公开基准，判分规则公开）；在线源实时拉取公开题库并自动去重导入。同步的题目同样公开题干、答案与判分规则，导入后自动参与评测抽题。
          </p>

          <section>
            <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
              <Package className="h-3.5 w-3.5 text-primary" />离线精选包（无需网络）
            </div>
            {banks.isLoading && <div className="text-xs text-muted-foreground py-2">加载中…</div>}
            <div className="space-y-2">
              {banks.data?.packs.map((p) => (
                <OfflinePackRow key={p.key} pack={p} onDone={invalidateBank} />
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-1.5 text-xs font-medium mb-2 mt-1">
              <Globe className="h-3.5 w-3.5 text-primary" />在线同步源（需联网）
            </div>
            <div className="space-y-2">
              {banks.data?.sources.map((s) => (
                <OnlineSourceRow key={s.key} source={s} onDone={invalidateBank} />
              ))}
            </div>
          </section>
        </DialogContent>
      </Dialog>

      {/* 题目公开详情 */}
      <Dialog open={detailId !== null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  题目 #{detail.id} <CategoryBadge category={detail.category} />
                  <span className="text-xs text-muted-foreground font-normal">难度 {"★".repeat(detail.difficulty)} · 权重 {detail.weight}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-xs">
                <section>
                  <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">题干</div>
                  <div className="bg-muted/40 rounded p-3 whitespace-pre-wrap">{detail.prompt}</div>
                </section>
                <section>
                  <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">参考答案</div>
                  <div className="bg-muted/40 rounded p-3 font-data">{detail.expectedAnswer ?? "（无固定答案，按评分标准判分）"}</div>
                </section>
                <section>
                  <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">判分方式</div>
                  <div className="bg-muted/40 rounded p-3">
                    <span className="text-primary">{scoringName(detail.scoringType)}</span>
                    <span className="text-muted-foreground ml-2">{scoringDesc(detail.scoringType)}</span>
                  </div>
                </section>
                {detail.scoringConfig != null && (
                  <section>
                    <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">判分规则（公开）</div>
                    <pre className="bg-muted/40 rounded p-3 font-data text-[11px] overflow-x-auto">
                      {JSON.stringify(detail.scoringConfig, null, 2)}
                    </pre>
                  </section>
                )}
                {detail.rubric && (
                  <section>
                    <div className="text-muted-foreground mb-1 uppercase tracking-wider text-[10px]">评分标准（公开）</div>
                    <div className="bg-muted/40 rounded p-3 whitespace-pre-wrap">{detail.rubric}</div>
                  </section>
                )}
                <div className="text-muted-foreground">
                  题库版本 {detail.bankVersion} · {CATEGORY_MAP[detail.category]?.name} · 本题对每次运行的判分明细可在运行详情中追溯
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OfflinePackRow({
  pack,
  onDone,
}: {
  pack: {
    key: string; name: string; description: string; license: string;
    count: number; imported: number; inDb: number;
    byCategory: { category: string; count: number }[];
  };
  onDone: () => void;
}) {
  const sync = trpc.questions.syncOffline.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.inserted > 0
          ? `「${r.name}」已导入：新增 ${r.inserted} 题${r.skipped > 0 ? `，跳过 ${r.skipped} 题（已存在）` : ""}`
          : `「${r.name}」全部 ${r.total} 题已存在，无新增`,
      );
      onDone();
    },
    onError: (e) => toast.error(`导入失败：${e.message}`),
  });
  const fullyImported = pack.imported >= pack.count;
  return (
    <div className="border border-border rounded-md p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium">{pack.name}</span>
        <Badge variant="outline" className="text-[10px] font-normal">{pack.count} 题</Badge>
        {pack.byCategory.map((c) => (
          <Badge key={c.category} variant="outline" className="text-[10px] font-normal text-muted-foreground">
            {CATEGORY_MAP[c.category]?.name ?? c.category}×{c.count}
          </Badge>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{pack.description}</p>
      <p className="text-[10px] text-muted-foreground/70 mt-1">许可：{pack.license}</p>
      <div className="flex items-center gap-2 mt-2">
        <Button size="sm" className="h-7 text-xs" disabled={sync.isPending} onClick={() => sync.mutate({ key: pack.key })}>
          <Download className="h-3 w-3 mr-1" />{sync.isPending ? "导入中…" : fullyImported ? "重新检查" : "一键导入"}
        </Button>
        {pack.inDb > 0 && (
          <span className="text-[11px] text-success font-data">已收录 {pack.inDb} 题</span>
        )}
      </div>
    </div>
  );
}

function OnlineSourceRow({
  source,
  onDone,
}: {
  source: {
    key: string; name: string; description: string; host: string; maxCount: number; totalCap: number; hasFallback: boolean; inDb: number;
  };
  onDone: () => void;
}) {
  const [count, setCount] = useState(20);
  const check = trpc.questions.checkSource.useMutation();
  const sync = trpc.questions.syncOnline.useMutation({
    onSuccess: (r) => {
      toast.success(
        `「${r.name}」同步完成：拉取 ${r.fetched} 题，新增 ${r.inserted}${r.skipped > 0 ? `，跳过 ${r.skipped}（已存在）` : ""}；累计 ${r.total}/${r.cap} 题`,
      );
      onDone();
    },
    onError: (e) => toast.error(`同步失败：${e.message}`),
  });

  useEffect(() => {
    check.mutate({ key: source.key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.key]);

  const rateLimited = check.data?.reachable === true && check.data?.rateLimited === true;
  const atCap = source.inDb >= source.totalCap;

  const statusDot =
    check.data?.reachable === true ? (
      <span
        className={`text-[11px] ${rateLimited ? "text-warning" : "text-success"}`}
        title={check.data.endpoint ? `可用节点：${check.data.endpoint}` : undefined}
      >
        ● {rateLimited ? "已连通（服务端限流）" : `已连通${check.data.endpoint ? `（${check.data.endpoint}）` : ""}`}
      </span>
    ) : check.data?.reachable === false ? (
      <span className="text-[11px] text-destructive" title={check.data.error ?? undefined}>
        ● 不可达
      </span>
    ) : (
      <span className="text-[11px] text-muted-foreground">● 检测中…</span>
    );

  return (
    <div className="border border-border rounded-md p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium">{source.name}</span>
        <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground font-data">{source.host}</Badge>
        {statusDot}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{source.description}</p>
      {rateLimited && (
        <p className="text-[11px] text-warning mt-1.5 leading-relaxed">
          服务端暂时限流（HTTP 429），连接本身正常。可直接点击「一键同步」，系统会自动等待并重试。
        </p>
      )}
      {check.data?.reachable === false && (
        <p className="text-[11px] text-destructive/80 mt-1.5 leading-relaxed">
          探测失败：{check.data.error}。
          {source.hasFallback
            ? "仍可点击「一键同步」自动尝试备用镜像源。"
            : "请稍后重试，或改用下方离线精选包。"}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
          <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[10, 20, 30, 50].map((n) => (
              <SelectItem key={n} value={String(n)} className="text-xs">{n} 题</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={sync.isPending || atCap}
          onClick={() => sync.mutate({ key: source.key, count })}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${sync.isPending ? "animate-spin" : ""}`} />
          {sync.isPending ? "同步中…" : atCap ? "已达上限" : "一键同步"}
        </Button>
        <span className={`text-[11px] font-data ${atCap ? "text-warning" : "text-success"}`}>
          已收录 {source.inDb} / {source.totalCap} 题
        </span>
      </div>
      {atCap && (
        <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
          已达该源收录上限，继续同步不会新增题目（重复内容自动去重）。如需更多题目，可改用下方离线精选包。
        </p>
      )}
    </div>
  );
}
