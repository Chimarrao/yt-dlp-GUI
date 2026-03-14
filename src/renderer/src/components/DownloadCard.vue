<template>
  <div class="download-card" :class="item.status">
    <div class="download-card-header">
      <!-- Thumbnail com skeleton -->
      <img v-if="item.thumbnail" :src="item.thumbnail" class="download-card-thumb" alt="" />
      <div v-else class="download-card-thumb" :class="{ 'skeleton-pulse': item.loadingTitle }">
        <i
          v-if="!item.loadingTitle"
          class="pi pi-video"
          style="font-size: 18px; color: var(--text-secondary)"
        ></i>
      </div>

      <!-- Título + URL + formato + stage -->
      <div class="download-card-info">
        <div v-if="item.loadingTitle" class="download-card-title skeleton-text">
          <span class="skeleton-bar"></span>
        </div>
        <div v-else class="download-card-title">{{ item.title || item.url }}</div>

        <div class="download-card-url-row">
          <span class="download-card-url">{{ item.url }}</span>
          <i
            v-tooltip.bottom="t('action.copy_url')"
            class="pi pi-copy copy-url-btn"
            style="font-size: 12px"
            @click="copyUrl"
          ></i>
        </div>

        <!-- Meta: formato + etapa + retry -->
        <div class="download-card-meta">
          <span
            v-if="formatBadgeLabel"
            v-tooltip.bottom="item.formatId"
            class="format-badge"
          >
            {{ formatBadgeLabel }}
          </span>
          <span
            v-if="item.status === DownloadStatus.Downloading && item.stage !== 'queued'"
            class="stage-badge"
          >
            {{ t(`stage.${item.stage}`) }}
          </span>
          <span v-if="item.isRetrying" class="retry-badge">
            {{ t('retry.indicator', { n: item.retryCount }) }}
          </span>
        </div>
      </div>

      <!-- Status -->
      <span class="status-badge" :class="item.status">{{ statusLabel }}</span>

      <!-- Ações -->
      <div class="download-card-actions">
        <Button
          v-if="item.status === DownloadStatus.Pending"
          v-tooltip.bottom="t('action.start')"
          icon="pi pi-play"
          severity="success"
          size="small"
          text
          rounded
          @click="$emit('start', item)"
        />
        <Button
          v-if="item.status === DownloadStatus.Pending"
          v-tooltip.bottom="t('action.pick_format')"
          icon="pi pi-list"
          severity="info"
          size="small"
          text
          rounded
          @click="$emit('pick-format', item)"
        />
        <Button
          v-if="item.status === DownloadStatus.Downloading"
          v-tooltip.bottom="t('action.cancel')"
          icon="pi pi-times"
          severity="danger"
          size="small"
          text
          rounded
          @click="$emit('cancel', item)"
        />
        <Button
          v-if="item.status === DownloadStatus.Error"
          v-tooltip.bottom="t('action.retry')"
          icon="pi pi-replay"
          severity="warn"
          size="small"
          text
          rounded
          @click="$emit('retry', item)"
        />
        <Button
          v-tooltip.bottom="t('action.remove')"
          icon="pi pi-trash"
          severity="danger"
          size="small"
          text
          rounded
          @click="$emit('remove', item)"
        />
      </div>
    </div>

    <!-- Progresso -->
    <div
      v-if="item.status === DownloadStatus.Downloading || item.status === DownloadStatus.Complete"
      class="download-card-progress"
    >
      <ProgressBar :value="item.percent" :show-value="false" />
    </div>

    <!-- Stats -->
    <div v-if="item.status === DownloadStatus.Downloading" class="download-card-stats">
      <span><i class="pi pi-percentage"></i> {{ item.percent.toFixed(1) }}%</span>
      <span><i class="pi pi-bolt"></i> {{ item.speed || '—' }}</span>
      <span><i class="pi pi-clock"></i> {{ item.eta || '—' }}</span>
    </div>

    <!-- Erro -->
    <div v-if="item.error && item.status === DownloadStatus.Error" class="download-card-error">
      <i class="pi pi-exclamation-triangle" style="margin-right: 6px"></i>{{ item.error }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Card de download individual.
 *
 * Mostra skeleton, etapas, retry indicator e o formato selecionado
 * com rótulo amigável (ex: "1080p · H.264" em vez de "137+bestaudio").
 */

import { computed } from 'vue'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tooltip from 'primevue/tooltip'
import { useToast } from 'primevue/usetoast'
import { type DownloadItem, DownloadStatus, useDownloads } from '../stores/downloads'
import { useI18n } from '../i18n'
import { isGenericFormatSelector, codecLabel } from '../utils/format-selection'

const vTooltip = Tooltip
const { t } = useI18n()
const toast = useToast()
const { getCachedFormats } = useDownloads()

const props = defineProps<{
  item: DownloadItem
}>()

defineEmits<{
  (e: 'start', item: DownloadItem): void
  (e: 'cancel', item: DownloadItem): void
  (e: 'retry', item: DownloadItem): void
  (e: 'remove', item: DownloadItem): void
  (e: 'pick-format', item: DownloadItem): void
}>()

const statusLabel = computed(() => t(`status.${props.item.status}`))

interface CachedFormatEntry {
  format_id: string
  height: number | null
  fps: number | null
  vcodec: string
  acodec: string
}

/**
 * Rótulo amigável do formato selecionado para exibir no badge.
 *
 * - Seletores genéricos → nome traduzido (ex: "Melhor Vídeo + Áudio")
 * - IDs concretos com cache disponível → "1080p · H.264" ou "1080p60 · VP9"
 * - IDs sem cache → o próprio ID bruto (fallback seguro)
 */
const formatBadgeLabel = computed((): string => {
  const fid = props.item.formatId
  if (!fid) return ''

  // Mapeamento de seletores genéricos para nomes legíveis
  const genericMap: Record<string, string> = {
    'bestvideo+bestaudio': t('format_option.best_video_audio'),
    best: t('format_option.best_single'),
    bestaudio: t('format_option.audio_only'),
    'bestvideo[height<=1080]+bestaudio': t('format_option.1080p'),
    'bestvideo[height<=720]+bestaudio': t('format_option.720p'),
    'bestvideo[height<=480]+bestaudio': t('format_option.480p')
  }
  if (genericMap[fid]) return genericMap[fid]

  // Seletor de altura genérico não mapeado → exibe como "≤Xp + áudio"
  if (isGenericFormatSelector(fid)) {
    const heightMatch = fid.match(/height<=(\d+)/)
    if (heightMatch) {
      return `≤${heightMatch[1]}p + ${t('format.type.audio')}`
    }
    return fid
  }

  // ID concreto → tenta enriquecer com dados do cache de formatos
  const cached = getCachedFormats(props.item.url)
  if (!cached?.formats) return fid

  const primaryId = fid.split('+')[0]
  const fmt = (cached.formats as CachedFormatEntry[]).find((f) => f.format_id === primaryId)
  if (!fmt) return fid

  const parts: string[] = []
  if (fmt.height) {
    const fps = fmt.fps && fmt.fps > 30 ? `${fmt.fps}fps` : ''
    parts.push(`${fmt.height}p${fps}`)
  }
  const vc = codecLabel(fmt.vcodec)
  if (vc) parts.push(vc)

  return parts.length > 0 ? parts.join(' · ') : fid
})

async function copyUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.item.url)
    toast.add({ severity: 'info', summary: t('toast.url_copied'), life: 1500 })
  } catch {
    // fallback silencioso
  }
}
</script>

<style scoped>
.skeleton-pulse {
  animation: skeleton-shimmer 1.5s infinite ease-in-out;
}
.skeleton-text {
  height: 16px;
  display: flex;
  align-items: center;
}
.skeleton-bar {
  display: inline-block;
  height: 12px;
  width: 60%;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--surface-border) 25%,
    var(--surface-section) 50%,
    var(--surface-border) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite ease-in-out;
}
@keyframes skeleton-shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.stage-badge {
  font-size: 11px;
  color: var(--accent-color);
  font-weight: 500;
}
.retry-badge {
  font-size: 11px;
  color: var(--warning-color);
  font-weight: 600;
}
</style>
