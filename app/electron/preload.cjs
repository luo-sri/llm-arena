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
});