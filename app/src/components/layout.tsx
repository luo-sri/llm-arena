import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Boxes,
  Library,
  SlidersHorizontal,
  PlayCircle,
  Trophy,
  ClipboardCheck,
  FileText,
  Settings,
  Swords,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { BANK_VERSION } from "@contracts/eval";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { APP_VERSION, GITHUB_ICON_PATH, REPO_NAME, REPO_URL } from "@/lib/site";
import type { UpdateCheckResult, UpdateProgress } from "@/types/desktop";

export type PageKey =
  | "dashboard"
  | "models"
  | "questions"
  | "suites"
  | "runs"
  | "runDetail"
  | "leaderboard"
  | "review"
  | "reports"
  | "settings";

const NAV: { key: PageKey; name: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", name: "竞技场仪表盘", icon: LayoutDashboard },
  { key: "models", name: "模型管理", icon: Boxes },
  { key: "questions", name: "题库中心", icon: Library },
  { key: "suites", name: "测试套件", icon: SlidersHorizontal },
  { key: "runs", name: "评测任务", icon: PlayCircle },
  { key: "leaderboard", name: "竞技场排行榜", icon: Trophy },
  { key: "review", name: "人工复核", icon: ClipboardCheck },
  { key: "reports", name: "报告中心", icon: FileText },
  { key: "settings", name: "设置与备份", icon: Settings },
];

/** GitHub 官方图标 */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="currentColor" d={GITHUB_ICON_PATH} />
    </svg>
  );
}

