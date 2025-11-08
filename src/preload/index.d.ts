import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      setProxy: (proxy: string) => Promise<{ ok: boolean; error?: string }>
      translate: (text: string, to?: string) => Promise<{ ok: boolean; text?: string; error?: string }>
    }
  }
}
