import { useEffect, useState } from "react";
import { useTheme } from "@/providers/theme";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** 主题切换：跟随系统 / 浅色 / 深色。下拉经 Radix Portal 渲染到 body，永远置顶 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const options: { value: "system" | "light" | "dark"; name: string; icon: typeof Monitor }[] = [
    { value: "system", name: "跟随系统", icon: Monitor },
    { value: "light", name: "浅色", icon: Sun },
    { value: "dark", name: "深色", icon: Moon },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          className={cn("relative gap-2 text-muted-foreground", compact && "h-8 w-8 p-0")}
          title="切换主题"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform duration-200 dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform duration-200 dark:rotate-0 dark:scale-100" />
          {!compact && <span className="text-xs">{mounted ? `主题：${options.find((o) => o.value === theme)?.name ?? "跟随系统"}` : "主题"}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-32">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onClick={() => setTheme(o.value)}
            className={cn("gap-2 text-xs", mounted && theme === o.value && "font-semibold")}
          >
            <o.icon className="h-3.5 w-3.5" />
            {o.name}
            {mounted && theme === o.value && <span className="ml-auto text-[10px]">●</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
