/**
 * Script de preload — ponte segura entre o Main Process e o Renderer.
 *
 * Expõe funções seguras para o renderer via `contextBridge.exposeInMainWorld`.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

const api = {
  // ── Dependências ──
  checkDep: (name: 'yt-dlp' | 'ffmpeg') => ipcRenderer.invoke('deps:check', name),
  installDep: (name: 'yt-dlp' | 'ffmpeg') => ipcRenderer.invoke('deps:install', name),

  // ── Configurações persistidas ──
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('settings:save', settings),

  // ── Operações do yt-dlp ──
  fetchQuickInfo: (url: string, cookies?: { useCookies: boolean; cookieBrowser: string }) =>
    ipcRenderer.invoke('ytdlp:quick-info', url, cookies),

  listFormats: (url: string, cookies?: { useCookies: boolean; cookieBrowser: string }) =>
    ipcRenderer.invoke('ytdlp:list-formats', url, cookies),

  startDownload: (options: Record<string, unknown>) =>
    ipcRenderer.invoke('ytdlp:download', options),

  cancelDownload: (id: string) => ipcRenderer.invoke('ytdlp:cancel', id),

  // ── Diálogos do SO ──
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),

  // ── Notificações ──
  notify: (title: string, body: string) => ipcRenderer.send('notify', { title, body }),

  // ── Listeners de eventos do main ──
  onClipboardUrl: (callback: (urls: string[]) => void) => {
    const handler = (_: unknown, urls: string[]): void => callback(urls);
    ipcRenderer.on('clipboard:youtube-url', handler);
    return () => ipcRenderer.removeListener('clipboard:youtube-url', handler);
  },

  onDownloadProgress: (
    callback: (data: { id: string; percent: number; speed: string; eta: string }) => void
  ) => {
    const handler = (
      _: unknown,
      data: { id: string; percent: number; speed: string; eta: string }
    ): void => callback(data);
    ipcRenderer.on('download:progress', handler);
    return () => ipcRenderer.removeListener('download:progress', handler);
  },

  onDownloadComplete: (callback: (data: { id: string }) => void) => {
    const handler = (_: unknown, data: { id: string }): void => callback(data);
    ipcRenderer.on('download:complete', handler);
    return () => ipcRenderer.removeListener('download:complete', handler);
  },

  onDownloadError: (callback: (data: { id: string; error: string }) => void) => {
    const handler = (_: unknown, data: { id: string; error: string }): void => callback(data);
    ipcRenderer.on('download:error', handler);
    return () => ipcRenderer.removeListener('download:error', handler);
  },

  /** Listener para mudança de etapa do download */
  onDownloadStage: (callback: (data: { id: string; stage: string }) => void) => {
    const handler = (_: unknown, data: { id: string; stage: string }): void => callback(data);
    ipcRenderer.on('download:stage', handler);
    return () => ipcRenderer.removeListener('download:stage', handler);
  },

  /** Listener para notificação de retry */
  onDownloadRetry: (callback: (data: { id: string; retryCount: number }) => void) => {
    const handler = (_: unknown, data: { id: string; retryCount: number }): void => callback(data);
    ipcRenderer.on('download:retry', handler);
    return () => ipcRenderer.removeListener('download:retry', handler);
  }
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore — modo legado
  window.electron = electronAPI;
  // @ts-ignore
  window.api = api;
}
