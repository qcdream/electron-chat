import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { setupIpcHandlers } from './ipc'

async function createWindow(): Promise<void> {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 设置可选代理（读取环境变量）
  const proxyRules = process.env.ELECTRON_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY
  if (proxyRules) {
    try {
      // 让 Chromium 整体走代理（兜底方案）
      app.commandLine.appendSwitch('proxy-server', proxyRules)
      // 同步设置默认会话代理，且在加载 URL 前等待完成，避免竞争条件
      await session.defaultSession.setProxy({ proxyRules })
      console.log('Proxy applied:', proxyRules)
    } catch (err) {
      console.warn('Set proxy failed:', err)
    }
  }

  // 加载 Messenger 页面
  mainWindow.loadURL('https://webogram.org/')

  // 开启开发者工具（调试用）
  if (is.dev) {
    // mainWindow.webContents.openDevTools({ mode: 'undocked' })
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 允许 Messenger 在登录或打开会话时弹出新窗口
  mainWindow.webContents.setWindowOpenHandler((_details) => {
    return { action: 'allow' }
  })

  // 开发期容错：若 Messenger 加载失败，回退到本地渲染页，避免空白窗口
  let proxyResetAttempted = false
  mainWindow.webContents.on('did-fail-load', async (_event, errorCode, errorDesc, validatedURL) => {
    console.warn('Failed to load URL:', validatedURL, errorCode, errorDesc)
    // 如果是代理问题，尝试关闭代理并重试加载 Messenger
    if (!proxyResetAttempted && errorCode === -130 /* ERR_PROXY_CONNECTION_FAILED */) {
      proxyResetAttempted = true
      try {
        await session.defaultSession.setProxy({ proxyRules: 'direct://' })
        console.log('Proxy disabled. Retrying webogram...')
        mainWindow.loadURL('https://webogram.org/')
        return
      } catch (e) {
        console.warn('Disable proxy failed:', e)
      }
    }

    // 开发期容错：若 Messenger 加载失败，回退到本地渲染页，避免空白窗口
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  })

  // 默认使用 Messenger；必要时通过 did-fail-load 事件回退到本地页面
}


app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 注册独立模块的 IPC 处理
  setupIpcHandlers()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

