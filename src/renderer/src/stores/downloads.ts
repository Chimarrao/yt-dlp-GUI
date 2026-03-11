/**
 * Store reativo de downloads e configurações do app.
 *
 * Gerencia a fila de downloads (adicionar, atualizar progresso, erro, concluir, remover),
 * as configurações globais (cookies, diretório de saída, formato padrão),
 * e o cache de formatos pré-carregados.
 *
 * Usa `reactive` e `ref` do Vue para que todos os componentes reajam às mudanças automaticamente.
 */

import { reactive, ref } from 'vue'
import { DownloadStatus } from '../../../shared/constants'

// Re-exporta o enum para os componentes usarem
export { DownloadStatus }

/** Representa um item na fila de downloads */
export interface DownloadItem {
  id: string
  url: string
  title: string
  thumbnail: string
  loadingTitle: boolean
  status: DownloadStatus
  percent: number
  speed: string
  eta: string
  error: string
  formatId: string
}

/** Configurações globais do app */
export interface AppSettings {
  useCookies: boolean
  cookieBrowser: string
  outputDir: string
  defaultFormat: string
  mergeFormat: string
}

/** Informações de formato em cache */
interface CachedFormatInfo {
  title: string
  formats: unknown[]
  timestamp: number
}

// ── Estado global (singleton) ──

const downloads = reactive<DownloadItem[]>([])

const settings = reactive<AppSettings>({
  useCookies: true,
  cookieBrowser: 'chrome',
  outputDir: '',
  defaultFormat: 'bestvideo+bestaudio',
  mergeFormat: 'mkv'
})

const currentView = ref<'downloads' | 'settings'>('downloads')

/**
 * Cache de formatos já consultados.
 * Chave: URL do vídeo → Valor: dados de formatos + timestamp.
 * Evita re-consultar o yt-dlp quando o usuário abre o seletor de formatos.
 */
const formatCache = reactive<Record<string, CachedFormatInfo>>({})

/** Contador incremental para gerar IDs únicos de download */
let idCounter = 0

function generateId(): string {
  return `dl_${Date.now()}_${++idCounter}`
}

/**
 * Composable principal — retorna o estado e as ações do store.
 */
export function useDownloads() {
  /**
   * Adiciona um novo download à fila com status "pending".
   * Agora inclui flag `loadingTitle` para exibir skeleton enquanto busca título.
   */
  function addDownload(url: string, title = '', thumbnail = ''): DownloadItem {
    const item: DownloadItem = {
      id: generateId(),
      url,
      title: title || '',
      thumbnail,
      loadingTitle: !title,
      status: DownloadStatus.Pending,
      percent: 0,
      speed: '',
      eta: '',
      error: '',
      formatId: settings.defaultFormat
    }
    downloads.push(item)
    return item
  }

  function updateProgress(id: string, percent: number, speed: string, eta: string): void {
    const item = downloads.find((d) => d.id === id)
    if (item) {
      item.status = DownloadStatus.Downloading
      item.percent = percent
      item.speed = speed
      item.eta = eta
    }
  }

  function markComplete(id: string): void {
    const item = downloads.find((d) => d.id === id)
    if (item) {
      item.status = DownloadStatus.Complete
      item.percent = 100
      item.speed = ''
      item.eta = ''
    }
  }

  function markError(id: string, error: string): void {
    const item = downloads.find((d) => d.id === id)
    if (item) {
      if (item.status === DownloadStatus.Complete) {
        return
      }
      item.status = DownloadStatus.Error
      item.error = error
    }
  }

  function removeDownload(id: string): void {
    const index = downloads.findIndex((d) => d.id === id)
    if (index !== -1) {
      downloads.splice(index, 1)
    }
  }

  function clearCompleted(): void {
    for (let i = downloads.length - 1; i >= 0; i--) {
      if (downloads[i].status === DownloadStatus.Complete) {
        downloads.splice(i, 1)
      }
    }
  }

  function setFormat(id: string, formatId: string): void {
    const item = downloads.find((d) => d.id === id)
    if (item) {
      item.formatId = formatId
    }
  }

  /**
   * Armazena formatos em cache para uma URL.
   * O FormatDialog consulta o cache antes de fazer nova requisição.
   */
  function cacheFormats(url: string, title: string, formats: unknown[]): void {
    formatCache[url] = { title, formats, timestamp: Date.now() }
  }

  /**
   * Retorna formatos em cache para uma URL (se existirem e não expiraram).
   * Cache válido por 10 minutos.
   */
  function getCachedFormats(url: string): CachedFormatInfo | null {
    const cached = formatCache[url]
    if (!cached) return null

    // Cache expira em 10 minutos
    const TEN_MINUTES = 10 * 60 * 1000
    if (Date.now() - cached.timestamp > TEN_MINUTES) {
      delete formatCache[url]
      return null
    }

    return cached
  }

  return {
    downloads,
    settings,
    currentView,
    formatCache,
    addDownload,
    updateProgress,
    markComplete,
    markError,
    removeDownload,
    clearCompleted,
    setFormat,
    cacheFormats,
    getCachedFormats
  }
}
