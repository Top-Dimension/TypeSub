# TypeSub

[英文](README.md) | 中文

> 软件正在开发初期

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Desktop](https://img.shields.io/badge/desktop-Electron-47848F)
![Engine](https://img.shields.io/badge/engine-Rust-DEA584)
![Migration](https://img.shields.io/badge/Rust%20migration-in%20progress-yellow)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

TypeSub 是给直播用的打字字幕软件：说话时让字幕一个字一个字地出现，还能把拼音放在汉字上面。

## 能玩什么

- 点工作台里的「试一试」，看 Rust 引擎驱动的逐字字幕。标点会稍作停顿，进度落后时会追赶，文本改写时也能保留没变的部分。
- 横排、竖排都能选，再搭配左起、居中、右起；拼音、声调、字体、颜色、描边、背景和打字间隔也能随手调。
- 懒得从头调的话，直接用游戏娱乐、语音房或教学竖排预设。设置会自动保存，下次打开接着用。
- 关掉主窗口会留在系统托盘；配置和日志可以从诊断页打开，诊断信息也能导出。

## 跑起来

准备一台电脑，装好 Node.js、npm 和 Rust 的 MSVC 工具链，然后在项目目录执行：

```powershell
npm install
npm start
```

`npm start` 会先编译 Rust 引擎，再打开 Electron 桌面窗口。首次进入可以跳过组件引导，直接在工作台点「试一试」看效果。

仓库的 `camera-filter/prebuilt/` 已包含 x64 虚拟摄像头 DLL 及其 SHA-256 校验文件，不需要提交上游源码 ZIP。首次在组件页点击「安装组件」时，会校验滤镜并通过独立 Rust 助手在这台电脑上请求 Windows UAC 注册；日常启动无需管理员权限。TypeSub 自己绘制字幕画面并发送到 `TypeSub Virtual Camera`，OBS 等直播软件仅作为接收端。该滤镜目前未进行 Authenticode 签名，且动态字幕在直播软件中的端到端验证尚未完成。ASR 麦克风识别组件仍未接入，工作台的「试一试」目前只演示打字动画。

克隆仓库运行需要 Node.js 和 Rust；仅在主动执行 `npm run build:camera` 重编译滤镜时才需要 Visual Studio 2022 C++ Build Tools（MSVC v143）。该命令会更新预编译 DLL 和校验文件，两者应一起提交。打包好的安装版和绿色版在目标电脑上不需要 Rust 或 MSVC。修改主进程后，需要从托盘菜单完全退出旧进程再重新运行 `npm run dev`。

要跑引擎测试或打包安装器、绿色版：

```powershell
npm run test:engine
npm run dist
```

## 许可证

MIT，见 [LICENSE](LICENSE)。

如遇问题，请提交 Issue 或联系邮箱：contact@tpdsite.com
