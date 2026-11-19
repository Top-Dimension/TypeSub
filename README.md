# TypeSub

English | [Chinese](README.zh-CN.md)

> This software is in early development.The software is in the early stages of development; the version downloaded below is the pre-release version.

[![Download for Windows](https://img.shields.io/badge/Download-Windows_x64-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/Top-Dimension/TypeSub/releases/download/0.1.2/TypeSub-Setup-0.1.2-x64.exe)
![Version](https://img.shields.io/badge/version-0.1.2-blue)
![Desktop](https://img.shields.io/badge/desktop-Electron-47848F)
![Engine](https://img.shields.io/badge/engine-Rust-DEA584)
![Migration](https://img.shields.io/badge/Rust%20migration-in%20progress-yellow)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

TypeSub recognizes speech from your microphone and displays live captions one character at a time in an OBS Browser Source.

## Features

- Click "Try it" in the workspace to preview captions driven by the Rust engine. Punctuation adds a brief pause, the animation catches up when it falls behind, and text revisions preserve unchanged parts.
- Choose horizontal or vertical layout with left, center, or right alignment. Adjust pinyin, tones, fonts, colors, outlines, backgrounds, and typing intervals.
- Start with a gaming/entertainment, voice-room, or vertical teaching preset. Settings are saved automatically for the next launch.
- Closing the main window keeps the app in the system tray. Open configuration and logs from the diagnostics page, or export diagnostic information.

## Getting started

To run from source, install Node.js, npm, and Rust. Windows builds use the Rust MSVC toolchain.

```powershell
npm install
npm start
```

`npm start` builds the Rust engine and opens the Electron app. Keep TypeSub running on the same PC as OBS. Copy the URL from the workspace, add a **Browser** source in OBS, and paste the URL into the source properties. Set the source's **Width** and **Height** to the area you want to use. Captions reflow to the source dimensions and advance by complete lines or columns as they fill the available space.

Click **Download model (134 MB)** on first launch or under Input. The app downloads and verifies a Zipformer model for Mandarin and English. Choose a microphone under **Input → Microphone** and click **Start recognition** to transcribe offline. Pause recognition to switch devices, and click **Refresh devices** if your microphone is missing from the list. Click **Try it** to check the overlay with sample text before downloading.

On Linux, model installation requires `tar` with bzip2 support. To build distributables, run `npm run dist:setup` on Windows x64 for the installer, or `npm run dist` on the target platform for macOS DMG or Linux AppImage.

### Optional AI correction

Under **AI 优化** (AI correction), enter an API key and model name. Leave Base URL empty to use the default endpoint, or enter a service that supports Chat Completions. TypeSub displays the raw recognition result immediately and sends the final text of each utterance for correction. The raw subtitle stays visible if the API is unconfigured, fails, or takes longer than two seconds. Choose a fast model with little or no reasoning. TypeSub disables or reduces reasoning where it knows how to configure the provider.

After changing the main process in development, quit the old process from the tray before running `npm run dev`.

To run the application and Rust engine tests:

```powershell
npm run test:engine
npm run test:app
```

## License

MIT. See [LICENSE](LICENSE).

If you encounter a problem, please open an issue or contact: contact@tpdsite.com
