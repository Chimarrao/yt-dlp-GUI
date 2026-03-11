/**
 * Constantes e utilitários compartilhados entre os processos main, preload e renderer.
 * Centraliza regex, enums e helpers de plataforma para evitar duplicação.
 */

/**
 * Regex para detectar URLs do YouTube em texto arbitrário.
 * Suporta: youtube.com/watch, youtu.be/, shorts, playlists, embeds e music.youtube.com.
 */
export const YOUTUBE_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|playlist\?list=|embed\/)|youtu\.be\/|music\.youtube\.com\/watch\?v=)[\w\-&=?%]+/gi

/**
 * Enum com os possíveis estados de um download.
 * Usado no store do renderer e nos eventos IPC.
 */
export enum DownloadStatus {
  Pending = 'pending',
  Downloading = 'downloading',
  Complete = 'complete',
  Error = 'error',
  Cancelled = 'cancelled'
}

/**
 * Plataformas suportadas pelo app.
 */
export enum Platform {
  Mac = 'darwin',
  Linux = 'linux',
  Windows = 'win32'
}

/**
 * Retorna a plataforma atual do sistema operacional.
 */
export function getCurrentPlatform(): Platform {
  return process.platform as Platform
}

/**
 * Comando do SO para localizar um binário no PATH.
 * Windows usa 'where', Unix usa 'which'.
 */
export function getWhichCommand(): string {
  return getCurrentPlatform() === Platform.Windows ? 'where' : 'which'
}

/**
 * Verifica se a plataforma atual é Windows.
 */
export function isWindows(): boolean {
  return getCurrentPlatform() === Platform.Windows
}

/**
 * Intervalo em milissegundos para polling da área de transferência.
 */
export const CLIPBOARD_POLL_INTERVAL_MS = 1500

/**
 * Navegadores suportados para extração de cookies.
 */
export const SUPPORTED_BROWSERS = [
  'chrome',
  'firefox',
  'edge',
  'brave',
  'opera',
  'safari',
  'chromium'
] as const

export type SupportedBrowser = (typeof SUPPORTED_BROWSERS)[number]
