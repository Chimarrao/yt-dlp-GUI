<template>
  <Dialog
    v-model:visible="visible"
    :header="t('format.title', { title: videoTitle })"
    :modal="true"
    :style="{ width: '980px', maxWidth: '95vw' }"
    :closable="true"
    @hide="$emit('close')"
  >
    <div v-if="loading" style="text-align:center;padding:32px">
      <ProgressSpinner style="width:40px;height:40px" />
      <p style="margin-top:12px;color:var(--text-secondary)">{{ t('format.loading') }}</p>
    </div>

    <div v-else-if="errorMsg" style="padding:16px">
      <Message severity="error" :closable="false">{{ errorMsg }}</Message>
    </div>

    <div v-else>
      <!-- Resumo do formato selecionado — fixo no topo -->
      <div v-if="selectedFormat" class="selected-summary">
        <i class="pi pi-check-circle" style="color:var(--success-color);margin-right:6px"></i>
        <strong>{{ t('format.selected_summary', { resolution: getQualityLabel(selectedFormat.height, selectedFormat.resolution), vcodec: formatCodec(selectedFormat.vcodec), ext: selectedFormat.ext }) }}</strong>
        <span style="margin-left:auto;font-family:monospace;font-size:12px;color:var(--text-secondary)">-f {{ resolvedFormatId }}</span>
      </div>

      <!-- Toggle merge áudio -->
      <div style="display:flex;align-items:center;gap:12px;padding:8px 0 12px;border-bottom:1px solid var(--surface-border);margin-bottom:8px">
        <ToggleSwitch v-model="mergeWithBestAudio" />
        <label style="font-size:13px;color:var(--text-primary)">{{ t('format.merge_audio') }}</label>
        <span style="font-size:11px;color:var(--text-secondary);margin-left:auto">{{ t('format.merge_audio_hint') }}</span>
      </div>

      <!-- Tabela de formatos -->
      <div class="format-table-wrapper">
        <DataTable
          :value="formats"
          selectionMode="single"
          v-model:selection="selectedFormat"
          dataKey="format_id"
          :rows="25"
          scrollable
          scrollHeight="420px"
          size="small"
          stripedRows
          class="format-table"
        >
          <Column field="format_id" :header="t('format.col.id')" style="width:70px">
            <template #body="{ data }"><span class="cell-text">{{ data.format_id }}</span></template>
          </Column>
          <Column field="ext" :header="t('format.col.ext')" style="width:55px">
            <template #body="{ data }"><span class="cell-text">{{ data.ext }}</span></template>
          </Column>
          <Column :header="t('format.col.resolution')" style="width:140px" sortable field="height">
            <template #body="{ data }">
              <span :class="getQualityClass(data.height)" class="cell-text-bold">{{ getQualityLabel(data.height, data.resolution) }}</span>
            </template>
          </Column>
          <Column header="FPS" style="width:50px">
            <template #body="{ data }"><span class="cell-text">{{ data.fps || '—' }}</span></template>
          </Column>
          <Column :header="t('format.col.size')" style="width:90px">
            <template #body="{ data }">
              <span :class="getSizeClass(data)" class="cell-text">{{ formatFileSize(data) }}</span>
            </template>
          </Column>
          <Column :header="t('format.col.video')" style="width:80px">
            <template #body="{ data }">
              <span :class="data.vcodec === 'none' ? 'cell-muted' : 'cell-text'">{{ formatCodec(data.vcodec) }}</span>
            </template>
          </Column>
          <Column :header="t('format.col.audio')" style="width:80px">
            <template #body="{ data }">
              <span :class="data.acodec === 'none' ? 'cell-muted' : 'cell-text'">{{ formatCodec(data.acodec) }}</span>
            </template>
          </Column>
          <Column :header="t('format.col.type')" style="width:85px">
            <template #body="{ data }"><span :class="getTypeClass(data)">{{ getTypeLabel(data) }}</span></template>
          </Column>
          <Column field="format_note" :header="t('format.col.note')" style="min-width:70px">
            <template #body="{ data }"><span class="cell-text">{{ data.format_note }}</span></template>
          </Column>
        </DataTable>
      </div>
    </div>

    <template #footer>
      <Button :label="t('format.cancel')" severity="secondary" text @click="visible = false" />
      <Button :label="t('format.select')" icon="pi pi-check" :disabled="!selectedFormat" @click="handleSelect" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * Diálogo de seleção de formatos.
 * Usa cache, mostra resumo do formato selecionado no topo,
 * e estima tamanho com tbr*duration quando filesize é null.
 */

