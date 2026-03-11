/**
 * Store reativo de downloads e configurações do app.
 *
 * Gerencia a fila de downloads, configurações globais,
 * cache de formatos, e persistência em disco via IPC.
 */

import { reactive, ref, watch } from 'vue';
import { DownloadStatus } from '../../../shared/constants';

export { DownloadStatus };

// ── Tipos das etapas de download ──
export type DownloadStage =
  | 'queued'
  | 'analyzing'
  | 'downloading_video'
  | 'downloading_audio'
  | 'merging'
  | 'complete';

/** Representa um item na fila de downloads */
export interface DownloadItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  loadingTitle: boolean;
  status: DownloadStatus;
  stage: DownloadStage;
  percent: number;
  speed: string;
  eta: string;
  error: string;
  formatId: string;
  retryCount: number;
  isRetrying: boolean;
}

/** Configurações globais do app */
export interface AppSettings {
  useCookies: boolean;
  cookieBrowser: string;
  outputDir: string;
  defaultFormat: string;
  mergeFormat: string;
  maxConcurrentDownloads: number;
  rateLimit: string;
}

/** Cache de formatos já consultados */
interface CachedFormatInfo {
  title: string;
  formats: unknown[];
  timestamp: number;
}

// ── Estado global (singleton) ──

const downloads = reactive<DownloadItem[]>([]);

const settings = reactive<AppSettings>({
  useCookies: false,
  cookieBrowser: 'chrome',
  outputDir: '',
  defaultFormat: 'bestvideo+bestaudio',
  mergeFormat: 'mkv',
  maxConcurrentDownloads: 3,
  rateLimit: '0'
});

const currentView = ref<'downloads' | 'settings'>('downloads');

const formatCache = reactive<Record<string, CachedFormatInfo>>({});

let idCounter = 0;

function generateId(): string {
  return `dl_${Date.now()}_${++idCounter}`;
}

// ── Auto-save debounced ──

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Salva as configurações no disco via IPC (com debounce de 500ms).
 */
function scheduleSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(async () => {
    try {
      const theme = localStorage.getItem('ytdlp-gui-theme') || 'dark-purple';
      await window.api.saveSettings({
        theme,
        locale: localStorage.getItem('ytdlp-gui-locale') || 'pt-BR',
        useCookies: settings.useCookies,
        cookieBrowser: settings.cookieBrowser,
        outputDir: settings.outputDir,
        defaultFormat: settings.defaultFormat,
        mergeFormat: settings.mergeFormat,
        maxConcurrentDownloads: settings.maxConcurrentDownloads,
        rateLimit: settings.rateLimit
      });
    } catch {
      // ignora erros de persistência
    }
  }, 500);
}

/**
 * Composable principal.
 */
export function useDownloads() {
  function addDownload(url: string, title = '', thumbnail = ''): DownloadItem {
    const item: DownloadItem = {
      id: generateId(),
      url,
      title: title || '',
      thumbnail,
      loadingTitle: !title,
      status: DownloadStatus.Pending,
      stage: 'queued',
      percent: 0,
      speed: '',
      eta: '',
      error: '',
      formatId: settings.defaultFormat,
      retryCount: 0,
      isRetrying: false
    };
    downloads.push(item);
    return item;
  }

  function updateProgress(id: string, percent: number, speed: string, eta: string): void {
    const item = downloads.find((d) => d.id === id);
    if (item) {
      item.status = DownloadStatus.Downloading;
      item.percent = percent;
      item.speed = speed;
      item.eta = eta;
    }
  }

  function updateStage(id: string, stage: DownloadStage): void {
    const item = downloads.find((d) => d.id === id);
    if (item) {
      item.stage = stage;
      if (stage !== 'queued' && stage !== 'complete') {
        item.status = DownloadStatus.Downloading;
      }
    }
  }

  function markRetrying(id: string, retryCount: number): void {
    const item = downloads.find((d) => d.id === id);
    if (item) {
      item.retryCount = retryCount;
      item.isRetrying = true;
      item.percent = 0;
      item.speed = '';
      item.eta = '';
    }
  }

  function markComplete(id: string): void {
    const item = downloads.find((d) => d.id === id);
    if (item) {
      item.status = DownloadStatus.Complete;
      item.stage = 'complete';
      item.percent = 100;
      item.speed = '';
      item.eta = '';
      item.isRetrying = false;
    }
  }

  function markError(id: string, error: string): void {
    const item = downloads.find((d) => d.id === id);
    if (item) {
      if (item.status === DownloadStatus.Complete) {
        return;
      }
      item.status = DownloadStatus.Error;
      item.error = error;
      item.isRetrying = false;
    }
  }

  function removeDownload(id: string): void {
    const index = downloads.findIndex((d) => d.id === id);
    if (index !== -1) {
      downloads.splice(index, 1);
    }
  }

  function clearCompleted(): void {
    for (let i = downloads.length - 1; i >= 0; i--) {
      if (downloads[i].status === DownloadStatus.Complete) {
        downloads.splice(i, 1);
      }
    }
  }

  function setFormat(id: string, formatId: string): void {
    const item = downloads.find((d) => d.id === id);
    if (item) {
      item.formatId = formatId;
    }
  }

  function cacheFormats(url: string, title: string, formats: unknown[]): void {
    formatCache[url] = { title, formats, timestamp: Date.now() };
  }

  function getCachedFormats(url: string): CachedFormatInfo | null {
    const cached = formatCache[url];
    if (!cached) {
      return null;
    }

    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - cached.timestamp > TEN_MINUTES) {
      delete formatCache[url];
      return null;
    }

    return cached;
  }

  /**
   * Carrega configurações salvas do disco e aplica no estado reativo.
   */
  async function loadPersistedSettings(): Promise<void> {
    try {
      const saved = await window.api.loadSettings();
      if (saved) {
        settings.useCookies = saved.useCookies;
        settings.cookieBrowser = saved.cookieBrowser;
        settings.outputDir = saved.outputDir;
        settings.defaultFormat = saved.defaultFormat;
        settings.mergeFormat = saved.mergeFormat;
        settings.maxConcurrentDownloads = saved.maxConcurrentDownloads || 3;
        settings.rateLimit = saved.rateLimit || '0';

        // Tema e idioma ficam no localStorage (o theme system lê de lá)
        if (saved.theme) {
          localStorage.setItem('ytdlp-gui-theme', saved.theme);
        }
        if (saved.locale) {
          localStorage.setItem('ytdlp-gui-locale', saved.locale);
        }
      }
    } catch {
      // ignora
    }
  }

  /**
   * Observa mudanças nas settings e salva automaticamente.
   */
  function startAutoSave(): void {
    watch(
      () => ({ ...settings }),
      () => {
        scheduleSave();
      },
      { deep: true }
    );
  }

  return {
    downloads,
    settings,
    currentView,
    formatCache,
    addDownload,
    updateProgress,
    updateStage,
    markRetrying,
    markComplete,
    markError,
    removeDownload,
    clearCompleted,
    setFormat,
    cacheFormats,
    getCachedFormats,
    loadPersistedSettings,
    startAutoSave,
    scheduleSave
  };
}
