import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "llm-eval-theme";

interface ThemeCtx {
  theme: Theme | undefined;
  resolvedTheme: "light" | "dark" | undefined;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx>({
  theme: undefined,
  resolvedTheme: undefined,
  setTheme: () => {},
});

function prefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * 主题系统：跟随系统 / 浅色 / 深色，class 策略，持久化到 localStorage。
 * 自研实现替代 next-themes：纯客户端 SPA 无需防 SSR 闪烁的内联 script，
 * 也避免 next-themes 在 React 19 下渲染 script 元素触发控制台报错。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() => (prefersDark() ? "dark" : "light"));

  useEffect(() => {
    const apply = () => {
      const r = theme === "system" ? (prefersDark() ? "dark" : "light") : theme;
      setResolved(r);
      const root = document.documentElement;
      root.classList.toggle("dark", r === "dark");
      root.style.colorScheme = r;
    };
    apply();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    window.localStorage.setItem(STORAGE_KEY, t);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme: resolved, setTheme }),
    [theme, resolved, setTheme],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
