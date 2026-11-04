export type CloseBehavior = "ask" | "tray" | "quit";

export interface UpdateCheckResult {
  ok: boolean;
  currentVersion: string;
  latestVersion?: string;
  hasUpdate?: boolean;
  downloadUrl?: string | null;
  releaseUrl?: string;
  notes?: string;
  publishedAt?: string | null;
  error?: string;
}

export interface UpdateProgress {
  phase: "downloading" | "installing" | "error";
  percent?: number;
  message?: string;
}

export interface ArenaDesktopBridge {
  isDesktop: true;
  getCloseBehavior: () => Promise<CloseBehavior>;
  setCloseBehavior: (value: CloseBehavior) => Promise<CloseBehavior>;
  quitApp: () => Promise<boolean>;
  minimizeToTray: () => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  checkUpdate: (force?: boolean) => Promise<UpdateCheckResult>;
  installUpdate: (payload?: { downloadUrl?: string }) => Promise<{ ok: boolean; error?: string }>;
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void;
}

declare global {
  interface Window {
    /** 由 Electron preload 注入；浏览器访问时为 undefined */
    arenaDesktop?: ArenaDesktopBridge;
  }
}
