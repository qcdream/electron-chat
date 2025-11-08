import { ipcRenderer } from 'electron'

/**
 * 检测字符串中是否包含中文字符。
 * @param text 要检测的文本
 * @returns 是否包含中文
 */
export function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

/**
 * 以双语格式拼接原文与译文，每行一个语言
 * @param original 原文（中文）
 * @param translated 译文（英文）
 * @returns 双语文本：`ZH: ...\nEN: ...`
 */
export function buildBilingual(original: string, translated: string): string {
  return `ZH: ${original}\nEN: ${translated}`
}

/**
 * 将中文文本翻译成英文，使用主进程的 IPC 翻译服务
 * 失败时返回原文，保证发送不阻塞
 * @param text 待翻译文本
 * @returns 英文译文或原文
 */
export async function translateToEnglish(text: string): Promise<string> {
  const result = await ipcRenderer.invoke('translate', { text, to: 'en' })
  if (result?.ok && result?.text) return result.text
  return text
}

/**
 * 为一个 Promise 添加超时控制，超时后以异常拒绝。
 * @param p 原始 Promise
 * @param ms 超时毫秒数
 * @returns 包装后的 Promise
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => {
      clearTimeout(timer)
      resolve(v)
    }).catch((e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

/**
 * 回填输入框：将文本写入消息输入框并触发输入事件 
 * @param el 输入框元素（contenteditable 区域）
 * @param text 要写入的文本
 */
export function setComposerText(el: HTMLElement, text: string) {
  el.focus()
  const sel = window.getSelection()
  const range = document.createRange()
  try {
    range.selectNodeContents(el)
    sel?.removeAllRanges()
    sel?.addRange(range)
  } catch {}
  const ok = document.execCommand('insertText', false, text)
  if (!ok) {
    ;(el as any).innerText = text
    el.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }
}

/**
 * 在元素附近查找发送按钮的 backdrop（自定义点击区域）。
 * @param el 参考元素（通常为输入框）
 * @returns 找到的 backdrop 元素或 null
 */
export function findBackdropNear(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el
  for (let i = 0; i < 5 && cur; i++) {
    const found = cur.querySelector?.('div.backdrop') as HTMLElement | null
    if (found) return found
    cur = cur.parentElement
  }
  return null
}

/**
 * 判断元素是否可见（未隐藏且有尺寸）。
 * @param el 目标元素
 * @returns 是否可见
 */
export function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.height > 0 && rect.width > 0
}

/**
 * 在元素附近查找 aria-label 为 "Send Message" 的发送按钮。
 * 先在就近节点中查找，找不到则在全局查找。
 * @param el 参考元素（通常为输入框）
 */
export function findSendButtonNear(el: HTMLElement): HTMLButtonElement | null {
  let cur: HTMLElement | null = el
  for (let i = 0; i < 5 && cur; i++) {
    const btn = cur.querySelector?.('button[aria-label="Send Message"]') as HTMLButtonElement | null
    if (btn) return btn
    cur = cur.parentElement
  }
  return document.querySelector('button[aria-label="Send Message"]') as HTMLButtonElement | null
}

/**
 * 执行消息发送：优先点击 aria-label="Send Message" 的按钮；
 * 若不可用则点击 backdrop；都不可用时模拟按下回车键
 * @param el 输入框元素
 */
export function triggerSend(el: HTMLElement) {
  const sendBtn = findSendButtonNear(el)
  if (sendBtn && isElementVisible(sendBtn)) {
    sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return
  }
  const backdrop = findBackdropNear(el) || (document.querySelector('div.backdrop') as HTMLElement | null)
  if (backdrop && isElementVisible(backdrop)) {
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return
  }
  const kd = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
  const kp = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true })
  const ku = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })
  el.dispatchEvent(kd)
  el.dispatchEvent(kp)
  el.dispatchEvent(ku)
}

/**
 * 查找当前有效的消息输入框，优先使用固定 ID，其次使用通用选择器。
 * @returns 输入框元素或 null
 */