import { ref, watch, computed } from 'vue';
import Dialog from 'primevue/dialog';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';
import Message from 'primevue/message';
import ToggleSwitch from 'primevue/toggleswitch';
import { useI18n } from '../i18n';
import { useDownloads } from '../stores/downloads';

const { t } = useI18n();
const { settings, getCachedFormats, cacheFormats } = useDownloads();

interface FormatInfo {
  format_id: string;
  ext: string;
  resolution: string;
  height: number | null;
  fps: number | null;
  filesize: number | null;
  filesize_approx: number | null;
  vcodec: string;
  acodec: string;
  tbr: number | null;
  format_note: string;
}

const props = defineProps<{
  url: string;
  downloadId: string;
}>();

const emit = defineEmits<{
  (e: 'select', downloadId: string, formatId: string): void;
  (e: 'close'): void;
}>();

const visible = ref(true);
const loading = ref(true);
const errorMsg = ref('');
const videoTitle = ref('');
const videoDuration = ref(0);
const formats = ref<FormatInfo[]>([]);
const selectedFormat = ref<FormatInfo | null>(null);
const mergeWithBestAudio = ref(true);

const resolvedFormatId = computed(() => {
  if (!selectedFormat.value) {
    return '';
  }
  const fmt = selectedFormat.value;
  const isVideoOnly = fmt.vcodec !== 'none' && fmt.acodec === 'none';
  if (isVideoOnly && mergeWithBestAudio.value) {
    return `${fmt.format_id}+bestaudio`;
  }
  return fmt.format_id;
});

