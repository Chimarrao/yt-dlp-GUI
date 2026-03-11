/**
 * Script de preload — ponte segura entre o Main Process e o Renderer.
 *
 * Este arquivo roda em um contexto isolado ANTES da página carregar.
 * Ele expõe funções seguras para o renderer via `contextBridge.exposeInMainWorld`.
 *
 * Como funciona:
 * 1. O renderer (Vue) não tem acesso direto ao Node.js nem ao `ipcRenderer`
 * 2. Este script cria um objeto `api` com métodos que internamente usam `ipcRenderer`
 * 3. O `contextBridge` injeta esse objeto como `window.api` na página
 * 4. No renderer, chamamos `window.api.startDownload(...)` que por baixo faz `ipcRenderer.invoke('ytdlp:download', ...)`
 *
 * Métodos expostos:
 * - `invoke()` → envia uma mensagem e ESPERA a resposta (como uma chamada de API)
 * - `send()` → envia uma mensagem sem esperar resposta (fire-and-forget)
 * - `on()` → registra um listener para eventos vindos do main (ex: progresso de download)
 *
 * A função de retorno dos listeners `on*` serve para desregistrar o listener quando o componente for desmontado.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // ── Dependências ──
  /** Verifica se yt-dlp ou ffmpeg está instalado */
  checkDep: (name: 'yt-dlp' | 'ffmpeg') => ipcRenderer.invoke('deps:check', name),

  /** Instala yt-dlp ou ffmpeg automaticamente */
  installDep: (name: 'yt-dlp' | 'ffmpeg') => ipcRenderer.invoke('deps:install', name),

  // ── Operações do yt-dlp ──
  /** Busca rápida de título e thumbnail (sem baixar o vídeo) */
  fetchQuickInfo: (url: string, cookies?: { useCookies: boolean; cookieBrowser: string }) =>
    ipcRenderer.invoke('ytdlp:quick-info', url, cookies),

  /** Lista os formatos disponíveis de um vídeo (passa cookies para liberar 4K) */
  listFormats: (url: string, cookies?: { useCookies: boolean; cookieBrowser: string }) =>
    ipcRenderer.invoke('ytdlp:list-formats', url, cookies),

  /** Inicia o download de um vídeo com as opções fornecidas */
  startDownload: (options: Record<string, unknown>) =>
    ipcRenderer.invoke('ytdlp:download', options),

  /** Cancela um download em andamento */
  cancelDownload: (id: string) => ipcRenderer.invoke('ytdlp:cancel', id),

  // ── Diálogos do SO ──
  /** Abre o seletor nativo de diretórios */
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),

  // ── Notificações ──
  /** Exibe uma notificação nativa do sistema */
  notify: (title: string, body: string) => ipcRenderer.send('notify', { title, body }),

  // ── Listeners de eventos vindos do main ──
  // Cada função retorna uma função de cleanup para desregistrar o listener

  /** Registra listener para URLs do YouTube detectadas na clipboard */
  onClipboardUrl: (callback: (urls: string[]) => void) => {
    const handler = (_: unknown, urls: string[]): void => callback(urls)
    ipcRenderer.on('clipboard:youtube-url', handler)
    return () => ipcRenderer.removeListener('clipboard:youtube-url', handler)
  },

  /** Registra listener para atualizações de progresso de download */
  onDownloadProgress: (
    callback: (data: { id: string; percent: number; speed: string; eta: string }) => void
  ) => {
    const handler = (
      _: unknown,
      data: { id: string; percent: number; speed: string; eta: string }
    ): void => callback(data)
    ipcRenderer.on('download:progress', handler)
    return () => ipcRenderer.removeListener('download:progress', handler)
  },

  /** Registra listener para quando um download é concluído */
  onDownloadComplete: (callback: (data: { id: string }) => void) => {
    const handler = (_: unknown, data: { id: string }): void => callback(data)
    ipcRenderer.on('download:complete', handler)
    return () => ipcRenderer.removeListener('download:complete', handler)
  },

  /** Registra listener para erros de download */
  onDownloadError: (callback: (data: { id: string; error: string }) => void) => {
    const handler = (_: unknown, data: { id: string; error: string }): void => callback(data)
    ipcRenderer.on('download:error', handler)
    return () => ipcRenderer.removeListener('download:error', handler)
  }
}

/**
 * Exposição da API para o renderer.
 *
 * Se `contextIsolation` estiver ativo (padrão em Electron moderno), usamos
 * `contextBridge` para injetar de forma segura. Caso contrário, atribui direto
 * ao `window` (modo legado, não recomendado).
 */
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore — modo legado sem context isolation
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
