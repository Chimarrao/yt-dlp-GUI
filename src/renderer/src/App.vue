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
              style="margin-left:auto;font-size:10px"
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
          </div>

          <div class="content-body">
            <div v-if="downloads.length === 0" class="empty-state">
              <i class="pi pi-cloud-download"></i>
              <p>{{ t('empty.title') }}<br />{{ t('empty.subtitle') }}</p>
            </div>

            <div v-else class="download-list">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <span style="font-size:13px;color:var(--text-secondary)">
                  {{ t('downloads.items', { count: downloads.length, completed: completedCount }) }}
                </span>
                <div style="display:flex;gap:6px">
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
            <h2 style="font-size:18px;font-weight:600">{{ t('settings.title') }}</h2>
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
 * Componente raiz da aplicação.
 *
 * Estratégia de pré-carregamento:
 * Quando uma URL é adicionada, fazemos `listFormats` em background. Essa chamada
 * retorna título, thumbnail E todos os formatos de uma só vez. Com isso:
 * 1. O título e thumbnail aparecem no card assim que o yt-dlp responde
 * 2. Os formatos ficam em cache para abrir o seletor instantaneamente
 *
 * Isso substitui o `fetchQuickInfo` anterior (que fazia duas chamadas separadas).
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
import { useDownloads, DownloadStatus, type DownloadItem } from './stores/downloads'
import { useI18n } from './i18n'
import { useTheme } from './themes'

const toast = useToast()
const { t } = useI18n()
const { initTheme } = useTheme()

const {
  downloads,
  settings,
  currentView,
  addDownload,
  updateProgress,
  markComplete,
  markError,
  removeDownload,
  clearCompleted,
  setFormat,
  cacheFormats
} = useDownloads()

const formatDialogItem = ref<DownloadItem | null>(null)
const ytdlpOk = ref(false)
const ffmpegOk = ref(false)

const activeCount = computed(() =>
  downloads.filter((d) => d.status === DownloadStatus.Downloading).length
)
const completedCount = computed(() =>
  downloads.filter((d) => d.status === DownloadStatus.Complete).length
)
const pendingCount = computed(() =>
  downloads.filter((d) => d.status === DownloadStatus.Pending).length
)

/**
 * Pré-carrega título, thumbnail e formatos de um vídeo numa única chamada.
 * Usa `listFormats` (yt-dlp -j) que retorna tudo de uma vez.
 * Atualiza o item no store e salva o cache de formatos.
 *
 * @param item - Item de download cujas informações serão preenchidas
 */
async function prefetchVideoInfo(item: DownloadItem): Promise<void> {
  try {
    const cookieOptions = {
      useCookies: settings.useCookies,
      cookieBrowser: settings.cookieBrowser
    }

    const info = await window.api.listFormats(item.url, cookieOptions)

    // Atualiza título e thumbnail no card
    if (info.title) {
      item.title = info.title
    }
    if (info.thumbnail) {
      item.thumbnail = info.thumbnail
    }

    // Salva formatos no cache para o FormatDialog abrir instantaneamente
    cacheFormats(item.url, info.title, info.formats as unknown[])
  } catch {
    // Ignora erros — o card mostrará o URL como fallback
  } finally {
    item.loadingTitle = false
  }
}

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

    // Pré-carrega título + formatos em paralelo para cada URL
    for (const item of added) {
      prefetchVideoInfo(item)
    }
  }
}

async function handleStartDownload(item: DownloadItem): Promise<void> {
  item.status = DownloadStatus.Downloading
  item.error = ''

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
      mergeFormat: settings.mergeFormat
    })
  } catch (err: unknown) {
    markError(item.id, err instanceof Error ? err.message : String(err))
  }
}

function handleCancelDownload(item: DownloadItem): void {
  window.api.cancelDownload(item.id)
  item.status = DownloadStatus.Cancelled
}

function handleRetryDownload(item: DownloadItem): void {
  item.status = DownloadStatus.Pending
  item.percent = 0
  item.speed = ''
  item.eta = ''
  item.error = ''
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
  const pendingItems = downloads.filter((d) => d.status === DownloadStatus.Pending)
  for (const item of pendingItems) {
    handleStartDownload(item)
  }
}

let unsubProgress: (() => void) | null = null
let unsubComplete: (() => void) | null = null
let unsubError: (() => void) | null = null
let unsubClipboard: (() => void) | null = null

onMounted(async () => {
  initTheme()

  try {
    const ytdlpStatus = await window.api.checkDep('yt-dlp')
    ytdlpOk.value = ytdlpStatus.installed

    const ffmpegStatus = await window.api.checkDep('ffmpeg')
    ffmpegOk.value = ffmpegStatus.installed
  } catch {
    // ignora
  }

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
      }
    }
  })
})

onBeforeUnmount(() => {
  unsubProgress?.()
  unsubComplete?.()
  unsubError?.()
  unsubClipboard?.()
})
</script>
