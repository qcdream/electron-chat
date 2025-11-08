import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// ===== Messenger 发送拦截与翻译 =====
function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

function buildBilingual(original: string, translated: string): string {
  // 采用双语分行显示，保证 Messenger 气泡能够正确换行
  return `ZH: ${original}\nEN: ${translated}`
}

async function translateToEnglish(text: string): Promise<string> {
  const result = await ipcRenderer.invoke('translate', { text, to: 'en' })
  if (result?.ok && result?.text) return result.text
  return text // 失败时回退为原文
}

function setComposerText(el: HTMLElement, text: string) {
  el.focus()
  // 精确选中该输入框内容，避免跨区域 selectAll
  const sel = window.getSelection()
  const range = document.createRange()
  try {
    range.selectNodeContents(el)
    sel?.removeAllRanges()
    sel?.addRange(range)
  } catch (_) {}
  // 使用 insertText 触发前端框架的输入事件
  const ok = document.execCommand('insertText', false, text)
  if (!ok) {
    ;(el as any).innerText = text
    el.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }
}

function triggerSend(el: HTMLElement) {
  // 首选点击 backdrop 以符合你提供的发送方式
  const backdrop = findBackdropNear(el) || (document.querySelector('div.backdrop') as HTMLElement | null)
  if (backdrop && isElementVisible(backdrop)) {
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return
  }
  // 兜底：派发 Enter 事件
  const kd = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
  const kp = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true })
  const ku = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })
  el.dispatchEvent(kd)
  el.dispatchEvent(kp)
  el.dispatchEvent(ku)
}

function findBackdropNear(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el
  for (let i = 0; i < 5 && cur; i++) {
    const found = cur.querySelector?.('div.backdrop') as HTMLElement | null
    if (found) return found
    cur = cur.parentElement
  }
  return null
}

function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.height > 0 && rect.width > 0
}

function findComposer(): HTMLElement | null {
  // 优先使用你提供的 ID 选择器
  const byId = document.getElementById('editable-message-text') as HTMLElement | null
  if (byId && isElementVisible(byId)) return byId
  // 兜底：兼容旧的结构
  const candidates = [
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]'
  ]
  for (const sel of candidates) {
    const el = document.querySelector(sel) as HTMLElement | null
    if (el && isElementVisible(el)) return el
  }
  return null
}

function attachInterceptor(): void {
  const ensureComposer = () => {
    const composer = findComposer()
    if (!composer) return false
    // 防止重复绑定
    if ((composer as any)._bilingualHooked) return true
    ;(composer as any)._bilingualHooked = true

    composer.addEventListener(
      'keydown',
      async (ev: KeyboardEvent) => {
        // 忽略我们程序派发的合成事件，避免递归触发
        if (!ev.isTrusted) return
        if (ev.key !== 'Enter' || ev.shiftKey) return
        // 拦截原生发送
        ev.preventDefault()
        ev.stopPropagation()
        const text = (composer as any).innerText?.trim() || ''
        if (!text) return

        let final = text
        if (containsChinese(text)) {
          try {
            const en = await translateToEnglish(text)
            final = buildBilingual(text, en)
          } catch (_) {
            final = text
          }
        }

        setComposerText(composer, final)
        // 触发发送
        triggerSend(composer)
      },
      true
    )
    return true
  }

  // 初始尝试与动态变化监听
  if (!ensureComposer()) {
    const mo = new MutationObserver(() => ensureComposer())
    mo.observe(document.documentElement, { childList: true, subtree: true })
  }

  /*
    翻译后的文本样式处理
    样式优化：保证消息能按行显示并略微增大行高
  */ 
  const style = document.createElement('style')
  style.textContent = `
    #editable-message-text { white-space: pre-wrap; }
    div[role="textbox"][contenteditable="true"] { white-space: pre-wrap; }
    span, p { white-space: pre-wrap; line-height: 1.35; }
  `
  document.head.appendChild(style)
}

// Custom APIs exposed to renderer (optional proxy & translate)
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
    // 自动挂载拦截器
    window.addEventListener('DOMContentLoaded', () => {
      try {
        attachInterceptor()
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
  attachInterceptor()
}