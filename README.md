# 多模型评测竞技场（LLM Arena）

> 一个「本地优先」的多模型（LLM）能力评测竞技场：把若干 OpenAI 兼容接口的模型接进来，用**完全相同的题目、顺序、参数**跑同一套测试，自动判分、双通道复核、生成可视化报告与排行榜。

- **纯本地运行**：数据全部落在本机 SQLite，**不上传任何用户资料**。
- **可复现**：种子确定性抽题 + 题库内容哈希 + 参数快照固化。
- **可监督**：题目、评分标准、判分规则全部公开，支持人工复核覆盖。
- **开箱即用**：内置模拟模型（免密钥）即可完整跑通全流程。

---

## 一、下载安装包（普通用户看这里）

> 源码与安装包**分开存放**：本仓库（<https://github.com/luo-sri/llm-arena>）只放源码，安装包统一发布在本仓库的 **Releases（发行版）** 页面。

| 项目 | 说明 |
|---|---|
| **适用系统** | **Windows 10 / Windows 11（64 位 / x64）**。不支持 32 位系统、macOS、Linux。 |
| **安装包位置** | GitHub Releases：<https://github.com/luo-sri/llm-arena/releases/tag/v1.1.0> → 下载 `llm-arena-Setup-1.1.0.exe` |
| 直链（点此直接下载） | <https://github.com/luo-sri/llm-arena/releases/download/v1.1.0/llm-arena-Setup-1.1.0.exe> |
| 文件名 | `llm-arena-Setup-1.1.0.exe`（本地打包产物名为 `多模型评测竞技场-安装包-1.1.0.exe`，发布到 GitHub 时统一改为 ASCII 文件名，避免部分系统下载时中文乱码） |
| 大小 | 118.13 MB |
| SHA256 | `27B812C3663C3EB019820168A0EEA2B8CFC22413471403B94188FC397D0B82B3` |
| 安装方式 | 双击运行 → 阅读并**勾选同意**《用户许可、隐私与免责协议》→ 可自定义安装位置 → 完成后可勾选立即运行 |
| 卸载方式 | 通过「开始菜单 / 控制面板」卸载 → 先展示**清理清单**，勾选同意后卸载（**安装本软件之前就已存在的配置不会被清理**） |
| **作者联系方式** | **微信：luo09069**（使用中有疑问可直接加微信咨询） |

> 下载后建议用 `certutil -hashfile llm-arena-Setup-1.1.0.exe SHA256` 比对上方 SHA256，确认文件未被篡改。

### 安装后数据落在哪里（便于排查与彻底卸载）

| 内容 | 路径 |
|---|---|
| 安装目录（程序本体） | `%LOCALAPPDATA%\Programs\llm-arena` |
| 用户数据目录 | `%APPDATA%\llm-arena` |
| SQLite 数据库 | `%APPDATA%\llm-arena\data\llm-eval.db` |
| 桌面端设置（关闭行为等） | `%APPDATA%\llm-arena\desktop-settings.json` |

> 卸载程序会自动清理以上由本软件创建的内容（清理前会请你确认）。

---

## 二、这是什么

面向「模型选型 / 效果对比」场景的本地评测工具。核心思路：**同一套题、同一套参数、同一套判分规则**，让不同模型在完全对等的条件下比拼，避免「换个人测就换个结果」。

- 内置 6 个预设评测套件，覆盖逻辑、数学、编程、智能体、常识、多语言、指令遵循、阅读理解、创作、拒答安全等维度；
- 题库按难度分层（L1~L5），**高难题（L4+L5）占比约 71%**，能真正拉开模型差距；
- 判分采用「规则判分 + 模型评审」双通道，分歧超阈值自动进入人工复核；
- 输出总分、维度雷达图、排名、时延（均值/P95）、稳定性、成功率、成本统计与历史趋势；
- 一键生成可公开分享的报告（网页链接 / Markdown / JSON）。

---

## 三、核心特性

| 模块 | 能力 |
|---|---|
| 模型管理 | 增删改查、JSON 批量导入、连接测试（记录时延与错误）、分组、启用/停用、成本单价、内置模拟模型（免密钥） |
| 测试体系 | 公开题库 + 公开判分规则；套件可配置各维度题量、难度分层与权重 |
| 公平公正 | 固定随机种子、确定性题目顺序（所有模型一致）、统一参数快照、多次重复取均值、题库内容哈希防篡改 |
| 判分 | 8 种规则判分（精确/数值/正则/关键词/包含/代码执行/JSON 结构/模型评审）+ 双通道复核 + 人工覆盖 |
| 可视化 | 总分与维度雷达图、排名对比、能力条形图、时延 P95、稳定性、成功率、成本、历史趋势、版本对比 |
| 任务调度 | 后台队列、并发 1~16、实时日志、进度、暂停/继续/取消、单题重跑、失败追溯、重启自动恢复 |
| 报告 | 一键生成分享报告（网页链接 / Markdown / JSON），含题库版本与哈希、参数快照、逐题明细、免责声明 |
| 桌面端 | 系统托盘常驻；关闭窗口时可选择「最小化到托盘」或「直接退出」，可记住选择，也可在设置内随时修改 |

