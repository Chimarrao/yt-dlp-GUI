import { ElectronAPI } from '@electron-toolkit/preload'

interface DepStatus {
  name: string
  installed: boolean
  path: string | null
  version: string | null
}

interface FormatInfo {
  format_id: string
  ext: string
  resolution: string
  height: number | null
  fps: number | null
  filesize: number | null
  filesize_approx: number | null
  vcodec: string
  acodec: string
  tbr: number | null
  format_note: string
}

interface CookieOptions {
  useCookies: boolean
  cookieBrowser: string
}

interface VideoInfo {
  id: string
  title: string
  thumbnail: string
  duration: number
  formats: FormatInfo[]
  url: string
}

interface DownloadProgress {
  id: string
  percent: number
  speed: string
  eta: string
}

interface AppAPI {
  checkDep(name: 'yt-dlp' | 'ffmpeg'): Promise<DepStatus>
  installDep(name: 'yt-dlp' | 'ffmpeg'): Promise<DepStatus>
  fetchQuickInfo(
    url: string,
    cookies?: CookieOptions
  ): Promise<{ title: string; thumbnail: string }>
  listFormats(url: string, cookies?: CookieOptions): Promise<VideoInfo>
  startDownload(options: Record<string, unknown>): Promise<void>
  cancelDownload(id: string): Promise<boolean>
  selectDirectory(): Promise<string | null>
  notify(title: string, body: string): void
  onClipboardUrl(callback: (urls: string[]) => void): () => void
  onDownloadProgress(callback: (data: DownloadProgress) => void): () => void
  onDownloadComplete(callback: (data: { id: string }) => void): () => void
  onDownloadError(callback: (data: { id: string; error: string }) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
