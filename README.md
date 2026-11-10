# CPA Quota for Codex

Codex 桌面版的「额度与模型」插件，附带紧凑的 Windows 悬浮窗。查看 CLIProxy 各账户的短周期、长周期剩余额度及重置时间，并跟随当前聊天模型优先显示匹配的账户。

当前版本 **2.9.2**。插件名 `cliproxy-quota`，插件市场名 `cpa-quota`。

## 快速安装

### 下载 ZIP 安装

1. 在 [Releases](https://github.com/hangsecret/cpa-quota-for-codex/releases/latest) 下载 `cpa-quota-for-codex-2.9.2-windows.zip`。
2. 解压到任意目录，双击 `Install.cmd`。安装器会寻找 Codex CLI 和可用的 Node，注册插件市场并安装插件。
3. 完全退出并重新打开 Codex 桌面版。在悬浮窗「设置 → 连接」中填写自己的 CLIProxy 管理后台根地址、管理接口版本和管理密钥。

安装器将插件市场文件保存在 `%LOCALAPPDATA%\CodexCLIProxyQuota\marketplaces\版本号-安装标识`。安装成功后可以删除下载的 ZIP 和解压目录。

管理密钥是 CLIProxy 管理后台的密钥，与模型调用 API Key 不同。首次安装的后台地址为空，需自行填写。

### 从 GitHub 安装

在能运行 `codex` 和 `git` 的 PowerShell 中执行以下两条命令。

```powershell
codex plugin marketplace add hangsecret/cpa-quota-for-codex --ref main
codex plugin add cliproxy-quota@cpa-quota
```

随后重启 Codex，填写连接设置。插件会在 Codex 的 Plugins 列表中显示为「额度与模型」。如果 `codex` 命令无法识别，可使用 ZIP 安装器自动定位桌面版附带的 CLI。

### 运行要求

- Windows 10/11，已安装并登录 Codex 桌面版，附带支持 `plugin` 命令的 Codex CLI。
- .NET Framework 4.8 和 Windows PowerShell 5.1。
- Node.js 22.13 或更高版本，需包含 `node:sqlite`。启动器优先查找 Codex 的本地 Node 运行时，再查找 PATH 中的 `node.exe`。如果都不可用，安装 [Node.js LTS](https://nodejs.org/en/download)。
- 可访问的 CLIProxy 管理接口及对应管理密钥。
- 从 GitHub 注册市场时需要 Git。ZIP 安装使用本地市场。

可通过环境变量 `CPA_QUOTA_NODE` 指定兼容的 `node.exe` 完整路径。改变环境变量后需重启 Codex。

## 使用

默认随 Codex 初始化自动打开悬浮窗。也可在 Codex 的 Plugins 中选择「额度与模型」，点击「打开插件」。启动页会打开已有窗口或启动新窗口。

- 每个账户独立显示主要短周期、长周期的剩余百分比和重置时间。多个账户支持同一模型时并列显示，悬停时间可查看完整日期。
- 默认跟随最近激活的 Codex 聊天模型，也可手动选模型。每分钟刷新额度，每两秒检查聊天模型。
- 「设置 → 外观 → 显示范围」支持「仅 Codex 窗口」和「所有应用窗口」，默认前者。切回 Codex 会恢复临时隐藏的窗口，手动隐藏后需主动打开。
- 支持始终置顶、拖动、边缘吸附、深色/白色背景、不透明度和鼠标远离时淡化。
- 顶部「−」隐藏，托盘图标双击可恢复。托盘菜单可显示、隐藏或退出。Codex 主进程退出后，窗口和额度查询后台一起关闭。
- 「模型」打开后自动拉取当前中转站的公共模型，也可点击「拉取模型」刷新。已配置与待添加的模型一起显示，可搜索并勾选添加、启用或取消显示。手动填写入口位于底部折叠项。
- 公共列表中同时存在 `account/model` 与 `model` 时，仅显示公共 ID `model`。只有带前缀 ID 的模型保留有效路由。已有菜单条目继续保留，拉取只读取列表，勾选后才保存菜单修改。
- 拉取复用 Codex 当前 `model_provider` 的 `base_url` 和 `env_key`，请求其 `/models` 接口。也支持供应商的 `experimental_bearer_token`，以及明确启用 `requires_openai_auth` 时的本地 API Key。管理密钥用于配额接口，模型列表请求使用模型调用凭据。
- 指定 `env_key` 时，按进程环境变量、Codex 用户目录的 `.env`、绑定接口的 Windows 加密缓存顺序读取对应密钥。使用 `CODEX_HOME` 时读取该目录中的 `.env`。首次安装即可读取 `.env`，修改文件后可直接点击「拉取模型」重试，原文件继续保留。
- 模型菜单管理要求 Codex 已配置 `model_catalog_json`，保存后重启 Codex 生效，每次修改前生成 `.cliproxy.bak` 备份。
- 查询失败时保留旧数据并停止自动查询，手动刷新成功后恢复。
- 「设置 → 连接 → 测试已保存连接」可使用已保存的管理配置测试认证和连通性，显示接口地址、耗时及脱敏错误。测试只读取一次凭据列表，结果仅包含诊断信息。编辑连接字段后先保存，再测试。

模型调用使用供应商的模型 API 连接，配额使用管理接口，两者可受到不同的代理、证书、路由和访问策略影响。模型能调用时，仍需单独验证管理接口。连接错误会显示 DNS、超时、证书或连接重置等原因；HTTP 401 表示认证失败，HTTP 403 会提示访问限制、远程管理禁用或临时 IP 封禁。

## 配额支持与兼容性

支持 CLIProxy v8 与 v0 管理接口，包含 Codex、Claude OAuth、Devin 及可识别的 Gemini / Antigravity 配额。Antigravity 查询需要凭据包含 `project_id`。其他扩展渠道可读取服务端配额插件的标准 `groups[].buckets[]`。

不同 CLIProxy 发行版和上游账户可能返回不同数据。无法识别的配额显示为未知。这里展示账户配额百分比，钱包货币余额需要供应商另外提供计费接口。

供应商匹配使用后台返回的完整模型 ID。模型发现失败时标记未知。多个账户独立展示，额度分别计算。

自动跟随模型依赖本机 Codex 桌面日志和只读 SQLite 状态，客户端升级可能需要适配。多窗口同时使用时跟随最近激活的聊天视图，尚未保存模型的新聊天可手动选模型。

本项目通过 GitHub 插件市场或本地市场分发。官方公共插件目录的上架需要另外提交审核。[官方打包与分发文档](https://developers.openai.com/plugins/build/plugins)

## 本地数据

用户数据保存在 `%LOCALAPPDATA%\CodexCLIProxyQuota`。

| 文件 | 内容 |
| --- | --- |
| `settings.json` | 后台地址、接口版本和 Windows 当前用户 DPAPI 加密的管理密钥 |
| `model-api-key.json` | 当前供应商环境变量中模型调用凭据的 DPAPI 加密缓存，供独立悬浮窗读取公共模型列表，绑定接口地址和变量名 |
| `desktop-preferences.json` | 主题、透明度、显示范围、置顶和自动启动偏好 |
| `desktop-startup-session.json` | 本次 Codex 运行的启动标记 |
| `desktop-runtime.json` | 窗口及所属 Codex 进程信息 |
| `desktop-startup-error.json` | 启动失败诊断信息 |
| `update-check.json` | 最新 Release 信息和检查时间 |
| `installed-update.json` | 已安装、等待重启的更新版本 |

密钥也可通过 `CLIPROXY_MANAGEMENT_KEY` 环境变量提供。插件通过用户设置向所配置的管理站点查询配额，模型管理工具修改本机模型目录。仓库及安装包仅包含程序和源码，个人连接配置需在本机填写。

## 升级与卸载

### 在插件内更新

2.8.0 起，悬浮窗「设置 → 关于与更新」可查看当前版本、最新版本、检查时间和更新说明。

- 启动时检查 GitHub 最新 Release，检查结果缓存 24 小时。长时间运行时定期查看缓存是否到期。断网或 GitHub 不可用时可手动重试。
- 发现新版后，悬浮窗底部显示版本提示，点击可进入更新设置。
- 点击「检查更新」可立即查询。点击「下载并安装更新」会下载已发布的 Windows ZIP，校验 SHA256 并安装。
- 安装完成后完全退出并重启 Codex。当前运行的窗口继续使用启动时的版本。
- GitHub 与 ZIP 安装均通过 Release 包更新。使用插件内更新或新版 `Install.cmd` 后，`cpa-quota` 市场切换到本机的 Release 安装目录，后续继续使用插件内更新。
- 安装前保留之前的插件市场快照，采用独立目录和单实例安装锁。安装失败时尝试恢复旧版，连接密钥和外观设置继续保存在用户数据目录。

检查和下载仅访问本项目的 GitHub 发布文件。检查每 24 小时最多自动发起一次，手动操作可随时重试。缓存中的旧数据在查询失败时标记错误，需成功检查后才可安装。

2.7.x 用户先手动安装一次 2.8.0 或更高版本，之后即可使用插件内更新。ZIP 用户下载新版并运行 `Install.cmd`，GitHub 用户也可以使用下面的命令。

### GitHub 市场手动更新

市场仍配置为 Git 来源时，可刷新并重新安装，然后完全退出并重启 Codex。

```powershell
codex plugin marketplace upgrade cpa-quota
codex plugin add cliproxy-quota@cpa-quota
```

如需改回 GitHub 市场来源，先运行 `codex plugin marketplace remove cpa-quota`，再执行快速安装中的 GitHub 命令。

在 Codex Plugins 中卸载，或运行以下命令。

```powershell
codex plugin remove cliproxy-quota@cpa-quota
codex plugin marketplace remove cpa-quota
```

退出已运行的悬浮窗后生效。需要清除连接设置和偏好时，可自行删除上述用户数据目录。

## 开发与打包

源码位置为 `plugins/cliproxy-quota`，JavaScript 无 npm 依赖。原生窗口使用 WPF 和 .NET Framework C# 编译器构建。

```powershell
git clone https://github.com/hangsecret/cpa-quota-for-codex.git
cd cpa-quota-for-codex
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1
```

生成的 ZIP、`SHA256SUMS.txt` 和 `update.json` 位于 `dist`。ZIP 包含插件市场、可执行窗口、源码、启动器和安装器，通过显式枚举文件保留 `.agents`、`.codex-plugin` 和 `.mcp.json`。`update.json` 包含版本、下载地址、SHA256 和更新说明，供插件检查新版。

仓库保留已编译的 `QuotaPet.exe`，以便直接从 GitHub 安装。修改 C# 后需重新运行 `plugins/cliproxy-quota/src/pet/build.ps1` 并提交更新后的可执行文件。

目录结构如下。

```text
.agents/plugins/marketplace.json    插件市场清单
plugins/cliproxy-quota/
  .codex-plugin/plugin.json        插件清单
  .mcp.json                        可迁移的 MCP 启动配置
  scripts/                         Node 定位与 MCP 启动器
  src/                             配额、模型、启动页和 WPF 源码
scripts/test.ps1                    JavaScript 与原生行为测试
scripts/package.ps1                 构建窗口并生成安装包
install.ps1 / Install.cmd           Windows 安装入口
.github/workflows/release.yml       测试、构建和 Release 发布
```

GitHub Actions 会在 `main` 推送和 Pull Request 时测试并上传安装包构建产物。发布时修改 `.codex-plugin/plugin.json` 和启动页的版本，在 `CHANGELOG.md` 添加对应版本的更新说明，编译并提交窗口，然后推送 `v版本号` 标签。测试与打包通过后自动创建 GitHub Release，附带 ZIP、校验文件和 `update.json`，已安装 2.8.0 及以上的用户即可检查到新版本。标签必须与插件清单版本一致。

CLIProxy 接口参考见 [管理 API](https://help.router-for.me/cn/management/apiv8)。
