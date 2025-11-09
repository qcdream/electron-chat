import { ipcMain, session, app } from 'electron'
import { pipeline, env } from '@huggingface/transformers'
import { join } from 'path'
import * as fs from 'fs'

// 将主进程的 IPC 处理集中在此模块
export function setupIpcHandlers(): void {
  // Transformers.js：禁用浏览器缓存，使用本地文件缓存
  env.useBrowserCache = false
  env.allowRemoteModels = true
  env.allowLocalModels = true

  // 设置本地缓存目录到 Electron 用户数据目录
  const cacheDir = join(app.getPath('userData'), 'models')
  env.cacheDir = cacheDir

  // 配置 HuggingFace 镜像源（使用国内镜像加速）
  env.remoteHost = 'https://hf-mirror.com'
  env.remotePathTemplate = '{model}/resolve/{revision}/'

  console.log('Transformers.js cache directory:', cacheDir)
  console.log('Transformers.js remote host:', env.remoteHost)

  // 清理可能损坏的缓存文件
  function clearModelCache(modelName: string) {
    try {
      const modelPath = join(cacheDir, modelName)
      if (fs.existsSync(modelPath)) {
        console.log(`[Cache] Clearing cache for: ${modelName}`)
        fs.rmSync(modelPath, { recursive: true, force: true })
        console.log(`[Cache] Cache cleared successfully`)
        return true
      }
      return false
    } catch (err) {
      console.warn(`[Cache] Failed to clear cache:`, err)
      return false
    }
  }

  // 验证模型文件完整性
  function validateModelCache(modelName: string): boolean {
    try {
      const modelPath = join(cacheDir, modelName)
      if (!fs.existsSync(modelPath)) {
        return false
      }

      // 检查关键文件是否存在且非空
      const criticalFiles = ['config.json', 'tokenizer.json']
      for (const file of criticalFiles) {
        const filePath = join(modelPath, file)
        if (!fs.existsSync(filePath)) {
          console.warn(`[Validation] Missing file: ${file}`)
          return false
        }
        const stat = fs.statSync(filePath)
        if (stat.size === 0) {
          console.warn(`[Validation] Empty file: ${file}`)
          return false
        }
        // 尝试读取并解析 JSON 文件
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          JSON.parse(content)
        } catch (err) {
          console.warn(`[Validation] Invalid JSON in ${file}:`, err)
          return false
        }
      }

      console.log(`[Validation] Model cache validated: ${modelName}`)
      return true
    } catch (err) {
      console.warn(`[Validation] Failed to validate cache:`, err)
      return false
    }
  }

  // 轻量本地翻译：使用 Transformers.js（MarianMT zh→en / en→zh）
  // 懒加载并缓存翻译管线，默认使用 4-bit 量化以降低延迟和内存。
  let zhEnPipePromise: Promise<any> | null = null
  let enZhPipePromise: Promise<any> | null = null

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function getZhEnPipe() {
    if (!zhEnPipePromise) {
      const modelName = 'Xenova/opus-mt-zh-en'
      console.log('[Pipeline] Loading zh-en translation model...')

      // 验证缓存，如果损坏则清理
      if (!validateModelCache(modelName)) {
        console.log('[Pipeline] Cache validation failed, clearing...')
        clearModelCache(modelName)
      }

      let retryCount = 0
      const maxRetries = 2

      while (retryCount <= maxRetries) {
        try {
          zhEnPipePromise = pipeline('translation', modelName, {
            revision: 'main',
            progress_callback: (progress: any) => {
              if (progress.status === 'progress') {
                // console.log(`[Download] ${progress.file}: ${Math.round(progress.progress || 0)}%`)
              } else if (progress.status === 'done') {
                console.log(`[Download] ${progress.file}: completed`)
              }
            }
          })
          await zhEnPipePromise
          // console.log('[Pipeline] zh-en model loaded successfully')
          break
        } catch (err: any) {
          // console.error(`[Pipeline] Attempt ${retryCount + 1}/${maxRetries + 1} failed:`, err.message)

          if (retryCount < maxRetries) {
            console.log('[Pipeline] Clearing cache and retrying...')
            clearModelCache(modelName)
            zhEnPipePromise = null
            retryCount++
            // 等待 2 秒后重试
            await new Promise(resolve => setTimeout(resolve, 2000))
          } else {
            zhEnPipePromise = null
            throw new Error(`Failed to load model after ${maxRetries + 1} attempts: ${err.message}`)
          }
        }
      }
    }
    return zhEnPipePromise
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function getEnZhPipe() {
    if (!enZhPipePromise) {
      const modelName = 'Xenova/opus-mt-en-zh'
      console.log('[Pipeline] Loading en-zh translation model...')

      // 验证缓存，如果损坏则清理
      if (!validateModelCache(modelName)) {
        console.log('[Pipeline] Cache validation failed, clearing...')
        clearModelCache(modelName)
      }

      let retryCount = 0
      const maxRetries = 2

      while (retryCount <= maxRetries) {
        try {
          enZhPipePromise = pipeline('translation', modelName, {
            revision: 'main',
            progress_callback: (progress: any) => {
              if (progress.status === 'progress') {
                console.log(`[Download] ${progress.file}: ${Math.round(progress.progress || 0)}%`)
              } else if (progress.status === 'done') {
                console.log(`[Download] ${progress.file}: completed`)
              }
            }
          })
          await enZhPipePromise
          console.log('[Pipeline] en-zh model loaded successfully')
          break
        } catch (err: any) {
          console.error(`[Pipeline] Attempt ${retryCount + 1}/${maxRetries + 1} failed:`, err.message)

          if (retryCount < maxRetries) {
            console.log('[Pipeline] Clearing cache and retrying...')
            clearModelCache(modelName)
            enZhPipePromise = null
            retryCount++
            // 等待 2 秒后重试
            await new Promise(resolve => setTimeout(resolve, 2000))
          } else {
            enZhPipePromise = null
            throw new Error(`Failed to load model after ${maxRetries + 1} attempts: ${err.message}`)
          }
        }
      }
    }
    return enZhPipePromise
  }

  ipcMain.handle('translate', async (_event, payload: { text: string; to?: string }) => {
    try {
      const to = (payload?.to || 'en').toLowerCase()
      const q = payload?.text || ''
      if (!q.trim()) return { ok: true, text: q }

      console.log('[Translate] Input:', { text: q, to })

      // 仅中文→英文在当前业务中被使用；同时兼容少量英文→中文请求。
      const pipe = to === 'zh' ? await getEnZhPipe() : await getZhEnPipe()
      console.log('[Translate] Pipeline loaded successfully')

      const out = await pipe(q, {
        top_k: 0,
        do_sample: false,
        num_beams: 1,
        max_length: 512
      })

      console.log('[Translate] Raw output:', JSON.stringify(out, null, 2))

      // 更安全的结果提取
      let translated = ''
      if (out) {
        if (Array.isArray(out) && out.length > 0) {
          // 处理数组形式的输出
          translated = out[0]?.translation_text || out[0]?.generated_text || ''
        } else if (typeof out === 'object') {
          // 处理对象形式的输出
          translated = out.translation_text || out.generated_text || ''
        } else if (typeof out === 'string') {
          // 处理字符串形式的输出
          translated = out
        }
      }

      translated = String(translated).trim()
      console.log('[Translate] Final result:', translated)

      return { ok: true, text: translated || q }
    } catch (err: any) {
      console.error('[Translate] Error:', err)
      console.error('[Translate] Error stack:', err?.stack)
      return { ok: false, error: err?.message || String(err), text: payload?.text || '' }
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

  // IPC：清理模型缓存
  ipcMain.handle('clear-model-cache', async () => {
    try {
      console.log('[Cache] Clearing all model caches...')
      clearModelCache('Xenova/opus-mt-zh-en')
      clearModelCache('Xenova/opus-mt-en-zh')
      // 重置 pipeline promises
      zhEnPipePromise = null
      enZhPipePromise = null
      return { ok: true, message: 'Model cache cleared successfully' }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}
