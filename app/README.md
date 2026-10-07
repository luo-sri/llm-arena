# app —— 多模型评测竞技场（工程主体）

本目录是「多模型评测竞技场」的工程主体（前端 + 后端 + 桌面端 + 打包配置）。

> 项目总览、安装包下载、适用系统与作者联系方式，请看仓库根目录的 [README.md](../README.md)。
> 详细架构 / 逻辑 / 数据模型 / 排错 / 操作手册，请看 [项目说明与交接文档.md](../项目说明与交接文档.md)。

## 快速开始

```bash
npm install
npm run dev        # 前端 + 后端同端口：http://localhost:3000
```

无需配置数据库：未设置 `DATABASE_URL` 时默认使用本地 SQLite `./data/llm-eval.db`，首次启动自动建库并写入内置题库。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式（Vite Dev Server + 内嵌 Hono 后端） |
| `npm run build` | 生产构建：`vite build`（输出 `dist/public`）+ esbuild 打包后端 `dist/boot.js` |
| `npm start` | 以生产模式启动后端（需先 `npm run build`） |
| `npm run dist` | 打包 Windows 安装包（含协议转码 → 构建 → electron-builder） |
| `npm run check` | TypeScript 类型检查（`tsc -b`） |
| `npm test` | 单元测试（Vitest） |
| `npm run selfcheck` | 端到端自检（跑通完整评测流程、竞技场评级、逐题明细分页/失败批量重跑/复核全部忽略，并校验公平性不变量，结束时自动清理） |
| `npm run verify` | 功能验证（暂停/继续/取消/报告/复核/导入导出/历史对比） |
| `npm run seed` | 手动写入内置题库与默认套件 |

## 技术栈

- 前端：React 19 + TypeScript + Vite 7 + Tailwind CSS + shadcn/ui + Recharts
- 后端：Hono 4 + tRPC 11（端到端类型安全）
- 数据库：SQLite（`@libsql/client`）+ Drizzle ORM（`drizzle-orm/sqlite-core`）
- 桌面端：Electron 44（`electron/main.cjs` + `electron/preload.cjs`）
- 模型接入：OpenAI 兼容协议 `POST {baseUrl}/chat/completions`
- 打包：electron-builder 26 + NSIS 3.0.4.1（简体中文向导）

## 目录说明

```
api/          后端：boot.ts（Hono 入口）/ router.ts / middleware / lib / queries / routers
  engine/     评测引擎（纯逻辑，便于单测）：题库 / 抽题 / 随机 / 模型适配 / 判分 / 调度 / 聚合 / 对战
contracts/    前后端共享契约：维度 CATEGORIES / 难度 / 判分类型 / 参数 / 套件配置
db/           Drizzle schema / relations / init（建库建表 + PRAGMA + 幂等种子）/ presets / seed
electron/     桌面端主进程、preload 桥、图标
build/        打包资源：license.txt（协议源文件，UTF-8）、license.utf16le.txt（生成物）、installer.nsh
scripts/      prepare-license.mjs（协议转码）、selfcheck.ts、verify-features.ts、verify-installer.ps1
src/          前端：pages（11 个页面）/ components / providers / hooks / lib / types
release/      打包输出（安装包，已 gitignore）
```

## 打包安装包（Windows）

```powershell
# 国内网络建议先设置镜像，避免 Electron 二进制下载超时
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

npm run dist
```

产物位于 `release/多模型评测竞技场-安装包-<版本号>.exe`。

> ⚠️ 修改许可协议时**只改** `build/license.txt`（UTF-8）；打包前的 `prepare-license.mjs` 会自动生成 `license.utf16le.txt` 供 NSIS 使用。直接手改生成物会导致安装向导中文乱码。

打包后可运行 `scripts/verify-installer.ps1` 做「静默安装 → 启动 → 接口验证 → 卸载 → 残留检查」全流程验证。

## 数据落盘位置

| 内容 | 路径 |
|---|---|
| 开发模式数据库 | `app/data/llm-eval.db`（+ `-wal` / `-shm`） |
| 桌面端用户数据 | `%APPDATA%\llm-arena`（`userData` 取自 package.json 的 `name`） |
| 桌面端数据库 | `%APPDATA%\llm-arena\data\llm-eval.db` |
| 桌面端设置 | `%APPDATA%\llm-arena\desktop-settings.json` |