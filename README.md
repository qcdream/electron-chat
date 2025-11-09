# electron-chat

一个基于 Electron 的聊天应用封装，内置本地轻量翻译（Transformers.js，MarianMT zh↔en）。输入中文时，默认拦截发送并自动以“两条消息”形式发出：先原文，再英文译文；翻译失败则仅发送原文。

## 特性
- 本地翻译，无需外部翻译 API：`Xenova/opus-mt-zh-en` 与 `Xenova/opus-mt-en-zh`
- 默认使用国内镜像下载模型：`https://hf-mirror.com`
- 模型缓存到用户数据目录：`%APPDATA%\electron-chat\models`
- 输入预取与超时限制：输入时预取，发送最多等待 500ms

## 快速开始
### 安装与启动
pnpm i
pnpm dev

应用默认加载 Telegram Web（`src/main/index.ts` 的 `mainWindow.loadURL` 可自行替换）。

### 代理配置（重要）
首次翻译需要下载模型文件，主进程使用 Node 的网络栈，不会自动继承 Chromium 的代理。请显式设置带协议的代理地址：

Windows PowerShell 示例（HTTP 代理）：
```
$env:ELECTRON_PROXY='http://127.0.0.1:7897'; pnpm dev
```
SOCKS5 代理示例：
```
$env:ELECTRON_PROXY='socks5://127.0.0.1:7897'; pnpm dev
```
也可设置 Node 环境变量：
```
$env:HTTP_PROXY='http://127.0.0.1:7897'
$env:HTTPS_PROXY='http://127.0.0.1:7897'
npm run dev
```
说明：应用会同时为 Chromium 会话与 Node 主进程设置代理（`src/main/index.ts`）。

## 翻译与拦截说明
- 输入框包含中文时：
  - 发送两条消息：先中文原文，随后英文译文（约 200ms 间隔）。
  - 翻译失败时仅发送原文，不阻塞消息发送。
- 非中文输入：按原逻辑发送一条消息。
- 预取与缓存：输入时预取英文译文并缓存，发送时优先命中缓存；超时（默认 500ms）则回退。

渲染进程可直接调用主进程翻译服务：
```
// 英译中：
window.api.translate('Hello', 'zh').then(console.log)
// 中译英：
window.api.translate('你好', 'en').then(console.log)
```

## 模型缓存与镜像
- 缓存目录：`%APPDATA%\electron-chat\models`（Electron `app.getPath('userData')/models`）。
- 默认镜像：`hf-mirror.com`（在 `src/main/ipc.ts` 中通过 `env.remoteHost` 配置）。
- 若缓存损坏，主进程会尝试校验并清理后重试加载。

## 离线下载模型
你可以提前离线下载模型并复制到缓存目录，避免运行时下载：
```
node download-models.js --proxy
```
脚本会把模型下载到本项目的 `models/` 目录。完成后：
1. 将整个 `models` 文件夹复制到 `%APPDATA%\electron-chat\` 目录下（最终路径形如 `%APPDATA%\electron-chat\models\Xenova/opus-mt-zh-en`）。
2. 重新启动应用：`pnpm dev`

提示：`--proxy` 会使用 `HTTP_PROXY/HTTPS_PROXY` 或默认 `http://127.0.0.1:7897` 进行下载；请按需设置协议与端口。

## 清理模型缓存
模型文件损坏或过期时可清理缓存后重试：
- 手动删除：移除 `%APPDATA%\electron-chat\models\Xenova` 下对应模型文件夹。
- 或在主进程通过 IPC 调用：`ipcMain.handle('clear-model-cache', ...)`（可按需为 UI 暴露入口）。

## 常见问题
- Translate failed: TypeError: fetch failed / ConnectTimeoutError
  - 原因：主进程下载模型超时或无法连接镜像。
  - 解决：设置带协议的代理（例如 `http://127.0.0.1:7897` 或 `socks5://127.0.0.1:7897`），或使用离线模型。
- 首次翻译很慢
  - 原因：需要首次下载并缓存模型。
  - 解决：等待下载完成或提前离线下载并复制到缓存目录。


## 结构与入口
- 主进程：`src/main/index.ts`（窗口创建、代理设置、页面加载）、`src/main/ipc.ts`（翻译与缓存相关逻辑）
- 预加载与拦截：`src/preload/index.ts`（暴露 API、安装输入拦截）、`src/preload/utils.ts`（拦截与两条消息发送）
- 离线模型脚本：`download-models.js`



