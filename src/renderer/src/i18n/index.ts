/**
 * Sistema de internacionalização (i18n) leve para o app.
 * Suporta inglês (en) e português brasileiro (pt-BR).
 * Usa um ref reativo do Vue para que a troca de idioma atualize a UI automaticamente.
 */

import { ref, computed } from 'vue'

// ── Tipos ──

export type Locale = 'en' | 'pt-BR'

type TranslationMap = Record<string, string>

// ── Dicionários de tradução ──

const translations: Record<Locale, TranslationMap> = {
  en: {
    // Navegação
    'nav.downloads': 'Downloads',
    'nav.settings': 'Settings',

    // Input de URL
    'url.placeholder': 'Paste YouTube URLs here (one per line)...',
    'url.add': 'Add',
    'url.paste_tooltip': 'Paste from clipboard',

    // Estado vazio
    'empty.title': 'No downloads in queue.',
    'empty.subtitle': 'Paste YouTube URLs above or copy a URL to detect automatically.',

    // Lista de downloads
    'downloads.items': '{count} item(s) · {completed} completed',
    'downloads.start_all': 'Start All',
    'downloads.clear_completed': 'Clear Completed',

    // Card de download
    'status.pending': 'Queued',
    'status.downloading': 'Downloading',
    'status.complete': 'Complete',
    'status.error': 'Error',
    'status.cancelled': 'Cancelled',
    'action.start': 'Start Download',
    'action.pick_format': 'Select Quality',
    'action.cancel': 'Cancel',
    'action.retry': 'Retry',
    'action.remove': 'Remove',
    'action.copy_url': 'Copy URL',

    // Diálogo de formatos
    'format.title': 'Formats — {title}',
    'format.loading': 'Loading formats...',
    'format.cancel': 'Cancel',
    'format.select': 'Select',
    'format.col.id': 'ID',
    'format.col.ext': 'Ext',
    'format.col.resolution': 'Resolution',
    'format.col.fps': 'FPS',
    'format.col.size': 'Size',
    'format.col.video': 'Video',
    'format.col.audio': 'Audio',
    'format.col.type': 'Type',
    'format.col.note': 'Note',
    'format.merge_audio': 'Merge with best audio',
    'format.merge_audio_hint': 'Adds +bestaudio for video-only formats',

    // Configurações
    'settings.title': 'Settings',
    'settings.cookies': 'Cookies',
    'settings.use_cookies': 'Use browser cookies',
    'settings.browser': 'Browser',
    'settings.browser_placeholder': 'Select',
    'settings.output': 'Output',
    'settings.output_dir': 'Download directory',
    'settings.output_dir_placeholder': 'Select a directory...',
    'settings.merge_format': 'Merge format',
    'settings.quality': 'Default Quality',
    'settings.default_format': 'Default format',
    'settings.dependencies': 'Dependencies',
    'settings.not_installed': 'Not installed',
    'settings.install': 'Install',
    'settings.theme': 'Theme',

    // Opções de formato padrão
    'format_option.best_video_audio': 'Best Video + Audio',
    'format_option.best_single': 'Best (single file)',
    'format_option.audio_only': 'Audio Only (best)',
    'format_option.1080p': '1080p + Best Audio',
    'format_option.720p': '720p + Best Audio',
    'format_option.480p': '480p + Best Audio',

    // Toasts / Notificações
    'toast.urls_added': 'URLs added',
    'toast.urls_added_detail': '{count} URL(s) added to queue',
    'toast.download_complete': 'Download Complete',
    'toast.download_complete_detail': 'Download finished successfully!',
    'toast.url_detected': 'URL Detected',
    'toast.url_detected_detail': '{count} YouTube URL(s) detected in clipboard',
    'toast.format_selected': 'Format selected',
    'toast.format_selected_detail': 'Format {id} selected',

    // Notificações nativas
    'notification.url_detected': 'YouTube URL detected: {url}',
    'notification.download_complete_title': 'Download Complete',
    'notification.download_complete_body': 'Download finished successfully!',

    // Idioma
    'lang.label': 'Language'
  },

  'pt-BR': {
    // Navegação
    'nav.downloads': 'Downloads',
    'nav.settings': 'Configurações',

    // Input de URL
    'url.placeholder': 'Cole URLs do YouTube aqui (uma por linha)...',
    'url.add': 'Adicionar',
    'url.paste_tooltip': 'Colar da área de transferência',

    // Estado vazio
    'empty.title': 'Nenhum download na fila.',
    'empty.subtitle': 'Cole URLs do YouTube acima ou copie uma URL para detectar automaticamente.',

    // Lista de downloads
    'downloads.items': '{count} item(ns) · {completed} concluído(s)',
    'downloads.start_all': 'Iniciar Todos',
    'downloads.clear_completed': 'Limpar Concluídos',

    // Card de download
    'status.pending': 'Na Fila',
    'status.downloading': 'Baixando',
    'status.complete': 'Concluído',
    'status.error': 'Erro',
    'status.cancelled': 'Cancelado',
    'action.start': 'Iniciar Download',
    'action.pick_format': 'Selecionar Qualidade',
    'action.cancel': 'Cancelar',
    'action.retry': 'Tentar Novamente',
    'action.remove': 'Remover',
    'action.copy_url': 'Copiar URL',

    // Diálogo de formatos
    'format.title': 'Formatos — {title}',
    'format.loading': 'Carregando formatos...',
    'format.cancel': 'Cancelar',
    'format.select': 'Selecionar',
    'format.col.id': 'ID',
    'format.col.ext': 'Ext',
    'format.col.resolution': 'Resolução',
    'format.col.fps': 'FPS',
    'format.col.size': 'Tamanho',
    'format.col.video': 'Vídeo',
    'format.col.audio': 'Áudio',
    'format.col.type': 'Tipo',
    'format.col.note': 'Nota',
    'format.merge_audio': 'Mesclar com melhor áudio',
    'format.merge_audio_hint': 'Adiciona +bestaudio para formatos sem áudio',

    // Configurações
    'settings.title': 'Configurações',
    'settings.cookies': 'Cookies',
    'settings.use_cookies': 'Usar cookies do navegador',
    'settings.browser': 'Navegador',
    'settings.browser_placeholder': 'Selecione',
    'settings.output': 'Saída',
    'settings.output_dir': 'Diretório de download',
    'settings.output_dir_placeholder': 'Selecione um diretório...',
    'settings.merge_format': 'Formato de merge',
    'settings.quality': 'Qualidade Padrão',
    'settings.default_format': 'Formato padrão',
    'settings.dependencies': 'Dependências',
    'settings.not_installed': 'Não instalado',
    'settings.install': 'Instalar',
    'settings.theme': 'Tema',

    // Opções de formato padrão
    'format_option.best_video_audio': 'Melhor Vídeo + Áudio',
    'format_option.best_single': 'Melhor (single file)',
    'format_option.audio_only': 'Apenas Áudio (melhor)',
    'format_option.1080p': '1080p + Melhor Áudio',
    'format_option.720p': '720p + Melhor Áudio',
    'format_option.480p': '480p + Melhor Áudio',

    // Toasts / Notificações
    'toast.urls_added': 'URLs adicionadas',
    'toast.urls_added_detail': '{count} URL(s) adicionada(s) à fila',
    'toast.download_complete': 'Download Concluído',
    'toast.download_complete_detail': 'O download foi finalizado com sucesso!',
    'toast.url_detected': 'URL Detectada',
    'toast.url_detected_detail': '{count} URL(s) do YouTube detectada(s) na área de transferência',
    'toast.format_selected': 'Formato selecionado',
    'toast.format_selected_detail': 'Formato {id} selecionado',

    // Notificações nativas
    'notification.url_detected': 'YouTube URL detectada: {url}',
    'notification.download_complete_title': 'Download Concluído',
    'notification.download_complete_body': 'Download finalizado com sucesso!',

    // Idioma
    'lang.label': 'Idioma'
  }
}

