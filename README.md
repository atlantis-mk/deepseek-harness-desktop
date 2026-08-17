<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  <strong>一键在本机启动 DeepSeek Harness</strong><br>
  自动检测或安全准备 Node.js 运行环境，无需配置命令行。
</p>

<p align="center"><sub>社区维护的开源项目，并非 DeepSeek 官方产品。</sub></p>

<p align="center">
  <a href="https://github.com/atlantis-mk/deepseek-harness-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/atlantis-mk/deepseek-harness-desktop?style=flat&amp;label=release&amp;color=4D6BFE" alt="Latest release"></a>
  <a href="https://github.com/atlantis-mk/deepseek-harness-desktop/releases"><img src="https://img.shields.io/github/downloads/atlantis-mk/deepseek-harness-desktop/total?style=flat&amp;label=downloads&amp;color=4D6BFE" alt="Total downloads"></a>
  <a href="https://github.com/atlantis-mk/deepseek-harness-desktop/actions/workflows/release.yml"><img src="https://github.com/atlantis-mk/deepseek-harness-desktop/actions/workflows/release.yml/badge.svg" alt="Build status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat" alt="Supported platforms: macOS, Windows and Linux">
</p>

<p align="center">
  <a href="https://blog.atlankj.com/products/deepseek-harness-desktop"><strong>产品介绍与下载</strong></a>
  ·
  <a href="https://github.com/atlantis-mk/deepseek-harness-desktop/releases/latest">GitHub Releases</a>
  ·
  <a href="https://blog.atlankj.com/products/deepseek-harness-desktop/ai.md">AI 安装文档</a>
</p>

<p align="center">
  <a href="https://blog.atlankj.com/products/deepseek-harness-desktop">
    <img src="https://blog.atlankj.com/api/media/file/deepseek-harness-desktop-hero-1-1200x630.jpg" alt="DeepSeek Harness Desktop 界面预览" width="100%">
  </a>
</p>

DeepSeek Harness Desktop 是面向 macOS、Windows 和 Linux 的非官方桌面启动器。它将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的本地 Web UI 带入原生桌面窗口，自动管理运行环境、本地服务和系统托盘。

这个仓库专注于轻量、可靠的启动体验：不修改 Harness 上游源码，不请求管理员权限，不改写系统 `PATH`，也不替换电脑上已有的 Node.js。

## 下载与安装

