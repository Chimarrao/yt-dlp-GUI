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
 *
 * Permite ao usuário:
 * - Digitar/colar URLs do YouTube no textarea (uma por linha)
 * - Clicar em "Adicionar" ou pressionar Ctrl+Enter para enviar
 * - Clicar no botão de clipboard para colar automaticamente
 *
 * Extrai URLs válidas do YouTube do texto usando regex compartilhada
 * e emite o evento 'add-urls' com as URLs encontradas.
 */

import { ref } from 'vue'
import Button from 'primevue/button'
import Tooltip from 'primevue/tooltip'
import { useI18n } from '../i18n'
import { YOUTUBE_URL_REGEX } from '../../../shared/constants'

// Registro da diretiva de tooltip do PrimeVue
const vTooltip = Tooltip

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'add-urls', urls: string[]): void
}>()

const urlText = ref('')

/**
 * Extrai todas as URLs do YouTube de um texto usando a regex compartilhada.
 * Remove duplicatas automaticamente via Set.
 *
 * @param text - Texto contendo possíveis URLs
 * @returns Array de URLs únicas encontradas
 */
function extractUrls(text: string): string[] {
  const matches = text.match(YOUTUBE_URL_REGEX)
  if (!matches) {
    return []
  }
  return [...new Set(matches)]
}

/**
 * Trata a ação de adicionar URLs.
 * Extrai URLs do texto, emite o evento e limpa o textarea.
 */
function handleAdd(): void {
  const urls = extractUrls(urlText.value)
  if (urls.length > 0) {
    emit('add-urls', urls)
    urlText.value = ''
  }
}

/**
 * Cola o conteúdo da área de transferência no textarea.
 * Usa a Clipboard API do navegador (disponível no Electron).
 */
async function handlePaste(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      urlText.value = text
    }
  } catch {
    // Fallback silencioso — o textarea já suporta Ctrl+V nativamente
  }
}
</script>
