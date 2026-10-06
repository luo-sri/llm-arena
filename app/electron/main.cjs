const { app, BrowserWindow, Menu, Tray, shell, dialog, ipcMain, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { pathToFileURL } = require("url");

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  const isDev = !!process.env.ELECTRON_DEV;

  /** @type {BrowserWindow | null} */
  let mainWindow = null;
  /** @type {Tray | null} */
  let tray = null;
  /** 处于退出流程时为 true，此时不再拦截窗口关闭事件 */
  let isQuitting = false;

  const CLOSE_BEHAVIORS = ["ask", "tray", "quit"];
  const DEFAULT_SETTINGS = { closeBehavior: "ask" };

  function settingsPath() {
    return path.join(app.getPath("userData"), "desktop-settings.json");
  }

  /** 读取桌面端设置（首次运行或文件损坏时回退默认值） */
  function readSettings() {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
      if (parsed && CLOSE_BEHAVIORS.includes(parsed.closeBehavior)) {
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      /* 首次运行尚无配置文件 */
    }
    return { ...DEFAULT_SETTINGS };
  }

  function writeSettings(patch) {
    const next = { ...readSettings(), ...patch };
    try {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf-8");
    } catch (e) {
      console.error("保存桌面端设置失败：", e);
    }
    return next;
  }

  function findFreePort(start, max = 50) {
    return new Promise((resolve, reject) => {
      const net = require("net");
      const tryPort = (p, left) => {
        const srv = net.createServer();
        srv.once("error", () => {
          if (left <= 0) return reject(new Error("无可用端口"));
          tryPort(p + 1, left - 1);
        });
        srv.once("listening", () => srv.close(() => resolve(p)));
        srv.listen(p, "127.0.0.1");
      };
      tryPort(start, max);
    });
  }

  function waitForServer(port, timeoutMs = 30000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const poll = () => {
        const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500 }, (res) => {
          res.resume();
          resolve();
        });
        req.on("timeout", () => req.destroy());
        req.on("error", () => {
          if (Date.now() - started > timeoutMs) return reject(new Error("服务器启动超时"));
          setTimeout(poll, 250);
        });
      };
      poll();
    });
  }

  function showMainWindow() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }

  function quitApp() {
    isQuitting = true;
    app.quit();
  }

  /** 系统托盘常驻：右键可「打开主界面 / 退出应用」，单击图标恢复窗口 */
  function createTray() {
    if (tray) return;
    try {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.ico")));
    } catch (e) {
      console.error("创建系统托盘失败：", e);
      tray = null;
      return;
    }
    tray.setToolTip("多模型评测竞技场");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "打开主界面", click: showMainWindow },
        { type: "separator" },
        { label: "退出应用", click: quitApp },
      ]),
    );
    tray.on("click", showMainWindow);
    tray.on("double-click", showMainWindow);
  }

  /** 弹出关闭确认对话框，返回最终选择：tray / quit / null（取消） */
  async function promptCloseChoice(win) {
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: "question",
      noLink: true,
      buttons: ["最小化到托盘", "直接退出", "取消"],
      defaultId: 0,
      cancelId: 2,
      title: "关闭确认",
      message: "您希望如何关闭「多模型评测竞技场」？",
      detail: [
        "最小化到托盘：应用继续在后台运行，可从任务栏右下角的托盘图标重新打开。",
        "直接退出：结束应用及其全部后台进程，释放系统资源。",
        "",
        "勾选下方选项可记住本次选择，之后不再询问；随时可在「设置与备份」页面修改。",
      ].join("\n"),
      checkboxLabel: "记住我的选择，以后不再询问",
      checkboxChecked: false,
    });
    if (response === 2) return null;
    const choice = response === 0 ? "tray" : "quit";
    if (checkboxChecked) writeSettings({ closeBehavior: choice });
    return choice;
  }

  function attachCloseBehavior(win) {
    win.on("close", (e) => {
      if (isQuitting) return;
      const { closeBehavior } = readSettings();

      if (closeBehavior === "tray") {
        e.preventDefault();
        win.hide();
        return;
      }
      if (closeBehavior === "quit") {
        isQuitting = true;
        return;
      }

      // ask：必须先同步拦截，再异步询问
      e.preventDefault();
      void promptCloseChoice(win).then((choice) => {
        if (choice === null) return;
        if (choice === "tray") win.hide();
        else quitApp();
      });
    });
  }

  function createWindow(port) {
    Menu.setApplicationMenu(null);
    const win = new BrowserWindow({
      width: 1360,
      height: 880,
      minWidth: 1024,
      minHeight: 700,
      title: "多模型评测竞技场",
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      icon: path.join(__dirname, "icon.ico"),
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadURL(`http://127.0.0.1:${port}/`);
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: "deny" };
    });
    attachCloseBehavior(win);
    return win;
  }

  app.on("second-instance", () => showMainWindow());
  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.whenReady().then(async () => {
    ipcMain.handle("desktop:get-close-behavior", () => readSettings().closeBehavior);
    ipcMain.handle("desktop:set-close-behavior", (_e, value) => {
      if (CLOSE_BEHAVIORS.includes(value)) writeSettings({ closeBehavior: value });
      return readSettings().closeBehavior;
    });
    ipcMain.handle("desktop:quit", () => {
      quitApp();
      return true;
    });
    ipcMain.handle("desktop:minimize-to-tray", () => {
      if (mainWindow) mainWindow.hide();
      return true;
    });

    try {
      const port = isDev ? 3000 : await findFreePort(38712);
      process.env.NODE_ENV = "production";
      process.env.PORT = String(port);
      const dataDir = app.getPath("userData");
      process.env.DATABASE_URL =
        "file:" + path.join(dataDir, "data", "llm-eval.db").replace(/\\/g, "/");

      const bootPath = path.join(__dirname, "..", "dist", "boot.js");
      await import(pathToFileURL(bootPath).href);
      await waitForServer(port);
      mainWindow = createWindow(port);
      createTray();
    } catch (e) {
      dialog.showErrorBox("启动失败", String(e?.message ?? e));
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    // 托盘常驻模式下窗口是被隐藏而非关闭，不会走到这里；其余情况直接退出
    if (isQuitting || !tray || readSettings().closeBehavior !== "tray") app.quit();
  });
}