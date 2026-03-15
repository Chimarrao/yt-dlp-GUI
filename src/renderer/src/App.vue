<template>
  <div>
    <div class="drag-region"></div>
    <Toast position="top-right" />

    <div class="app-layout">
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-logo">
            <div class="logo-icon">▶</div>
            <h1>yt-dlp GUI</h1>
          </div>
        </div>

        <nav class="sidebar-nav">
          <button
            class="nav-item"
            :class="{ active: currentView === 'downloads' }"
            @click="currentView = 'downloads'"
          >
            <i class="pi pi-download"></i>
            <span>{{ t('nav.downloads') }}</span>
            <Tag
              v-if="activeCount > 0"
              :value="String(activeCount)"
              severity="info"
              rounded
              style="margin-left: auto; font-size: 10px"
            />
          </button>
          <button
            class="nav-item"
            :class="{ active: currentView === 'settings' }"
            @click="currentView = 'settings'"
          >
            <i class="pi pi-cog"></i>
            <span>{{ t('nav.settings') }}</span>
          </button>
        </nav>

        <div class="sidebar-footer">
          <div class="dep-status">
            <span class="dep-dot" :class="ytdlpOk ? 'ok' : 'missing'"></span>
            <span>yt-dlp</span>
          </div>
          <div class="dep-status">
            <span class="dep-dot" :class="ffmpegOk ? 'ok' : 'missing'"></span>
            <span>ffmpeg</span>
          </div>
        </div>
      </aside>

      <main class="main-content">
        <template v-if="currentView === 'downloads'">
          <div class="content-header">
            <UrlInput @add-urls="handleAddUrls" />
            <div class="speed-chart-panel">
              <div class="speed-chart-header">
                <span>{{ t('downloads.speed_graph_title') }}</span>
                <strong>{{ totalSpeedLabel }}</strong>
              </div>
              <svg viewBox="0 0 460 58" class="speed-chart-svg" preserveAspectRatio="none">
                <path v-if="speedChartPath" :d="speedChartPath" class="speed-chart-line" />
              </svg>
            </div>
          </div>

          <div class="content-body">
            <div v-if="downloads.length === 0" class="empty-state">
              <i class="pi pi-cloud-download"></i>
              <p>{{ t('empty.title') }}<br />{{ t('empty.subtitle') }}</p>
            </div>

            <div v-else class="download-list">
              <div
                style="
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  margin-bottom: 8px;
                "
              >
                <span style="font-size: 13px; color: var(--text-secondary)">
                  {{ t('downloads.items', { count: downloads.length, completed: completedCount }) }}
                </span>
                <div style="display: flex; gap: 6px">
                  <Button
                    v-if="pendingCount > 0"
                    :label="t('downloads.start_all')"
                    icon="pi pi-play"
                    severity="success"
                    size="small"
                    outlined
                    @click="startAllPending"
                  />
                  <Button
                    v-if="completedCount > 0"
                    :label="t('downloads.clear_completed')"
                    icon="pi pi-eraser"
                    severity="secondary"
                    size="small"
                    text
                    @click="clearCompleted"
                  />
                </div>
              </div>

              <DownloadCard
                v-for="item in downloads"
                :key="item.id"
                :item="item"
                @start="handleStartDownload"
                @cancel="handleCancelDownload"
                @retry="handleRetryDownload"
                @remove="handleRemoveDownload"
                @pick-format="handlePickFormat"
              />
            </div>
          </div>
        </template>

        <template v-if="currentView === 'settings'">
          <div class="content-header">
            <h2 style="font-size: 18px; font-weight: 600">{{ t('settings.title') }}</h2>
          </div>
          <div class="content-body">
            <SettingsPanel />
          </div>
        </template>
      </main>
    </div>

    <FormatDialog
      v-if="formatDialogItem"
      :url="formatDialogItem.url"
      :download-id="formatDialogItem.id"
      @select="handleFormatSelected"
      @close="formatDialogItem = null"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Componente raiz.
 *
 * Pré-carrega título/thumbnail via fetchQuickInfo ao adicionar URLs.
 * Escuta eventos de stage, retry, progresso, complete, error.
 * Carrega settings persistidas e inicia auto-save.
 * Passa rateLimit ao startDownload.
 */

import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Toast from 'primevue/toast'
import { useToast } from 'primevue/usetoast'
import Tag from 'primevue/tag'
import Button from 'primevue/button'

import UrlInput from './components/UrlInput.vue'
import DownloadCard from './components/DownloadCard.vue'
import FormatDialog from './components/FormatDialog.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import {
  useDownloads,
  DownloadStatus,
  type DownloadItem,
  type DownloadStage,
  normalizeRateLimitInput,
  isValidRateLimit
} from './stores/downloads'
import { useI18n } from './i18n'
import { useTheme } from './themes'
import {
  isGenericFormatSelector,
  resolveRequestedFormatSelection,
  type SelectableFormat
} from './utils/format-selection'

