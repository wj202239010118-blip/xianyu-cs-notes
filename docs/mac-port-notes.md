# Windows Electron 客户端 → macOS 移植实操

把一个 Windows 版 Electron 桌面客户端搬到 macOS（Apple Silicon）的完整踩坑记录。
**只谈平台差异，不涉及任何业务逻辑改动。**

## 1. 先判断值不值得

在动手前先确认三件事，任何一条不成立就别折腾：

| 检查 | 方法 | 不成立意味着 |
|---|---|---|
| 是 Electron 应用吗 | 安装目录里有 `resources/app.asar` | 若不是，属另一套工程量 |
| 有几个原生模块 | `find app.asar.unpacked -name '*.node'` | 每个原生模块都要找对应平台预编译包 |
| 主进程有没有强 Windows 依赖 | 搜 `win32`、注册表、`PowerShell`、`taskkill` | 依赖重的要做降级分支 |

## 2. 四个硬障碍

### ① asar 里的 UNPACKED 占位文件

Electron 打包时，原生二进制等文件放在 `app.asar.unpacked/`，asar 内部只留一条 `"unpacked": true` 的元数据。**用普通 asar 解包器解出来是一堆 `*.UNPACKED` 占位文件**，不是真内容。

如果你打算**改成目录形式**（`Resources/app/` 代替 `app.asar`，便于调试），必须手工把 `app.asar.unpacked/node_modules/**` 合并回 `node_modules`，否则启动就报：

```
Error: Cannot find module 'detect-libc'
```

（`detect-libc` 是 `sharp` 的依赖，它恰好被标了 unpacked。）

### ② 原生模块要换平台包

以 `sharp` 为例，Windows 包是 `@img/sharp-win32-x64`，macOS 要换成两个包：

```
@img/sharp-darwin-arm64@0.34.5          → lib/sharp-darwin-arm64.node
@img/sharp-libvips-darwin-arm64@1.2.4   → lib/libvips-cpp.*.dylib
```

**版本必须与 `sharp` 主包一致**（`npm pack` 出来能对上）。少一个 libvips 就会在运行时报 `Could not load the "sharp" module`。

### ③ Electron 主版本必须完全一致

内置的 `node:sqlite`、`safeStorage` 行为随大版本变化。从 Windows 包里的 Chrome/Electron 版本字符串确认，然后下同版本 darwin-arm64：

```
https://registry.npmmirror.com/-/binary/electron/v<版本>/electron-v<版本>-darwin-arm64.zip
```

### ④ `.app` 默认丢弃 stderr

macOS 上双击启动的 app 拿不到 stdout/stderr，主进程一崩就是「进程在跑但没窗口、没日志」。

解法：把 `Contents/MacOS/<可执行名>` 换成一个 shell 启动器，真实二进制改名：

```sh
#!/bin/sh
LOG="$HOME/Library/Logs/<app>-launch.log"
mkdir -p "$(dirname "$LOG")"
printf '\n==== launch %s ====\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"
exec "$(dirname "$0")/<可执行名>-bin" --enable-logging >> "$LOG" 2>&1
```

再在主进程入口挂三行诊断，把启动阶段写文件：

```js
const fs = require('fs');
const log = (m) => { try { fs.appendFileSync('/tmp/app-main.log', `${new Date().toISOString()} ${m}\n`); } catch {} };
log('main.js start');
process.on('uncaughtException', (e) => log('UNCAUGHT ' + (e && e.stack || e)));
process.on('unhandledRejection', (e) => log('UNHANDLED ' + (e && e.stack || e)));
```

**这两步能把「黑屏无日志」变成可排查的失败。**

## 3. 签名与系统权限

本地自用用 adhoc 签名即可：

```bash
xattr -cr "App.app"
codesign --force --deep --sign - "App.app"
codesign --verify --deep --strict "App.app"
```

**但要知道 adhoc 的代价**：签名标识里没有 TeamIdentifier，macOS 只能靠 cdhash 认这个 app。**每次改代码重新签名，cdhash 就变，之前授予的「屏幕录制」等权限会失效**，需要重新授权。

要一劳永逸，用固定的自签证书签名（钥匙串里建一次），TCC 才会按 BundleID + TeamID 识别。

## 4. Info.plist 三件事

```bash
/usr/libexec/PlistBuddy -c 'Set :CFBundleExecutable <名>' Info.plist
/usr/libexec/PlistBuddy -c 'Set :CFBundleName <名>' Info.plist
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.example.app' Info.plist
```

如果应用调了 `app.setAsDefaultProtocolClient(scheme)`，还要补 `CFBundleURLTypes`，否则协议回调断。

## 5. 验收清单

- [ ] 应用能启动，主窗口出现
- [ ] 托盘图标出现（mac 走菜单，win 的左键绑定不生效属正常）
- [ ] 内置浏览器能打开目标站点
- [ ] 原生模块不报错（涉及图片处理的走一遍）
- [ ] 日志文件有新内容（说明启动器生效）
- [ ] `codesign --verify --deep --strict` 通过