// ── Estado reativo ──

/** Idioma atual do app (reativo, muda a UI ao trocar) */
const currentLocale = ref<Locale>('pt-BR')

/**
 * Traduz uma chave para o idioma atual.
 * Suporta interpolação simples: `{variavel}` é substituído por valores do objeto `params`.
 *
 * @param key - Chave de tradução (ex: 'toast.urls_added')
 * @param params - Objeto com valores para interpolação (ex: { count: 3 })
 * @returns Texto traduzido, ou a própria chave se não encontrada
 */
function t(key: string, params?: Record<string, string | number>): string {
  let text = translations[currentLocale.value][key] || key

  // Interpolação: substitui {variavel} pelos valores passados
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }

  return text
}

/**
 * Hook composable do Vue para usar o sistema de tradução nos componentes.
 * Retorna funções e estado reativos.
 */
export function useI18n() {
  /** Alterna entre os idiomas disponíveis */
  function toggleLocale(): void {
    currentLocale.value = currentLocale.value === 'pt-BR' ? 'en' : 'pt-BR'
  }

  /** Define um idioma específico */
  function setLocale(locale: Locale): void {
    currentLocale.value = locale
  }

  /** Label do idioma atual para exibição */
  const localeLabel = computed(() => (currentLocale.value === 'pt-BR' ? '🇧🇷 PT-BR' : '🇺🇸 EN'))

  return {
    t,
    currentLocale,
    toggleLocale,
    setLocale,
    localeLabel
  }
}