推荐前往[产品介绍页](https://blog.atlankj.com/products/deepseek-harness-desktop)自动识别系统并下载，也可以从 [GitHub Releases](https://github.com/atlantis-mk/deepseek-harness-desktop/releases/latest) 获取安装包和 `SHA256SUMS.txt`。

| 平台 | 系统要求 | 安装包 |
| --- | --- | --- |
| macOS Apple Silicon | macOS 10.15+，`arm64` | DMG / ZIP |
| macOS Intel | macOS 10.15+，`x64` | DMG / ZIP |
| Windows | Windows 10/11，`x64` | NSIS 安装程序 |
| Linux | 常见 `x86_64` 发行版 | AppImage / DEB |

发布资产也会镜像到 Cloudflare R2，可通过[最新版清单](https://pub-bf5092e77ab5409ba39fb34c4a76c1b1.r2.dev/deepseek-harness-desktop/latest.json)查询版本、文件大小、下载地址与 SHA-256。

> 当前安装包尚未进行 Apple notarization 或 Windows Authenticode 签名，系统可能显示“未知开发者”或类似提示。请确认下载来源，并在安装前核对 SHA-256。

## 首次启动

1. 打开 DeepSeek Harness Desktop。
2. 应用检查本机是否存在兼容的 Node.js 与全局安装的 `dsh`。
3. 如果没有，应用下载并校验一份仅供自身使用的私有 Node.js runtime。
4. 使用系统 Node.js 时，应用在用户的 npm 全局环境安装或更新 `@deepseek-ai/dsh`；使用私有 Node.js 时，Harness 同步安装或更新到私有 runtime。
5. 健康检查通过后，桌面窗口自动进入 Harness。

首次启动需要联网访问 Node.js、npm 与 DeepSeek Harness 相关服务，耗时取决于网络状况。之后直接复用对应环境中已安装的 Harness；启动失败时可以在启动页直接重试。

## 主要功能

| 功能 | 说明 |
| --- | --- |
| 一键启动 | 自动运行 `@deepseek-ai/dsh web`，无需手动使用终端 |
| 环境自适应 | 优先使用兼容的系统 Node.js，否则安装应用私有 runtime |
| 安全校验 | 下载的 Node.js 官方归档通过固定 SHA-256 校验后才会安装 |
| 自动同步 | 每次启动查询 npm registry，并在用户全局环境或应用私有环境中原位更新 DSH |
| 本地优先 | Harness 服务绑定 `127.0.0.1`，工作状态与缓存保存在本机 |
| 启动可视化 | 展示运行环境、版本同步、插件装载和界面就绪四个阶段 |
| 原生体验 | 集成桌面窗口、系统托盘、后台进程管理与失败重试 |
| 多平台发布 | 使用原生 GitHub Actions runner 构建 macOS、Windows 和 Linux 安装包 |

## 工作方式

```text
启动应用
   │
   ├─ 找到兼容的系统 Node.js（^22.19.0 或 >=24.0.0）
   │
   └─ 未找到 → 下载 Node.js 24.12.0 → SHA-256 校验 → 安装到私有目录
   │
   └─ 查询 @deepseek-ai/dsh 最新版本
   │
   └─ 系统 Node.js → 复用/更新用户全局 dsh
   │  私有 Node.js → 复用/更新私有全局 dsh
   │
   └─ 在 127.0.0.1 的空闲端口启动 Harness
   │
   └─ 健康检查通过 → 加载 Web UI
```

托管 runtime 与 `DSH_HOME` 位于 Electron 的 `userData` 目录。打包后的应用以用户的“文档”目录作为默认工作目录；开发模式使用当前项目目录。

关闭窗口时应用会保留在系统托盘。从托盘可以重新显示窗口、在默认浏览器中打开当前 Harness，或完全退出并停止后台进程。

## 本地开发

需要 Node.js 24 和 npm。

```sh
git clone https://github.com/atlantis-mk/deepseek-harness-desktop.git
cd deepseek-harness-desktop
npm ci
npm test
npm run check:environment
npm start
```

如需指定用于启动 Harness 的 Node.js，可传入绝对路径：

```sh
DSH_DESKTOP_NODE=/absolute/path/to/node npm start
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm start` | 启动 Electron 开发版本 |
| `npm test` | 运行 Node.js 单元测试 |
| `npm run check:environment` | 检查当前平台、Node.js 与 `npx` 环境 |
| `npm run pack` | 生成未封装的应用目录 |
| `npm run dist` | 构建当前平台的安装包 |

## 发布

维护者在干净且已同步的 `main` 分支运行：

```sh
npm run release -- 0.2.0
```

脚本会更新版本、运行测试、创建 release commit 和 `v0.2.0` tag，再推送到 GitHub。发布工作流随后在原生 runner 上构建各平台安装包、生成 SHA-256 摘要并创建 GitHub Release；配置 R2 凭据后，还会同步不可变的版本资产。

完整配置与发布流程见[发布说明](docs/releasing.md)。

## 项目关系

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)：提供核心 Agent、插件系统和 Web UI；本项目通过公开的 npm 包运行它。
- [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)：功能更完整的社区桌面端，也是本 README 信息结构与呈现方式的参考项目。
- 本仓库是独立实现的轻量启动器，与上述项目不存在隶属或背书关系。

## 安全与许可证

请勿在公开 Issue 中提交 token、密码、私有文件或其他敏感信息。安全问题请按 [Security Policy](SECURITY.md) 使用 GitHub 私密漏洞报告。

本项目基于 [MIT License](LICENSE) 开源。

> DeepSeek 是 DeepSeek AI 的商标。DeepSeek Harness Desktop 是独立的社区项目，并非 DeepSeek 官方产品，也未获得其背书。
