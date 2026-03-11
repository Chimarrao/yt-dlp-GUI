<template>
  <div class="download-card" :class="item.status">
    <div class="download-card-header">
      <!-- Thumbnail com skeleton enquanto carrega -->
      <img
        v-if="item.thumbnail"
        :src="item.thumbnail"
        class="download-card-thumb"
        alt=""
      />
      <div v-else class="download-card-thumb" :class="{ 'skeleton-pulse': item.loadingTitle }">
        <i v-if="!item.loadingTitle" class="pi pi-video" style="font-size:18px;color:var(--text-secondary)"></i>
      </div>

      <!-- Título + URL copiável + formato -->
      <div class="download-card-info">
        <!-- Skeleton de título ou título real -->
        <div v-if="item.loadingTitle" class="download-card-title skeleton-text">
          <span class="skeleton-bar"></span>
        </div>
        <div v-else class="download-card-title">{{ item.title || item.url }}</div>

        <div class="download-card-url-row">
          <span class="download-card-url">{{ item.url }}</span>
          <i
            class="pi pi-copy copy-url-btn"
            style="font-size:12px"
            v-tooltip.bottom="t('action.copy_url')"
            @click="copyUrl"
          ></i>
        </div>
        <!-- Badge do formato selecionado -->
        <div class="download-card-meta" v-if="item.formatId && item.formatId !== 'bestvideo+bestaudio'">
          <span class="format-badge">{{ item.formatId }}</span>
        </div>
      </div>

      <!-- Badge de status -->
      <span class="status-badge" :class="item.status">{{ statusLabel }}</span>

      <!-- Botões de ação -->
      <div class="download-card-actions">
        <Button
          v-if="item.status === DownloadStatus.Pending"
          icon="pi pi-play"
          v-tooltip.bottom="t('action.start')"
          @click="$emit('start', item)"
          severity="success"
          size="small"
          text
          rounded
        />
        <Button
          v-if="item.status === DownloadStatus.Pending"
          icon="pi pi-list"
          v-tooltip.bottom="t('action.pick_format')"
          @click="$emit('pick-format', item)"
          severity="info"
          size="small"
          text
          rounded
        />
        <Button
          v-if="item.status === DownloadStatus.Downloading"
          icon="pi pi-times"
          v-tooltip.bottom="t('action.cancel')"
          @click="$emit('cancel', item)"
          severity="danger"
          size="small"
          text
          rounded
        />
        <Button
          v-if="item.status === DownloadStatus.Error"
          icon="pi pi-replay"
          v-tooltip.bottom="t('action.retry')"
          @click="$emit('retry', item)"
          severity="warn"
          size="small"
          text
          rounded
        />
        <Button
          icon="pi pi-trash"
          v-tooltip.bottom="t('action.remove')"
          @click="$emit('remove', item)"
          severity="danger"
          size="small"
          text
          rounded
        />
      </div>
    </div>

    <!-- Barra de progresso -->
    <div v-if="item.status === DownloadStatus.Downloading || item.status === DownloadStatus.Complete" class="download-card-progress">
      <ProgressBar :value="item.percent" :showValue="false" />
    </div>

    <!-- Stats -->
    <div v-if="item.status === DownloadStatus.Downloading" class="download-card-stats">
      <span><i class="pi pi-percentage"></i> {{ item.percent.toFixed(1) }}%</span>
      <span><i class="pi pi-bolt"></i> {{ item.speed || '—' }}</span>
      <span><i class="pi pi-clock"></i> {{ item.eta || '—' }}</span>
    </div>

    <!-- Erro -->
    <div v-if="item.error && item.status === DownloadStatus.Error" class="download-card-error">
      <i class="pi pi-exclamation-triangle" style="margin-right:6px"></i>{{ item.error }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Card de download individual.
 *
 * Exibe skeleton animado enquanto o título do vídeo está sendo buscado.
 * Quando o título chega (loadingTitle → false), exibe o nome real.
 * Mostra URL copiável com botão e badge do formato selecionado.
 */

import { computed } from 'vue'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tooltip from 'primevue/tooltip'
import { useToast } from 'primevue/usetoast'
import { type DownloadItem, DownloadStatus } from '../stores/downloads'
import { useI18n } from '../i18n'

const vTooltip = Tooltip
const { t } = useI18n()
const toast = useToast()

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

async function copyUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.item.url)
    toast.add({ severity: 'info', summary: 'URL copied', life: 1500 })
  } catch {
    // Fallback silencioso
  }
}
</script>

<style scoped>
/* Skeleton animado enquanto o título carrega */
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
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
</style>