/** Formata tamanho com estimativa via tbr quando filesize é null */
function formatFileSize(data: FormatInfo): string {
  const bytes = data.filesize || data.filesize_approx;
  if (bytes) {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(0)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  // Estimativa via tbr * duration
  if (data.tbr && videoDuration.value > 0) {
    const estimatedBytes = (data.tbr * 1000 / 8) * videoDuration.value;
    if (estimatedBytes < 1024 * 1024) {
      return `~${(estimatedBytes / 1024).toFixed(0)} KB`;
    }
    if (estimatedBytes < 1024 * 1024 * 1024) {
      return `~${(estimatedBytes / 1024 / 1024).toFixed(0)} MB`;
    }
    return `~${(estimatedBytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  return '—';
}

/** Classe para tamanhos estimados vs reais */
function getSizeClass(data: FormatInfo): string {
  const bytes = data.filesize || data.filesize_approx;
  if (!bytes && data.tbr && videoDuration.value > 0) {
    return 'size-estimated';
  }
  return '';
}

function getQualityLabel(height: number | null, resolution: string): string {
  if (!height) {
    return resolution || 'Audio';
  }
  const labels: Record<number, string> = {
    4320: '8K', 2160: '4K', 1440: '2K', 1080: 'Full HD',
    720: 'HD', 480: 'SD', 360: '360p', 240: '240p', 144: '144p'
  };
  const label = labels[height];
  return label ? `${label} (${height}p)` : `${height}p`;
}

function getQualityClass(height: number | null): string {
  if (!height) { return 'quality-audio'; }
  if (height >= 2160) { return 'quality-4k'; }
  if (height >= 1080) { return 'quality-hd'; }
  return '';
}

function formatCodec(codec: string): string {
  if (codec === 'none') { return '—'; }
  if (codec.startsWith('avc1')) { return 'H.264'; }
  if (codec.startsWith('hev1') || codec.startsWith('hvc1')) { return 'H.265'; }
  if (codec.startsWith('av01')) { return 'AV1'; }
  if (codec.startsWith('vp09') || codec.startsWith('vp9')) { return 'VP9'; }
  if (codec.startsWith('vp08') || codec.startsWith('vp8')) { return 'VP8'; }
  if (codec.startsWith('mp4a')) { return 'AAC'; }
  if (codec.startsWith('opus')) { return 'Opus'; }
  if (codec.startsWith('ec-3')) { return 'E-AC3'; }
  return codec.split('.')[0];
}

function getTypeLabel(format: FormatInfo): string {
  const hasVideo = format.vcodec !== 'none';
  const hasAudio = format.acodec !== 'none';
  if (hasVideo && hasAudio) { return '🎬 V+A'; }
  if (hasVideo) { return '🎥 Video'; }
  return '🎵 Audio';
}

function getTypeClass(format: FormatInfo): string {
  const hasVideo = format.vcodec !== 'none';
  const hasAudio = format.acodec !== 'none';
  if (hasVideo && hasAudio) { return 'type-both'; }
  if (hasVideo) { return 'type-video'; }
  return 'type-audio';
}

function processFormats(rawFormats: FormatInfo[]): FormatInfo[] {
  const filtered = rawFormats.filter((f) => f.vcodec !== 'none' || f.acodec !== 'none');
  filtered.sort((a, b) => (b.height || 0) - (a.height || 0));
  return filtered;
}

async function loadFormats(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';

  try {
    const cached = getCachedFormats(props.url);
    if (cached) {
      videoTitle.value = cached.title;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      videoDuration.value = (cached as any).duration || 0;
      formats.value = processFormats(cached.formats as FormatInfo[]);
      loading.value = false;
      return;
    }

    const cookieOptions = {
      useCookies: settings.useCookies,
      cookieBrowser: settings.cookieBrowser
    };
    const info = await window.api.listFormats(props.url, cookieOptions);
    videoTitle.value = info.title;
    videoDuration.value = info.duration || 0;
    formats.value = processFormats(info.formats as FormatInfo[]);
    cacheFormats(props.url, info.title, info.formats as unknown[]);
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function handleSelect(): void {
  if (selectedFormat.value) {
    emit('select', props.downloadId, resolvedFormatId.value);
    visible.value = false;
  }
}

watch(
  () => props.url,
  () => { if (props.url) { loadFormats(); } },
  { immediate: true }
);
</script>

<style scoped>
.selected-summary {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  margin-bottom: 8px;
  background: rgba(0, 200, 83, 0.08);
  border: 1px solid rgba(0, 200, 83, 0.2);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary);
}

.cell-text { color: var(--text-primary); font-size: 12px; }
.cell-text-bold { font-size: 12px; font-weight: 500; }
.cell-muted { color: var(--text-secondary); opacity: 0.5; font-size: 12px; }
.size-estimated { color: var(--text-secondary); font-style: italic; }

.quality-4k { color: #fbbf24 !important; font-weight: 700; }
.quality-hd { color: #60a5fa !important; font-weight: 600; }
.quality-audio { color: var(--text-secondary); font-style: italic; }

.type-both { color: var(--success-color); font-weight: 600; font-size: 11px; }
.type-video { color: var(--accent-color); font-size: 11px; }
.type-audio { color: var(--warning-color); font-size: 11px; }

.format-table :deep(.p-datatable-tbody > tr > td) {
  padding: 6px 8px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary) !important;
}
.format-table :deep(.p-datatable-thead > tr > th) {
  padding: 8px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary) !important;
  background: var(--surface-section) !important;
}
.format-table :deep(.p-datatable-tbody > tr.p-highlight > td) {
  background: rgba(0, 200, 83, 0.15) !important;
  color: var(--text-primary) !important;
}
</style>
