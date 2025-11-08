import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { containsChinese, translateToEnglish, attachInterceptor } from './utils'

// ===== Messenger 发送拦截与翻译 =====
// 预取与发送时限配置：
// - PREFETCH_DEBOUNCE_MS：输入时预取的防抖时间（毫秒），避免高频请求；
// - SEND_WAIT_MS：发送时等待预取/即时翻译的最长时间（毫秒），超时则回退。
const PREFETCH_DEBOUNCE_MS = 150
const SEND_WAIT_MS = 500
const translateCache = new Map<string, string>()
let prefetchTimer: number | null = null
let lastPrefetchText = ''
let lastPrefetchPromise: Promise<string> | null = null

/**
 * 输入时预取中文文本的英文译文：
 * - 防抖触发，减少频繁翻译请求；
 * - 结果写入缓存以供发送时快速命中；
 * - 失败时静默处理，发送时再兜底。
 * @param text 当前输入文本
 */
function schedulePrefetch(text: string) {
  if (!text || !containsChinese(text)) return
  if (translateCache.has(text)) return
  if (prefetchTimer) {
    clearTimeout(prefetchTimer)
    prefetchTimer = null
  }
  prefetchTimer = setTimeout(() => {
    lastPrefetchText = text
    lastPrefetchPromise = translateToEnglish(text)
      .then((en) => {
        translateCache.set(text, en)
        return en
      })
      .catch(() => {
        // 忽略预取失败，发送时再兜底
        return text
      })
  }, PREFETCH_DEBOUNCE_MS) as unknown as number
}




// Custom APIs exposed to renderer (optional proxy & translate)
// 暴露到渲染进程的自定义 API：
// - setProxy：设置网络代理（主进程处理）；
// - translate：调用翻译服务（主进程处理）。
const api = {
  setProxy: (proxy: string) => ipcRenderer.invoke('set-proxy', proxy),
  translate: (text: string, to = 'en') => ipcRenderer.invoke('translate', { text, to })
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    // 自动挂载拦截器：等待 DOMContentLoaded 后安装，确保输入框已渲染
    window.addEventListener('DOMContentLoaded', () => {
      try {
        attachInterceptor({
          schedulePrefetch,
          translateCache,
          getLastPrefetchText: () => lastPrefetchText,
          getLastPrefetchPromise: () => lastPrefetchPromise,
          sendWaitMs: SEND_WAIT_MS
        })
      } catch (err) {
        console.warn('attachInterceptor failed:', err)
      }
    })
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  attachInterceptor({
    schedulePrefetch,
    translateCache,
    getLastPrefetchText: () => lastPrefetchText,
    getLastPrefetchPromise: () => lastPrefetchPromise,
    sendWaitMs: SEND_WAIT_MS
  })
}