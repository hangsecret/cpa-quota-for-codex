# CPA Quota for Codex

Codex 桌面版的「额度与模型」插件，附带紧凑的 Windows 悬浮窗。查看 CLIProxy 各账户的短周期、长周期剩余额度及重置时间，并跟随当前聊天模型优先显示匹配的账户。

当前版本 **2.7.1**。插件名 `cliproxy-quota`，插件市场名 `cpa-quota`。

## 快速安装

### 下载 ZIP 安装

1. 在 [Releases](https://github.com/hangsecret/cpa-quota-for-codex/releases/latest) 下载 `cpa-quota-for-codex-2.7.1-windows.zip`。
2. 解压到任意目录，双击 `Install.cmd`。安装器会寻找 Codex CLI 和可用的 Node，注册插件市场并安装插件。
3. 完全退出并重新打开 Codex 桌面版。在悬浮窗「设置 → 连接」中填写自己的 CLIProxy 管理后台根地址、管理接口版本和管理密钥。

安装器将插件市场文件保存在 `%LOCALAPPDATA%\CodexCLIProxyQuota\marketplace`。安装成功后可以删除下载的 ZIP 和解压目录。

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
- 「模型」中可以添加模型并设置显示名称，以及启停模型下拉菜单项。此功能要求 Codex 已配置 `model_catalog_json`，保存后重启 Codex 生效，每次修改前生成 `.cliproxy.bak` 备份。
- 查询失败时保留旧数据并停止自动查询，手动刷新成功后恢复。

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
| `desktop-preferences.json` | 主题、透明度、显示范围、置顶和自动启动偏好 |
| `desktop-startup-session.json` | 本次 Codex 运行的启动标记 |
| `desktop-runtime.json` | 窗口及所属 Codex 进程信息 |
| `desktop-startup-error.json` | 启动失败诊断信息 |

密钥也可通过 `CLIPROXY_MANAGEMENT_KEY` 环境变量提供。插件通过用户设置向所配置的管理站点查询配额，模型管理工具修改本机模型目录。仓库及安装包仅包含程序和源码，个人连接配置需在本机填写。

## 升级与卸载

GitHub 安装可刷新市场并重新安装，然后完全退出并重启 Codex。

```powershell
codex plugin marketplace upgrade cpa-quota
codex plugin add cliproxy-quota@cpa-quota
```

ZIP 安装可下载新版并再次运行 `Install.cmd`。外观和连接数据保存在版本目录之外，升级时继续使用。

两种方式共享 `cpa-quota` 市场名。需要从 GitHub 安装切换为 ZIP 安装，或反向切换时，先运行 `codex plugin marketplace remove cpa-quota`，再按所选方式安装。

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

生成的 ZIP 和 `SHA256SUMS.txt` 位于 `dist`，包含插件市场、可执行窗口、源码、启动器和安装器。ZIP 通过显式枚举文件保留 `.agents`、`.codex-plugin` 和 `.mcp.json`。

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

GitHub Actions 会在 `main` 推送和 Pull Request 时测试并上传安装包构建产物。推送 `v版本号` 标签时，测试与打包通过后自动创建 GitHub Release，并附带 ZIP 和校验文件。标签必须与插件清单版本一致。

CLIProxy 接口参考见 [管理 API](https://help.router-for.me/cn/management/apiv8)。
