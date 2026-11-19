# TypeSub

[英文](README.md) | 中文

> 软件正在开发初期,以下下载的是Pre-release版本

[![Download for Linux](https://img.shields.io/badge/Download-Linux_AMD64-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/Top-Dimension/TypeSub/releases/download/0.1.2/typesub_0.1.2_amd64.deb)
[![Download for Windows](https://img.shields.io/badge/Download-Windows_x64-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/Top-Dimension/TypeSub/releases/download/0.1.2/TypeSub-Setup-0.1.2-x64.exe)
![Version](https://img.shields.io/badge/version-0.1.2-blue)
![Desktop](https://img.shields.io/badge/desktop-Electron-47848F)
![Engine](https://img.shields.io/badge/engine-Rust-DEA584)
![Migration](https://img.shields.io/badge/Rust%20migration-in%20progress-yellow)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

TypeSub 识别麦克风的语音，在 OBS 浏览器来源逐字显示字幕，也支持为汉字显示拼音。

## 能玩什么

- 点工作台里的「试一试」，看 Rust 引擎驱动的逐字字幕。标点会稍作停顿，进度落后时会追赶，文本改写时也能保留没变的部分。
- 横排、竖排都能选，再搭配左起、居中、右起；拼音、声调、字体、颜色、描边、背景和打字间隔也能随手调。
- 懒得从头调的话，直接用游戏娱乐、语音房或教学竖排预设。设置会自动保存，下次打开接着用。
- Windows 和 macOS 上有系统托盘时，关闭主窗口后程序会留在托盘。Linux 上可最小化窗口，让实时字幕继续运行。配置和日志可以从诊断页打开，诊断信息也能导出。

## 跑起来

从源码运行需要 Node.js、npm 和 Rust。Windows 构建使用 Rust 的 MSVC 工具链，Linux x64 构建使用本机 GNU 工具链并生成 AppImage。

```powershell
npm install
npm start
```

`npm start` 会先编译 Rust 引擎，再打开 Electron 桌面窗口。让 TypeSub 和 OBS 在同一台电脑运行。在 TypeSub 工作台点击「复制 URL」，再在 OBS 添加「浏览器」来源并粘贴 URL。把来源属性里的宽度和高度设为需要的字幕区域。字幕会按来源尺寸自动换行，空间不足时按整行或整列翻页。

首次打开软件时，或在工作台的「输入」里，点击「下载模型（134 MB）」。TypeSub 会下载并校验支持普通话和英语的 Zipformer 模型。在「输入 → 麦克风」选择设备，然后点击「开始识别」进行离线识别。切换设备前请先暂停识别，列表里没有所需设备时可点击「刷新设备」。也可以先用「试一试」检查 OBS 是否收到示例字幕。

在 Linux x64 运行 `npm run dist:linux`，会在 `release/` 生成 AppImage 和 Debian 安装包。在 Ubuntu 或 Debian 上，可以用 `sudo apt install ./release/typesub_<版本>_amd64.deb` 安装，把 `<版本>` 替换为实际版本号。安装包会为限制非特权用户命名空间的系统配置 Electron 沙箱。

使用 AppImage 时，先用 `chmod +x` 添加执行权限，再以普通用户启动。如果系统无法使用 FUSE，可以加上 `--appimage-extract-and-run` 启动。安装语音模型需要支持 bzip2 的 `tar`。如果 Ubuntu 启动 AppImage 时报告 Chromium 沙箱错误，请使用 Debian 安装包。

Windows x64 可运行 `npm run dist:windows`，生成 NSIS 安装包和便携版。macOS 可运行 `npm run dist` 生成 DMG。每个本机打包命令都会针对当前系统编译 Rust 引擎。

### 选用 AI 字幕优化

在「AI 优化」填写 API Key 和模型名称，可填写兼容 Chat Completions 的 API Base URL。Base URL 留空时使用默认端点。TypeSub 先显示辨识原文，断句后将文字送去校对。API 未配置、出错或超过 2 秒时，原文会保留。请选择低延迟模型。对于有对应参数的服务，TypeSub 会关闭推理或设为较低档位。

开发时修改主进程后，请从托盘完全退出旧进程，再运行 `npm run dev`。

运行应用和 Rust 引擎测试：

```powershell
npm run test:engine
npm run test:app
```

## 许可证

MIT，见 [LICENSE](LICENSE)。

如遇问题，请提交 Issue 或联系邮箱：contact@tpdsite.com
