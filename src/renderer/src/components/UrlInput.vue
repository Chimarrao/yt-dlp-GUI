<template>
  <div class="url-input-wrapper">
    <textarea
      v-model="urlText"
      :placeholder="t('url.placeholder')"
      rows="2"
      @keydown.ctrl.enter="handleAdd"
      @keydown.meta.enter="handleAdd"
    ></textarea>
    <Button
      icon="pi pi-plus"
      :label="t('url.add')"
      :disabled="!urlText.trim()"
      @click="handleAdd"
      severity="contrast"
      size="small"
      style="height: 44px"
    />
    <Button
      icon="pi pi-clipboard"
      v-tooltip.bottom="t('url.paste_tooltip')"
      @click="handlePaste"
      severity="secondary"
      size="small"
      outlined
      style="height: 44px"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Componente de input de URLs.
 * Extrai URLs do YouTube do texto usando regex compartilhada.
 */

import { ref } from 'vue';
import Button from 'primevue/button';
import Tooltip from 'primevue/tooltip';
import { useI18n } from '../i18n';
import { YOUTUBE_URL_REGEX } from '../../../shared/constants';

const vTooltip = Tooltip;
const { t } = useI18n();

const emit = defineEmits<{
  (e: 'add-urls', urls: string[]): void;
}>();

const urlText = ref('');

function extractUrls(text: string): string[] {
  const matches = text.match(YOUTUBE_URL_REGEX);
  if (!matches) {
    return [];
  }
  return [...new Set(matches)];
}

function handleAdd(): void {
  const urls = extractUrls(urlText.value);
  if (urls.length > 0) {
    emit('add-urls', urls);
    urlText.value = '';
  }
}

async function handlePaste(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlText.value = text;
    }
  } catch {
    // fallback silencioso
  }
}
</script>
