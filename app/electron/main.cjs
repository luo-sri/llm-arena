const { app, BrowserWindow, Menu, Tray, shell, dialog, ipcMain, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const https = require("https");

/** 自动更新：仅允许从本项目自己的 GitHub Release 下载，杜绝执行任意来源的可执行文件 */
const UPSTREAM_REPO = "luo-sri/llm-arena";
const RELEASES_API = `https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`;
const RELEASE_DOWNLOAD_PREFIX = `https://github.com/${UPSTREAM_REPO}/releases/download/`;
const ALLOWED_REDIRECT_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
/** 检查更新结果缓存：避免频繁请求 GitHub API 触发限流 */
const UPDATE_CACHE_MS = 10 * 60 * 1000;
let updateCache = null;
let updateCheckedAt = 0;

/** 请求文本（仅用于 GitHub API，超时 10 秒；自动跟随重定向） */
function httpsGetText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("重定向次数过多"));
    const req = https.get(
      url,
      { headers: { "User-Agent": "llm-arena-updater", Accept: "application/vnd.github+json" }, timeout: 10000 },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).href;
          httpsGetText(next, redirects + 1).then(resolve, reject);
          return;
        }
        if (code !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${code}`));
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
      },
    );
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
  });
}

function versionParts(v) {
  return String(v || "")
    .replace(/^v/i, "")
    .split("-")[0]
    .split(".")
    .map((x) => parseInt(x, 10) || 0);
}

function isNewerVersion(latest, current) {
  const a = versionParts(latest);
  const b = versionParts(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** 查询 GitHub 最新 Release（带 10 分钟缓存，避免触发 API 限流） */
async function checkLatestRelease(force) {
  const currentVersion = app.getVersion();
  if (!force && updateCache && Date.now() - updateCheckedAt < UPDATE_CACHE_MS) return updateCache;
  try {
    const raw = await httpsGetText(RELEASES_API);
    const rel = JSON.parse(raw);
    const tag = String(rel.tag_name || rel.name || "");
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const asset = assets.find((a) => /^llm-arena-Setup-.+\.exe$/i.test(String(a.name || "")));
    const downloadUrl =
      (asset && asset.browser_download_url) ||
      (tag ? `${RELEASE_DOWNLOAD_PREFIX}${tag}/llm-arena-Setup-${tag.replace(/^v/i, "")}.exe` : null);
    const result = {
      ok: true,
      currentVersion,
      latestVersion: tag.replace(/^v/i, ""),
      hasUpdate: isNewerVersion(tag, currentVersion),
      downloadUrl,
      releaseUrl: rel.html_url || `https://github.com/${UPSTREAM_REPO}/releases`,
      notes: String(rel.body || "").slice(0, 4000),
      publishedAt: rel.published_at || null,
    };
    updateCache = result;
    updateCheckedAt = Date.now();
    return result;
  } catch (e) {
    return { ok: false, currentVersion, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 严格校验：只允许本项目官方 Release 的安装包地址 */
function assertAllowedDownload(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("下载地址无效");
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== "github.com" ||
    !u.pathname.startsWith(`/${UPSTREAM_REPO}/releases/download/`)
  ) {
    throw new Error("下载地址不属于本项目官方 Release，已拒绝执行");
  }
  return u.href;
}

/** 下载安装包（进度回调；跳转域名必须为 GitHub 官方域名） */
function downloadFile(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error("下载重定向次数过多"));
    if (redirects > 0) {
      let u;
      try {
        u = new URL(url);
      } catch {
        return reject(new Error("下载地址无效"));
      }
      if (!ALLOWED_REDIRECT_HOSTS.has(u.hostname)) {
        return reject(new Error("下载跳转到了非官方域名，已中止"));
      }
    }
    const req = https.get(url, { headers: { "User-Agent": "llm-arena-updater" }, timeout: 20000 }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        downloadFile(next, dest, onProgress, redirects + 1).then(resolve, reject);
        return;
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(`下载失败：HTTP ${code}`));
      }
      const total = Number(res.headers["content-length"] || 0);
      let received = 0;
      const out = fs.createWriteStream(dest);
      res.on("data", (chunk) => {
        received += chunk.length;
        onProgress(received, total);
      });
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve({ received, total })));
      out.on("error", reject);
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("下载超时")));
    req.on("error", reject);
  });
}

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
    // 用系统默认浏览器打开链接（仅允许 http/https，避免 file:// 等本地协议）
    ipcMain.handle("desktop:open-external", async (_e, url) => {
      try {
        const u = new URL(String(url));
        if (u.protocol !== "http:" && u.protocol !== "https:") return false;
        await shell.openExternal(u.href);
        return true;
      } catch {
        return false;
      }
    });

    // ─── 自动更新：检测 GitHub 最新 Release → 下载 → 静默覆盖安装 ───
    ipcMain.handle("desktop:get-version", () => app.getVersion());
    ipcMain.handle("update:check", async (_e, force) => checkLatestRelease(force === true));
    ipcMain.handle("update:install", async (event, payload) => {
      const send = (data) => {
        try {
          if (!event.sender.isDestroyed()) event.sender.send("update:progress", data);
        } catch {
          /* 窗口已关闭，忽略 */
        }
      };
      try {
        const info = await checkLatestRelease(false);
        if (!info.ok) throw new Error(info.error || "检查更新失败");
        // 静默覆盖安装需要当前安装目录可写；若装在受保护路径则提示手动更新，避免更新后无法重启
        try {
          fs.accessSync(path.dirname(app.getPath("exe")), fs.constants.W_OK);
        } catch {
          throw new Error("当前安装目录不可写（可能安装在受保护路径），请前往 GitHub Releases 手动下载安装包更新");
        }
        const url = assertAllowedDownload((payload && payload.downloadUrl) || info.downloadUrl || "");
        const dir = path.join(app.getPath("temp"), "llm-arena-update");
        fs.mkdirSync(dir, { recursive: true });
        const base = path.basename(new URL(url).pathname) || "llm-arena-Setup-update.exe";
        const dest = path.join(dir, base.replace(/[^\w.-]/g, "_"));
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
        } catch {
          /* 旧的残留文件删除失败时继续覆盖 */
        }

        send({ phase: "downloading", percent: 0, message: "正在下载更新包…" });
        let lastSent = 0;
        const { received, total } = await downloadFile(url, dest, (bytes, size) => {
          const now = Date.now();
          if (now - lastSent < 500) return;
          lastSent = now;
          const percent = size ? Math.round((bytes / size) * 1000) / 10 : undefined;
          send({
            phase: "downloading",
            percent,
            message: `已下载 ${(bytes / 1048576).toFixed(1)} MB${size ? ` / ${(size / 1048576).toFixed(1)} MB` : ""}`,
          });
        });
        const sizeNow = Number(received) || fs.statSync(dest).size;
        if (sizeNow < 10 * 1024 * 1024) {
          try { fs.unlinkSync(dest); } catch { /* ignore */ }
          throw new Error("安装包下载不完整（文件过小），已取消更新");
        }

        send({ phase: "installing", message: "下载完成，应用即将关闭并静默安装新版本…" });
        // 延迟启动静默安装：确保本应用已完全退出，安装器才能覆盖程序文件；
        // 安装完成后自动重新启动应用（静默安装不会经过「完成页」，需显式拉起）。
        const escaped = dest.replace(/'/g, "''");
        const exePath = app.getPath("exe").replace(/'/g, "''");
        const ps = [
          "Start-Sleep -Seconds 3",
          `Start-Process -FilePath '${escaped}' -ArgumentList '/S' -Wait`,
          "Start-Sleep -Seconds 2",
          `if (Test-Path '${exePath}') { Start-Process -FilePath '${exePath}' }`,
        ].join("; ");
        spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        }).unref();
        setTimeout(() => quitApp(), 1000);
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send({ phase: "error", message: msg });
        return { ok: false, error: msg };
      }
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