---

## 四、技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron 44（`contextIsolation: true`、`nodeIntegration: false`） |
| 前端 | React 19 + TypeScript 5.9 + Vite 7 + Tailwind CSS 3.4 + shadcn/ui（Radix）+ Recharts + lucide-react + sonner |
| 状态/数据 | tRPC 11 + @tanstack/react-query（端到端类型安全） |
| 后端 | Hono 4 + @hono/node-server + tRPC 11 fetch adapter |
| 数据库 | SQLite（`@libsql/client`）+ Drizzle ORM 0.45 |
| 模型接入 | OpenAI 兼容协议 `POST {baseUrl}/chat/completions` |
| 测试 | Vitest 4（单元）+ tsx 脚本（端到端自检/功能验证）+ PowerShell（安装包验证） |
| 打包 | electron-builder 26 + NSIS 3.0.4.1（简体中文向导） |

---

## 五、从源码运行（开发者看这里）

```bash
cd app
npm install

# 开发模式（前端 + 后端同端口，http://localhost:3000）
npm run dev
```

> 无需配置数据库：未设置 `DATABASE_URL` 时默认使用本地 SQLite 文件 `app/data/llm-eval.db`，首次启动自动建库并写入内置题库。

可选命令：

```bash
npm run check   # TypeScript 类型检查（tsc -b）
npm test        # 单元测试（Vitest，51 项）
npx tsx scripts/selfcheck.ts       # 端到端自检（跑通完整评测流程并校验公平性）
npx tsx scripts/verify-features.ts # 功能验证（暂停/继续/取消/报告/复核/导入导出/历史对比）
```

Windows 下也可直接双击仓库根目录的 `启动评测系统.bat` 一键启动。

---

## 六、自行打包安装包（Windows）

```powershell
cd app

# 国内网络建议先设置 Electron 镜像，避免下载二进制超时
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

npm run dist
```

产物：`app/release/多模型评测竞技场-安装包-<版本号>.exe`（另有 `win-unpacked/` 免安装目录）。

打包前会先执行 `scripts/prepare-license.mjs`，把 `app/build/license.txt`（UTF-8 源文件）转换成 NSIS 能正确显示的 UTF-16LE 版本——**这是安装向导中文不乱码的关键**，修改协议请只改 `license.txt`。

打包后可运行 `app/scripts/verify-installer.ps1` 做「静默安装 → 启动 → 接口验证 → 卸载 → 残留检查」全流程验证。

---

## 七、目录结构

```
Kimi_Agent_多模型评测系统/
├─ README.md                    # 本文件（项目介绍 + 下载指引）
├─ 项目说明与交接文档.md          # ★ 详细交接文档（架构/逻辑/数据模型/排错/操作手册）
├─ 启动评测系统.bat              # Windows 一键启动脚本（开发/生产）
└─ app/                         # 工程主体
   ├─ contracts/                # 前后端共享契约（维度/难度/判分/参数，单一事实来源）
   ├─ db/                       # Drizzle schema / 建库初始化 / 预设套件 / 种子
   ├─ api/                      # 后端：Hono + tRPC 路由 + 评测引擎（engine/）
   ├─ src/                      # 前端：页面 / 组件 / 主题 / tRPC Provider
   ├─ electron/                 # 桌面端主进程 / preload / 图标
   ├─ build/                    # 打包资源：许可协议、NSIS 自定义脚本
   ├─ scripts/                  # 自检 / 功能验证 / 安装包验证 / 协议转码
   └─ release/                  # 打包输出（安装包，已 gitignore，不进仓库）
```

---

## 八、隐私与免责

- 本软件**完全本地运行**，不会上传你的模型配置、密钥、题库与评测结果到任何服务器；
- 你填入的模型 API Key 仅保存在本机数据库中，请自行妥善保管；
- 本软件仅供**学习与研究**使用，评测结果不构成对任何模型的官方评价；
- 请勿将本软件用于任何违法违规或侵害他人权益的用途；基于本项目的二次开发须自行承担相应责任。

完整条款见安装向导中的《用户许可、隐私与免责协议》（源文件：`app/build/license.txt`）。

---

## 九、文档与联系

- 详细交接文档（面向接手同事 / 新对话 / 其他 Agent）：[项目说明与交接文档.md](项目说明与交接文档.md)
- 源码开发说明：[app/README.md](app/README.md)
- 作者联系方式：**微信：luo09069**