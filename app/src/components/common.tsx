import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "@/providers/theme";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_MAP } from "../../contracts/eval";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <Card className="bg-card/70">
      <CardContent className="p-4">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</div>
        <div className={cn("text-2xl font-semibold font-data mt-1", accent && "text-primary")}>
          {value}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  const meta = CATEGORY_MAP[category];
  return (
    <Badge
      variant="outline"
      className="font-normal text-[11px]"
      style={{
        borderColor: `${meta?.color ?? "#666"}55`,
        color: meta?.color ?? "#999",
        backgroundColor: `${meta?.color ?? "#666"}14`,
      }}
    >
      {meta?.name ?? category}
    </Badge>
  );
}

export function ScoreText({ score, max = 100 }: { score: number | null | undefined; max?: number }) {
  if (score === null || score === undefined) return <span className="text-muted-foreground">—</span>;
  const pct = max === 1 ? score : score / 100;
  const color = pct >= 0.8 ? "text-success" : pct >= 0.5 ? "text-foreground" : "text-destructive";
  return <span className={cn("font-data font-semibold", color)}>{max === 1 ? score.toFixed(2) : score.toFixed(1)}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; cls: string }> = {
    pending: { text: "排队中", cls: "text-muted-foreground border-border" },
    running: { text: "运行中", cls: "text-info border-info/40 bg-info/10" },
    paused: { text: "已暂停", cls: "text-primary border-primary/40 bg-primary/10" },
    completed: { text: "已完成", cls: "text-success border-success/40 bg-success/10" },
    failed: { text: "失败", cls: "text-destructive border-destructive/40 bg-destructive/10" },
    cancelled: { text: "已取消", cls: "text-muted-foreground border-border" },
    done: { text: "成功", cls: "text-success border-success/40 bg-success/10" },
    skipped: { text: "已跳过", cls: "text-muted-foreground border-border" },
    ok: { text: "连接正常", cls: "text-success border-success/40 bg-success/10" },
    fail: { text: "连接失败", cls: "text-destructive border-destructive/40 bg-destructive/10" },
  };
  const m = map[status] ?? { text: status, cls: "" };
  return (
    <Badge variant="outline" className={cn("font-normal text-[11px]", m.cls)}>
      {m.text}
    </Badge>
  );
}

export function EmptyState({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="border border-dashed border-border rounded-md py-14 text-center animate-in fade-in-0 duration-300">
      <div className="text-sm text-muted-foreground">{text}</div>
      {hint && <div className="text-xs text-muted-foreground/70 mt-1.5">{hint}</div>}
    </div>
  );
}

/* ─── 图表主题：浅/深色两套调色板，前 3 色为灰阶保持黑白极简，其余为低饱和功能色 ─── */

interface ChartTheme {
  series: string[];
  grid: string;
  tick: string;
  legend: string;
  tooltip: React.CSSProperties;
}

const CHART_LIGHT: ChartTheme = {
  series: ["#1f1f23", "#0d8a6e", "#b45309", "#2563eb", "#6d28d9", "#be185d", "#8a8a92", "#b8b8be", "#c8c8ce"],
  grid: "#e9e9ec",
  tick: "#6e6e76",
  legend: "#3f3f46",
  tooltip: { background: "#ffffff", border: "1px solid #e4e4e7", borderRadius: 8, fontSize: 12, color: "#1f1f23", boxShadow: "0 4px 16px rgb(0 0 0 / 0.08)" },
};

const CHART_DARK: ChartTheme = {
  series: ["#f4f4f5", "#2dd4bf", "#fbbf24", "#60a5fa", "#a78bfa", "#f472b6", "#8a8a92", "#b6b6bc", "#5e5e66"],
  grid: "#26262b",
  tick: "#a1a1aa",
  legend: "#d4d4d8",
  tooltip: { background: "#18181b", border: "1px solid #2e2e33", borderRadius: 8, fontSize: 12, color: "#f4f4f5", boxShadow: "0 4px 16px rgb(0 0 0 / 0.4)" },
};

/** 随主题（含跟随系统）返回图表配色；首次渲染即从 <html> 的 class 读取，避免闪烁 */
export function useChartTheme(): ChartTheme {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme) setDark(resolvedTheme === "dark");
  }, [resolvedTheme]);
  return dark ? CHART_DARK : CHART_LIGHT;
}

export function download(filename: string, content: string, mime = "application/json") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("zh-CN", { hour12: false });
}