export function AppLayout({
  page,
  onNavigate,
  children,
}: {
  page: PageKey;
  onNavigate: (p: PageKey) => void;
  children: ReactNode;
}) {
  const bridge = typeof window === "undefined" ? undefined : window.arenaDesktop;
  const [version, setVersion] = useState(APP_VERSION);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);

  // 桌面端：读取真实版本号，启动时检查一次更新，之后每 6 小时检查一次
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge.getAppVersion().then((v) => { if (alive && v) setVersion(v); }).catch(() => {});
    const check = () => {
      bridge.checkUpdate().then((r) => {
        if (alive) setUpdateInfo(r && r.ok && r.hasUpdate ? r : null);
      }).catch(() => {});
    };
    check();
    const timer = setInterval(check, 6 * 60 * 60 * 1000);
    const unsubscribe = bridge.onUpdateProgress((p) => setProgress(p));
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [bridge]);

  /** 点击版本号：有更新则弹窗确认；否则强制检查一次并提示已是最新 */
  const onVersionClick = async () => {
    if (!bridge) {
      toast.info("浏览器模式不支持自动更新，请前往 GitHub Releases 下载最新版");
      return;
    }
    if (updateInfo?.hasUpdate) {
      setProgress(null);
      setUpdateOpen(true);
      return;
    }
    const r = await bridge.checkUpdate(true).catch(() => null);
    if (!r) { toast.error("检查更新失败，请稍后重试"); return; }
    if (!r.ok) { toast.error(`检查更新失败：${r.error ?? "网络不可用"}`); return; }
    if (r.currentVersion) setVersion(r.currentVersion);
    if (r.hasUpdate) {
      setUpdateInfo(r);
      setProgress(null);
      setUpdateOpen(true);
    } else {
      toast.success(`当前已是最新版本 v${r.currentVersion ?? version}`);
    }
  };

  /** 确认更新：下载安装包 → 静默覆盖安装 → 自动重启 */
  const doInstall = async () => {
    if (!bridge || !updateInfo) return;
    setInstalling(true);
    setProgress({ phase: "downloading", percent: 0, message: "正在连接 GitHub 下载更新包…" });
    const r = await bridge
      .installUpdate({ downloadUrl: updateInfo.downloadUrl ?? undefined })
      .catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) {
      setInstalling(false);
      setProgress(null);
      toast.error(`更新失败：${r.error ?? "未知错误"}`);
    } else {
      toast.success("更新包已下载，应用即将关闭并自动安装…");
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* 侧边栏 */}
      <aside className="w-56 shrink-0 border-r border-sidebar-border bg-sidebar-background flex flex-col">
        <div className="px-5 py-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Swords className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[13px] font-semibold tracking-[0.14em]">LLM ARENA</div>
              <div className="text-[10px] text-muted-foreground">多模型能力评测竞技场</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active =
              page === item.key || (item.key === "runs" && page === "runDetail");
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={cn(
                  "group w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-all duration-150",
                  active
                    ? "bg-primary text-primary-foreground font-medium shadow-xs"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground active:scale-[0.98]",
                )}
              >
                <item.icon className={cn("h-4 w-4 shrink-0 transition-transform duration-200", !active && "group-hover:scale-110")} />
                {item.name}
              </button>
            );
          })}
        </nav>
        <div className="px-3 py-3 border-t border-sidebar-border space-y-2">
          {/* GitHub 仓库宣传：与下方版本块等高，保持侧边栏底部视觉整齐 */}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex h-8 items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 text-[11px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            title={`在浏览器中打开开源仓库 ${REPO_NAME}，欢迎点个 Star`}
          >
            <GithubMark className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">帮点个 Starred <span className="text-yellow-500">⭐</span> 吧</span>
          </a>

          <div className="relative flex h-8 items-center justify-between gap-1 rounded-md border border-sidebar-border px-2">
            {updateInfo?.hasUpdate && (
              <span className="absolute left-1 top-0.5 z-10 animate-pulse rounded bg-red-600 px-1 py-0.5 font-sans text-[9px] font-semibold leading-none text-white">
                更新
              </span>
            )}
            <button
              onClick={onVersionClick}
              className={cn(
                "flex min-w-0 items-center gap-1.5 font-data text-[10px] text-muted-foreground transition-colors hover:text-foreground",
                updateInfo?.hasUpdate && "pl-7",
              )}
              title={`当前版本 v${version} · 题库 ${BANK_VERSION} · 点击检查更新`}
            >
              <span className="truncate">v{version} · 题库 {BANK_VERSION}</span>
            </button>
            <ThemeToggle compact />
          </div>
        </div>

        <Dialog
          open={updateOpen}
          onOpenChange={(o) => {
            if (!o && !installing) setUpdateOpen(false);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="text-sm">发现新版本</DialogTitle></DialogHeader>
            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-2 font-data">
                <span className="text-muted-foreground">当前 v{updateInfo?.currentVersion ?? version}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold text-primary">最新 v{updateInfo?.latestVersion ?? "—"}</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                确认后将自动从 GitHub 下载最新版并静默覆盖安装，无需重新运行安装向导；安装完成后应用会自动重新启动，本地模型、配置与历史记录全部保留。
              </p>
              {updateInfo?.notes ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase text-muted-foreground">更新说明</div>
                  <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">{updateInfo.notes}</div>
                </div>
              ) : null}
              {updateInfo?.releaseUrl ? (
                <a
                  href={updateInfo.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-[11px] text-primary underline underline-offset-2"
                >
                  查看 Release 详情
                </a>
              ) : null}
              {installing ? (
                <div className="space-y-1.5">
                  <Progress value={progress?.percent ?? 0} className="h-1.5" />
                  <div className="text-[11px] text-muted-foreground">
                    {progress?.message ?? "正在处理…"}
                    {progress?.percent !== undefined ? `（${progress.percent}%）` : ""}
                  </div>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUpdateOpen(false)} disabled={installing}>稍后</Button>
              <Button onClick={doInstall} disabled={installing || !updateInfo?.downloadUrl}>
                {installing ? "更新中…" : "立即更新"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </aside>

      {/* 主区域：key 变化让每次页面切换重新播放淡入动画 */}
      <main className="flex-1 overflow-y-auto">
        <div key={page} className="max-w-[1400px] mx-auto px-6 py-6 animate-in fade-in-0 duration-300">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  desc,
  actions,
}: {
  title: string;
  desc?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold tracking-wide">{title}</h1>
        {desc && <p className="text-xs text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">{desc}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
