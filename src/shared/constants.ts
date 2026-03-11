/**
 * Constantes e utilitários compartilhados entre main, preload e renderer.
 */

export const YOUTUBE_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|playlist\?list=|embed\/)|youtu\.be\/|music\.youtube\.com\/watch\?v=)[\w\-&=?%]+/gi;

export enum DownloadStatus {
  Pending = 'pending',
  Downloading = 'downloading',
  Complete = 'complete',
  Error = 'error',
  Cancelled = 'cancelled'
}

export enum Platform {
  Mac = 'darwin',
  Linux = 'linux',
  Windows = 'win32'
}

export function getCurrentPlatform(): Platform {
  return process.platform as Platform;
}

export function getWhichCommand(): string {
  return getCurrentPlatform() === Platform.Windows ? 'where' : 'which';
}

export function isWindows(): boolean {
  return getCurrentPlatform() === Platform.Windows;
}

export const CLIPBOARD_POLL_INTERVAL_MS = 1500;

export const SUPPORTED_BROWSERS = [
  'chrome',
  'firefox',
  'edge',
  'brave',
  'opera',
  'safari',
  'chromium'
] as const;

export type SupportedBrowser = (typeof SUPPORTED_BROWSERS)[number];
