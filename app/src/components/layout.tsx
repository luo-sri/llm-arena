import type { ReactNode } from "react";
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

export function AppLayout({
  page,
  onNavigate,
  children,
}: {
  page: PageKey;
  onNavigate: (p: PageKey) => void;
  children: ReactNode;
}) {
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
        <div className="px-3 py-3 border-t border-sidebar-border">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-data">
              题库 {BANK_VERSION} · seed-locked
            </span>
            <ThemeToggle compact />
          </div>
        </div>
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
