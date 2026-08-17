# DeepSeek Harness Desktop

[![Release](https://img.shields.io/github/v/release/atlantis-mk/deepseek-harness-desktop?display_name=tag)](https://github.com/atlantis-mk/deepseek-harness-desktop/releases/latest)
[![Build](https://github.com/atlantis-mk/deepseek-harness-desktop/actions/workflows/release.yml/badge.svg)](https://github.com/atlantis-mk/deepseek-harness-desktop/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DeepSeek Harness Desktop 是 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web UI 的非官方桌面启动器。它会优先使用电脑上兼容的 Node.js；如果没有，则下载并校验一份仅供应用使用的私有 Node.js runtime，再在本机启动 Harness。

> 本项目与 DeepSeek 官方无隶属或背书关系。首次启动可能需要联网下载 Node.js 和 `@deepseek-ai/dsh`。

## 下载

请从 [GitHub Releases](https://github.com/atlantis-mk/deepseek-harness-desktop/releases/latest) 下载最新版：

- macOS：Apple Silicon (`arm64`) 或 Intel (`x64`) DMG
- Windows：x64 NSIS 安装包
- Linux：x64 AppImage 或 Debian 包

配置 R2 发布凭据后，发布资产会同时镜像到 Cloudflare R2。最新版本清单地址为：

- [R2 latest.json](https://pub-bf5092e77ab5409ba39fb34c4a76c1b1.r2.dev/deepseek-harness-desktop/latest.json)

当前安装包未进行 Apple notarization 或 Windows Authenticode 签名，系统可能显示未知开发者提示。

## 工作方式

1. 查找符合 DeepSeek Harness 要求的 Node.js（`^22.19.0 || >=24.0.0`）。
2. 确认同一安装中存在 npm 的 `npx-cli.js`。
3. 如果检测失败，下载当前平台对应的 Node.js：macOS、Windows 和 Linux 的 x64 / arm64。
4. 使用 Node.js 官方发布的 SHA-256 校验下载文件。
5. 查询 npm registry 中当前 DSH 版本，在空闲的 localhost 端口运行 `npx --yes @deepseek-ai/dsh@<version> web`。
6. 本地服务通过健康检查后才加载 Web UI。

托管 runtime、npm cache 和 DSH 状态保存在 Electron 的 `userData` 目录。启动器不会请求管理员权限、修改 `PATH` 或替换系统 Node.js。

## 本地开发

需要 Node.js 24 和 npm：

```sh
npm ci
npm test
npm run check:environment
npm start
```

开发时可以指定 Node.js 的绝对路径：

```sh
DSH_DESKTOP_NODE=/absolute/path/to/node npm start
```

为当前平台打包：

```sh
npm run dist
```

## 发布

维护者在干净的 `main` 分支运行：

```sh
npm run release -- 0.2.0
```

脚本会更新版本、运行测试、创建 release commit 和 `v0.2.0` tag，再推送到 GitHub。`release.yml` 随后在原生 runner 上构建全部安装包，创建 GitHub Release Assets，并在已配置 R2 凭据时同步到不可变的 `deepseek-harness-desktop/releases/v0.2.0/` 路径。

R2 发布所需的 GitHub Actions 配置见 [发布说明](docs/releasing.md)。

## 安全与许可证

请不要在公开 Issue 中提交 token、密码或其他敏感信息。安全问题请使用 GitHub 的私密漏洞报告。

项目基于 [MIT License](LICENSE) 开源。
