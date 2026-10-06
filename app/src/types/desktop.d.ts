export type CloseBehavior = "ask" | "tray" | "quit";

export interface ArenaDesktopBridge {
  isDesktop: true;
  getCloseBehavior: () => Promise<CloseBehavior>;
  setCloseBehavior: (value: CloseBehavior) => Promise<CloseBehavior>;
  quitApp: () => Promise<boolean>;
  minimizeToTray: () => Promise<boolean>;
}

declare global {
  interface Window {
    /** 由 Electron preload 注入；浏览器访问时为 undefined */
    arenaDesktop?: ArenaDesktopBridge;
  }
}