export function findComposer(): HTMLElement | null {
  const byId = document.getElementById('editable-message-text') as HTMLElement | null
  if (byId && isElementVisible(byId)) return byId
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

/**
 * 安装输入拦截器：
 * - 输入时预取翻译以减少发送等待；
 * - 按 Enter 拦截并构建双语消息后发送；
 * - 监听 DOM 变化以在输入框出现时自动绑定；
 * - 注入样式以保证双语文本的换行与行高。
 * 通过依赖注入复用调用方的预取状态与时限配置。
 * @param deps 依赖项（预取调度、缓存、最近预取状态、发送等待时长）
 */
export function attachInterceptor(deps: {
  schedulePrefetch: (text: string) => void
  translateCache: Map<string, string>
  getLastPrefetchText: () => string
  getLastPrefetchPromise: () => Promise<string> | null
  sendWaitMs: number
}): void {
  const { schedulePrefetch, translateCache, getLastPrefetchText, getLastPrefetchPromise, sendWaitMs } = deps

  const ensureComposer = () => {
    const composer = findComposer()
    if (!composer) return false
    if ((composer as any)._bilingualHooked) return true
    ;(composer as any)._bilingualHooked = true

    composer.addEventListener('input', () => {
      const text = (composer as any).innerText?.trim() || ''
      if (!text) return
      schedulePrefetch(text)
    })

    // 拦截输入框回车
    composer.addEventListener(
      'keydown',
      async (ev: KeyboardEvent) => {
        // 监听回车，拦截发送
        if (!ev.isTrusted) return
        if (ev.key !== 'Enter' || ev.shiftKey) return
        ev.preventDefault()
        ev.stopPropagation()
        const text = (composer as any).innerText?.trim() || ''
        if (!text) return

        let final = text
        // 输入内容包含中文  执行翻译
        if (containsChinese(text)) {
          try {
            let en: string | undefined = translateCache.get(text)
            if (!en) {
              const lastText = getLastPrefetchText()
              const lastPromise = getLastPrefetchPromise()
              if (lastText === text && lastPromise) {
                // 设置超时
                try {
                  en = await withTimeout(lastPromise, sendWaitMs)
                } catch {}
              }
            }
            if (!en) {
              en = await withTimeout(translateToEnglish(text), sendWaitMs)
              translateCache.set(text, en)
            }
            final = buildBilingual(text, en)
          } catch {
            final = buildBilingual(text, text)
          }
        }

        setComposerText(composer, final)
        triggerSend(composer)
      },
      true
    )

    // 捕获按钮点击（aria-label="Send Message"），实现与回车一致的拦截与翻译
    if (!(document as any)._sendMessageClickHooked) {
      ;(document as any)._sendMessageClickHooked = true
      document.addEventListener(
        'click',
        async (ev: MouseEvent) => {
          if (!ev.isTrusted) return
          const target = ev.target as HTMLElement | null
          const btn = target?.closest('button[aria-label="Send Message"]') as HTMLButtonElement | null
          if (!btn) return

          const composerNow = findComposer()
          if (!composerNow) return

          // 阻止站点默认发送，先翻译再触发发送
          ev.preventDefault()
          ev.stopPropagation()

          const text = (composerNow as any).innerText?.trim() || ''
          if (!text) {
            // 空文本直接用键盘事件交给站点处理
            const kd = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
            const kp = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true })
            const ku = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })
            composerNow.dispatchEvent(kd)
            composerNow.dispatchEvent(kp)
            composerNow.dispatchEvent(ku)
            return
          }

          let final = text
          if (containsChinese(text)) {
            try {
              let en: string | undefined = translateCache.get(text)
              if (!en) {
                const lastText = getLastPrefetchText()
                const lastPromise = getLastPrefetchPromise()
                if (lastText === text && lastPromise) {
                  try {
                    en = await withTimeout(lastPromise, sendWaitMs)
                  } catch {}
                }
              }
              if (!en) {
                en = await withTimeout(translateToEnglish(text), sendWaitMs)
                translateCache.set(text, en)
              }
              final = buildBilingual(text, en)
            } catch {
              final = buildBilingual(text, text)
            }
          }

          setComposerText(composerNow, final)
          // 用非可信键盘事件触发发送，避免再次进入我们的 keydown 拦截
          const kd = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
          const kp = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true })
          const ku = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })
          composerNow.dispatchEvent(kd)
          composerNow.dispatchEvent(kp)
          composerNow.dispatchEvent(ku)
        },
        true
      )
    }
    return true
  }

  if (!ensureComposer()) {
    const mo = new MutationObserver(() => ensureComposer())
    mo.observe(document.documentElement, { childList: true, subtree: true })
  }

  const style = document.createElement('style')
  style.textContent = `
    #editable-message-text { white-space: pre-wrap; }
    div[role="textbox"][contenteditable="true"] { white-space: pre-wrap; }
    span, p { white-space: pre-wrap; line-height: 1.35; }
  `
  document.head.appendChild(style)
}