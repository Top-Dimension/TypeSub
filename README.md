# TypeSub

English | [Chinese](README.zh-CN.md)

> This software is in early development.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Desktop](https://img.shields.io/badge/desktop-Electron-47848F)
![Engine](https://img.shields.io/badge/engine-Rust-DEA584)
![Migration](https://img.shields.io/badge/Rust%20migration-in%20progress-yellow)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

TypeSub is a typing-style caption app for livestreams. It reveals captions one character at a time as you speak and can show pinyin above Chinese characters.

## Features

- Click "Try it" in the workspace to preview captions driven by the Rust engine. Punctuation adds a brief pause, the animation catches up when it falls behind, and text revisions preserve unchanged parts.
- Choose horizontal or vertical layout with left, center, or right alignment. Adjust pinyin, tones, fonts, colors, outlines, backgrounds, and typing intervals.
- Start with a gaming/entertainment, voice-room, or vertical teaching preset. Settings are saved automatically for the next launch.
- Closing the main window keeps the app in the system tray. Open configuration and logs from the diagnostics page, or export diagnostic information.

## Getting started

On Windows, install Node.js, npm, and the Rust MSVC toolchain. Then run:

```powershell
npm install
npm start
```

`npm start` builds the Rust engine before opening the Electron desktop window. On first launch, you can skip the component setup and click "Try it" in the workspace to preview the animation.

The repository includes the prebuilt x64 virtual camera filter and its SHA-256 checksum in `camera-filter/prebuilt/`. The upstream source ZIP is not needed or committed. The first time you click "Install component" on the components page, a separate Rust helper verifies the filter and requests Windows UAC permission to register it on that computer. Normal launches do not require administrator privileges. TypeSub renders its own caption frames and sends them to `TypeSub Virtual Camera`; OBS and other streaming apps only receive the camera output. The filter is not yet Authenticode-signed, and end-to-end delivery of dynamic captions to streaming software has not yet been verified. Microphone-based ASR is not integrated yet, so "Try it" currently demonstrates only the typing animation.

Cloning the repository requires Node.js and Rust to build and run the app; Visual Studio 2022 C++ Build Tools (MSVC v143) are only needed when intentionally rebuilding the filter with `npm run build:camera`. That command refreshes the checked-in prebuilt DLL and checksum; commit both together. The packaged installer and portable app do not require Rust or MSVC on the destination computer. After changing the main process, fully quit the old process from the tray menu before running `npm run dev` again.

To run engine tests or build the installer and portable release:

```powershell
npm run test:engine
npm run dist
```

## License

MIT. See [LICENSE](LICENSE).

If you encounter a problem, please open an issue or contact: contact@tpdsite.com
