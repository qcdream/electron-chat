import { ipcMain, session } from 'electron'

// 将主进程的 IPC 处理集中在此模块
export function setupIpcHandlers(): void {
  // IPC：翻译文本（使用 Google 公开接口）
  ipcMain.handle('translate', async (_event, payload: { text: string; to?: string }) => {
    console.log('translate======000')
    try {
      const to = payload?.to || 'en'
      const q = payload?.text || ''
      if (!q.trim()) return { ok: true, text: q }

      const url =
        'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
        encodeURIComponent(to) +
        '&dt=t&q=' +
        encodeURIComponent(q)

      const res = await fetch(url)
      const data = await res.json()
      const translated = Array.isArray(data) && Array.isArray(data[0])
        ? data[0].map((seg: any) => (Array.isArray(seg) ? seg[0] : '')).join('')
        : ''
      return { ok: true, text: translated }
    } catch (err) {
      console.warn('Translate failed:', err)
      return { ok: false, error: String(err) }
    }
  })

  // IPC：设置代理
  ipcMain.handle('set-proxy', async (_event, proxy: string) => {
    try {
      await session.defaultSession.setProxy({ proxyRules: proxy })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}