// 渲染进程与主进程之间的安全桥（contextIsolation 开启，仅暴露白名单方法）
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("arenaDesktop", {
  isDesktop: true,
  /** 读取「关闭按钮行为」：ask=每次询问 / tray=最小化到托盘 / quit=直接退出 */
  getCloseBehavior: () => ipcRenderer.invoke("desktop:get-close-behavior"),
  /** 设置「关闭按钮行为」，返回保存后的值 */
  setCloseBehavior: (value) => ipcRenderer.invoke("desktop:set-close-behavior", value),
  /** 立即退出应用（结束全部后台进程） */
  quitApp: () => ipcRenderer.invoke("desktop:quit"),
  /** 隐藏窗口到系统托盘（应用继续后台运行） */
  minimizeToTray: () => ipcRenderer.invoke("desktop:minimize-to-tray"),
  /** 用系统默认浏览器打开链接（仅 http/https） */
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  /** 读取桌面端实际版本号（来自 package.json / electron-builder 打包版本） */
  getAppVersion: () => ipcRenderer.invoke("desktop:get-version"),
  /** 检查 GitHub 最新 Release；force=true 跳过缓存 */
  checkUpdate: (force) => ipcRenderer.invoke("update:check", !!force),
  /** 下载并静默覆盖安装最新版（仅接受本项目官方 Release 安装包） */
  installUpdate: (payload) => ipcRenderer.invoke("update:install", payload || {}),
  /** 订阅下载/安装进度，返回取消订阅函数 */
  onUpdateProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },
});