const toast = useToast()
const { t, setLocale } = useI18n()
const { initTheme } = useTheme()

const {
  downloads,
  settings,
  currentView,
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
  getCachedFormats,
  setFormatAnalysisStatus,
  loadPersistedSettings,
  startAutoSave
} = useDownloads()

const formatDialogItem = ref<DownloadItem | null>(null)
const ytdlpOk = ref(false)
const ffmpegOk = ref(false)

const activeCount = computed(
  () => downloads.filter((d) => d.status === DownloadStatus.Downloading).length
)
const completedCount = computed(
  () => downloads.filter((d) => d.status === DownloadStatus.Complete).length
)
const pendingCount = computed(
  () => downloads.filter((d) => d.status === DownloadStatus.Pending).length
)

const speedSeries = ref<number[]>([])
const speedSamplingTimer = ref<ReturnType<typeof setInterval> | null>(null)

const speedChartPath = computed(() => {
  const values = speedSeries.value
  if (values.length < 2) {
    return ''
  }

  const width = 460
  const height = 58
  const max = Math.max(...values, 1)

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const y = height - (value / max) * height
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

const totalSpeedLabel = computed(() => formatSpeed(getAggregatedSpeedBps()))

function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond < 1) {
    return '0 B/s'
  }

  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytesPerSecond
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function startSpeedSampling(): void {
  speedSamplingTimer.value = setInterval(() => {
    const MAX_POINTS = 40
    speedSeries.value.push(getAggregatedSpeedBps())
    if (speedSeries.value.length > MAX_POINTS) {
      speedSeries.value.splice(0, speedSeries.value.length - MAX_POINTS)
    }
  }, 1000)
}

async function ensureResolvedFormat(item: DownloadItem): Promise<void> {
  if (!isGenericFormatSelector(item.formatId)) {
    return
  }

  try {
    // Nao dispara nova analise aqui para evitar travar o inicio do download.
    const cached = getCachedFormats(item.url)
    if (!cached) {
      return
    }

    const resolved = resolveRequestedFormatSelection(
      cached.formats as SelectableFormat[],
      item.formatId || settings.defaultFormat
    )

    if (resolved?.resolvedFormatId) {
      setFormat(item.id, resolved.resolvedFormatId)
    }
  } catch {
    // Mantém o formato genérico atual se a análise falhar.
  }
}

// ── Pré-carregamento ──

async function prefetchVideoInfo(item: DownloadItem): Promise<void> {
  try {
    const cookieOptions = {
      useCookies: settings.useCookies,
      cookieBrowser: settings.cookieBrowser,
      cookiesFilePath: settings.cookiesFilePath,
      proxyUrl: settings.proxyUrl
    }

    // Pré-carregamento leve: só título/thumbnail. Os formatos ficam para o modal.
    const info = await window.api.fetchQuickInfo(item.url, cookieOptions)

    if (info.title) {
      item.title = info.title
    }
    if (info.thumbnail) {
      item.thumbnail = info.thumbnail
    }
  } catch {
    // ignora
  } finally {
    item.loadingTitle = false
  }
}

// ── Manipuladores ──

function handleAddUrls(urls: string[]): void {
  const added: DownloadItem[] = []

  for (const url of urls) {
    if (downloads.some((d) => d.url === url)) {
      continue
    }
    added.push(addDownload(url))
  }

  if (added.length > 0) {
    toast.add({
      severity: 'info',
      summary: t('toast.urls_added'),
      detail: t('toast.urls_added_detail', { count: added.length }),
      life: 3000
    })

    for (const item of added) {
      prefetchVideoInfo(item)
      setFormatAnalysisStatus(item.url, 'idle')
    }
  }
}

async function handleStartDownload(item: DownloadItem): Promise<void> {
  const normalizedRateLimit = normalizeRateLimitInput(settings.rateLimit)
  if (!isValidRateLimit(normalizedRateLimit)) {
    markError(item.id, t('settings.rate_limit_invalid'))
    toast.add({
      severity: 'warn',
      summary: t('settings.rate_limit'),
      detail: t('settings.rate_limit_invalid'),
      life: 3500
    })
    return
  }

  settings.rateLimit = normalizedRateLimit
  item.status = DownloadStatus.Downloading
  item.error = ''

  await ensureResolvedFormat(item)

  let outputDir = settings.outputDir
  if (outputDir.startsWith('~')) {
    outputDir = outputDir.replace('~', process.env.HOME || '/tmp')
  }
  if (!outputDir) {
    outputDir = '/tmp'
  }

  try {
    await window.api.startDownload({
      id: item.id,
      url: item.url,
      outputDir,
      formatId: item.formatId,
      useCookies: settings.useCookies,
      cookieBrowser: settings.cookieBrowser,
      cookiesFilePath: settings.cookiesFilePath,
      proxyUrl: settings.proxyUrl,
      mergeFormat: settings.mergeFormat,
      rateLimit: normalizedRateLimit
    })
  } catch (err: unknown) {
    markError(item.id, err instanceof Error ? err.message : String(err))
  }
}

function handleCancelDownload(item: DownloadItem): void {
  window.api.cancelDownload(item.id)
  markCancelled(item.id)
}

function handleRetryDownload(item: DownloadItem): void {
  item.status = DownloadStatus.Pending
  item.percent = 0
  item.speed = ''
  item.eta = ''
  item.error = ''
  item.isRetrying = false
  item.retryCount = 0
  handleStartDownload(item)
}

function handleRemoveDownload(item: DownloadItem): void {
  if (item.status === DownloadStatus.Downloading) {
    window.api.cancelDownload(item.id)
  }
  removeDownload(item.id)
}

function handlePickFormat(item: DownloadItem): void {
  formatDialogItem.value = item
}

function handleFormatSelected(downloadId: string, formatId: string): void {
  setFormat(downloadId, formatId)
  formatDialogItem.value = null
  toast.add({
    severity: 'success',
    summary: t('toast.format_selected'),
    detail: t('toast.format_selected_detail', { id: formatId }),
    life: 2000
  })
}

function startAllPending(): void {
  const items = downloads.filter((d) => d.status === DownloadStatus.Pending)
  for (const item of items) {
    handleStartDownload(item)
  }
}

// ── Listeners IPC ──

let unsubProgress: (() => void) | null = null
let unsubComplete: (() => void) | null = null
let unsubError: (() => void) | null = null
let unsubClipboard: (() => void) | null = null
let unsubStage: (() => void) | null = null
let unsubRetry: (() => void) | null = null
let unsubCancelled: (() => void) | null = null

onMounted(async () => {
  // Carrega configurações do disco
  await loadPersistedSettings()

  // Aplica o idioma salvo
  const savedLocale = localStorage.getItem('ytdlp-gui-locale')
  if (savedLocale === 'en' || savedLocale === 'pt-BR') {
    setLocale(savedLocale)
  }

  // Inicia tema e salvamento automático
  initTheme()
  startAutoSave()
  startSpeedSampling()

  // Verifica dependências
  try {
    const ytdlpStatus = await window.api.checkDep('yt-dlp')
    ytdlpOk.value = ytdlpStatus.installed
    const ffmpegStatus = await window.api.checkDep('ffmpeg')
    ffmpegOk.value = ffmpegStatus.installed
  } catch {
    // ignora
  }

  // Registra listeners
  unsubProgress = window.api.onDownloadProgress((data) => {
    updateProgress(data.id, data.percent, data.speed, data.eta)
  })

  unsubComplete = window.api.onDownloadComplete((data) => {
    markComplete(data.id)
    toast.add({
      severity: 'success',
      summary: t('toast.download_complete'),
      detail: t('toast.download_complete_detail'),
      life: 4000
    })
  })

  unsubError = window.api.onDownloadError((data) => {
    markError(data.id, data.error)
  })

  unsubStage = window.api.onDownloadStage((data) => {
    updateStage(data.id, data.stage as DownloadStage)
  })

  unsubRetry = window.api.onDownloadRetry((data) => {
    markRetrying(data.id, data.retryCount)
  })

  unsubCancelled = window.api.onDownloadCancelled((data) => {
    markCancelled(data.id)
  })

  unsubClipboard = window.api.onClipboardUrl((urls) => {
    const added: DownloadItem[] = []

    for (const url of urls) {
      if (downloads.some((d) => d.url === url)) {
        continue
      }
      added.push(addDownload(url))
    }

    if (added.length > 0) {
      toast.add({
        severity: 'info',
        summary: t('toast.url_detected'),
        detail: t('toast.url_detected_detail', { count: added.length }),
        life: 4000
      })

      for (const item of added) {
        prefetchVideoInfo(item)
        setFormatAnalysisStatus(item.url, 'idle')
      }
    }
  })
})

onBeforeUnmount(() => {
  unsubProgress?.()
  unsubComplete?.()
  unsubError?.()
  unsubClipboard?.()
  unsubStage?.()
  unsubRetry?.()
  unsubCancelled?.()
  if (speedSamplingTimer.value) {
    clearInterval(speedSamplingTimer.value)
  }
})
</script>
