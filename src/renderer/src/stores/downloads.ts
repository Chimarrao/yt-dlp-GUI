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
  | 'complete'
  | 'cancelled';

const RATE_LIMIT_REGEX = /^(?:0|\d+(?:\.\d+)?[KMG]?)$/i;

export function normalizeRateLimitInput(value: string): string {
  const normalized = (value || '0').trim().toUpperCase();
  return normalized || '0';
}

export function isValidRateLimit(value: string): boolean {
  return RATE_LIMIT_REGEX.test(normalizeRateLimitInput(value));
}

export function parseSpeedToBytesPerSecond(speed: string): number {
  const trimmed = (speed || '').trim();
  if (!trimmed || trimmed === 'N/A' || trimmed === '--') {
    return 0;
  }

  const match = trimmed.match(/([\d.]+)\s*([KMGT]?)(?:i?B)?\/s/i);
  if (!match) {
    return 0;
  }

  const value = Number(match[1]);
  if (Number.isNaN(value)) {
    return 0;
  }

  const unit = match[2].toUpperCase();
  const powers: Record<string, number> = {
    '': 0,
    K: 1,
    M: 2,
    G: 3,
    T: 4
  };

  return value * 1024 ** (powers[unit] ?? 0);
}

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
  cookiesFilePath: string;
  proxyUrl: string;
  outputDir: string;
  defaultFormat: string;
  mergeFormat: string;
  maxConcurrentDownloads: number;
  rateLimit: string;
}

/** Cache de formatos já consultados */
interface CachedFormatInfo {
  title: string;
  duration: number;
  formats: unknown[];
  timestamp: number;
}

export type FormatAnalysisStatus = 'idle' | 'queued' | 'loading' | 'ready' | 'error';

interface FormatAnalysisInfo {
  status: FormatAnalysisStatus;
  error: string;
  updatedAt: number;
}

// ── Estado global (singleton) ──

const downloads = reactive<DownloadItem[]>([]);

const settings = reactive<AppSettings>({
  useCookies: false,
  cookieBrowser: 'chrome',
  cookiesFilePath: '',
  proxyUrl: '',
  outputDir: '',
  defaultFormat: 'bestvideo+bestaudio',
  mergeFormat: 'mkv',
  maxConcurrentDownloads: 3,
  rateLimit: '0'
});

const currentView = ref<'downloads' | 'settings'>('downloads');

const formatCache = reactive<Record<string, CachedFormatInfo>>({});
const formatAnalysis = reactive<Record<string, FormatAnalysisInfo>>({});
const inFlightFormatLoads = new Map<string, Promise<CachedFormatInfo>>();

export interface UseDownloadsStore {
  downloads: typeof downloads
  settings: typeof settings
  currentView: typeof currentView
  formatCache: typeof formatCache
  formatAnalysis: typeof formatAnalysis
  addDownload: (url: string, title?: string, thumbnail?: string) => DownloadItem
  updateProgress: (id: string, percent: number, speed: string, eta: string) => void
  updateStage: (id: string, stage: DownloadStage) => void
  markRetrying: (id: string, retryCount: number) => void
  markComplete: (id: string) => void
  markCancelled: (id: string) => void
  markError: (id: string, error: string) => void
  getAggregatedSpeedBps: () => number
  removeDownload: (id: string) => void
  clearCompleted: () => void
  setFormat: (id: string, formatId: string) => void
  cacheFormats: (url: string, title: string, formats: unknown[], duration?: number) => void
  getCachedFormats: (url: string) => CachedFormatInfo | null
  ensureFormats: (
    url: string,
    cookies: {
      useCookies: boolean
      cookieBrowser: string
      cookiesFilePath?: string
      proxyUrl?: string
    }
  ) => Promise<CachedFormatInfo>
  setFormatAnalysisStatus: (url: string, status: FormatAnalysisStatus, error?: string) => void
  getFormatAnalysisStatus: (url: string) => FormatAnalysisInfo
  loadPersistedSettings: () => Promise<void>
  startAutoSave: () => void
  scheduleSave: () => void
}

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
        cookiesFilePath: settings.cookiesFilePath,
        proxyUrl: settings.proxyUrl,
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
export function useDownloads(): UseDownloadsStore {
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

  function markCancelled(id: string): void {
    const item = downloads.find((d) => d.id === id);
    if (item) {
      item.status = DownloadStatus.Cancelled;
      item.stage = 'cancelled';
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
      if (item.status === DownloadStatus.Cancelled) {
        return;
      }
      item.status = DownloadStatus.Error;
      item.error = error;
      item.isRetrying = false;
    }
  }

  function getAggregatedSpeedBps(): number {
    return downloads
      .filter((d) => d.status === DownloadStatus.Downloading)
      .reduce((sum, d) => sum + parseSpeedToBytesPerSecond(d.speed), 0);
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

  function setFormatAnalysisStatus(url: string, status: FormatAnalysisStatus, error = ''): void {
    formatAnalysis[url] = {
      status,
      error,
      updatedAt: Date.now()
    };
  }

  function getFormatAnalysisStatus(url: string): FormatAnalysisInfo {
    return (
      formatAnalysis[url] || {
        status: 'idle',
        error: '',
        updatedAt: 0
      }
    );
  }

  function cacheFormats(url: string, title: string, formats: unknown[], duration = 0): void {
    formatCache[url] = { title, duration, formats, timestamp: Date.now() };
    setFormatAnalysisStatus(url, 'ready');
  }

  function getCachedFormats(url: string): CachedFormatInfo | null {
    const cached = formatCache[url];
    if (!cached) {
      return null;
    }

    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - cached.timestamp > TEN_MINUTES) {
      delete formatCache[url];
      setFormatAnalysisStatus(url, 'idle');
      return null;
    }

    return cached;
  }

  async function ensureFormats(
    url: string,
    cookies: {
      useCookies: boolean;
      cookieBrowser: string;
      cookiesFilePath?: string;
      proxyUrl?: string;
    }
  ): Promise<CachedFormatInfo> {
    const cached = getCachedFormats(url);
    if (cached) {
      return cached;
    }

    const existingRequest = inFlightFormatLoads.get(url);
    if (existingRequest) {
      return existingRequest;
    }

    setFormatAnalysisStatus(url, 'loading');

    const task = (async () => {
      try {
        const info = await window.api.listFormats(url, cookies);
        const result: CachedFormatInfo = {
          title: info.title,
          duration: info.duration || 0,
          formats: info.formats as unknown[],
          timestamp: Date.now()
        };
        formatCache[url] = result;
        setFormatAnalysisStatus(url, 'ready');
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setFormatAnalysisStatus(url, 'error', message);
        throw err;
      } finally {
        inFlightFormatLoads.delete(url);
      }
    })();

    inFlightFormatLoads.set(url, task);
    return task;
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
        settings.cookiesFilePath = saved.cookiesFilePath || '';
        settings.proxyUrl = saved.proxyUrl || '';
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
    formatAnalysis,
    addDownload,
    updateProgress,
    updateStage,
    markRetrying,
    markComplete,
    markCancelled,
    markError,
    getAggregatedSpeedBps,
    removeDownload,
    clearCompleted,
    setFormat,
    cacheFormats,
    getCachedFormats,
    ensureFormats,
    setFormatAnalysisStatus,
    getFormatAnalysisStatus,
    loadPersistedSettings,
    startAutoSave,
    scheduleSave
  };
}
