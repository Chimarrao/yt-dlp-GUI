import { BrowserWindow } from 'electron'

export interface PoTokenResult {
  poToken?: string
  visitorData?: string
}

const cache: Record<string, PoTokenResult> = {}

/**
 * Creates an invisible Electron window and extracts the PO Token + Visitor Data
 * by intercepting the internal YouTube player network request.
 */
export async function generatePoToken(videoId: string): Promise<PoTokenResult> {
  if (!videoId || videoId.length !== 11) {
    throw new Error('Invalid video ID for PO Token generation')
  }

  if (cache[videoId]) return cache[videoId]

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        partition: `persist:potoken_${videoId}`,
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    const isoSession = win.webContents.session

    const timeout = setTimeout(() => {
      cleanup()
      resolve({})
    }, 15000)

    const cleanup = (): void => {
      clearTimeout(timeout)
      if (!win.isDestroyed()) {
        try {
          isoSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (_d, cb) => {
            cb({})
          })
        } catch (e) {
          console.error('Error clearing webRequest interceptor', e)
        }
        win.close()
      }
    }

    isoSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const type = details.resourceType
      if (
        ['image', 'stylesheet', 'font', 'media'].includes(type) ||
        details.url.includes('doubleclick.net') ||
        details.url.includes('googleadservices')
      ) {
        callback({ cancel: true })
        return
      }

      if (details.url.includes('/youtubei/v1/player') && details.method === 'POST') {
        if (details.uploadData && details.uploadData.length > 0) {
          const rawBytes = details.uploadData[0].bytes
          let rawData = ''

          if (rawBytes) {
            const a = rawBytes as unknown as { byteLength?: number; buffer?: ArrayBuffer }
            if (Buffer.isBuffer(rawBytes)) {
              rawData = rawBytes.toString('utf8')
            } else if (a.buffer instanceof ArrayBuffer) {
              rawData = Buffer.from(a.buffer).toString('utf8')
            } else if (a.byteLength) {
              rawData = Buffer.from(rawBytes as unknown as ArrayBuffer).toString('utf8')
            }
          }

          try {
            const json = JSON.parse(rawData) as Record<string, unknown>
            const sid = json?.serviceIntegrityDimensions as Record<string, unknown> | undefined
            const ctx = json?.context as Record<string, unknown> | undefined
            const client = ctx?.client as Record<string, unknown> | undefined
            const poToken = sid?.poToken as string | undefined
            const visitorData = client?.visitorData as string | undefined

            if (poToken) {
              const result: PoTokenResult = { poToken, visitorData }
              cache[videoId] = result
              cleanup()
              resolve(result)
              return
            }
          } catch (e) {
            console.error('JSON parse error in po-token interceptor', e)
          }
        }
      }

      callback({ cancel: false })
    })

    win.loadURL(`https://www.youtube.com/watch?v=${videoId}`).catch(() => {})

    win.webContents.on('did-finish-load', () => {
      win.webContents
        .executeJavaScript(
          `const b = document.querySelector('.ytp-play-button') || document.querySelector('.html5-video-player');
           if (b) b.click()`
        )
        .catch(() => {})
    })
  })
}
