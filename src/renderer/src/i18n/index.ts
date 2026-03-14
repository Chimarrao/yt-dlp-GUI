/**
 * Sistema de internacionalização (i18n) leve.
 * Suporta EN e PT-BR com troca reativa no Vue.
 */

import { ref, computed, type ComputedRef } from 'vue'

export type Locale = 'en' | 'pt-BR'
type TranslationMap = Record<string, string>

const translations: Record<Locale, TranslationMap> = {
  en: {
    'nav.downloads': 'Downloads',
    'nav.settings': 'Settings',

    'url.placeholder': 'Paste YouTube URLs here (one per line)...',
    'url.add': 'Add',
    'url.paste_tooltip': 'Paste from clipboard',

    'empty.title': 'No downloads in queue.',
    'empty.subtitle': 'Paste YouTube URLs above or copy a URL to detect automatically.',

    'downloads.items': '{count} item(s) · {completed} completed',
    'downloads.start_all': 'Start All',
    'downloads.clear_completed': 'Clear Completed',
    'downloads.speed_graph_title': 'Total speed (last seconds)',

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

    // Etapas de download
    'stage.queued': 'In Queue',
    'stage.analyzing': '🔍 Analyzing...',
    'stage.downloading_video': '⬇️ Downloading video',
    'stage.downloading_audio': '🎵 Downloading audio',
    'stage.merging': '🔗 Merging...',
    'stage.complete': '✅ Complete',

    // Tentativas
    'retry.indicator': '🔄 Attempt {n}/3',

    // Diálogo de formatos
    'format.title': 'Formats — {title}',
    'format.loading': 'Loading formats...',
    'format.cancel': 'Cancel',
    'format.select': 'Select',
    'format.selected_summary': 'Selected: {resolution} · {vcodec} · {ext}',
    'format.col.id': 'ID',
    'format.col.ext': 'Ext',
    'format.col.resolution': 'Resolution',
    'format.col.fps': 'FPS',
    'format.col.size': 'Size',
    'format.col.video': 'Video',
    'format.col.audio': 'Audio',
    'format.col.type': 'Type',
    'format.col.note': 'Note',
    'format.audio_only_short': 'Audio',
    'format.type.both': 'Video + Audio',
    'format.type.video': 'Video only',
    'format.type.audio': 'Audio only',
    'format.merge_audio': 'Merge with best audio',
    'format.merge_audio_hint': 'Adds +bestaudio for video-only formats',
    'format.size_estimated': '~{size}',

    // Configurações
    'settings.title': 'Settings',
    'settings.cookies': 'Cookies',
    'settings.use_cookies': 'Use browser cookies',
    'settings.browser': 'Browser',
    'settings.browser_placeholder': 'Select',
    'settings.cookies_file': 'cookies.txt file',
    'settings.cookies_file_placeholder': 'Optional: select exported cookies.txt',
    'settings.cookies_help_primary':
      'Use cookies when YouTube asks for authentication or bot confirmation.',
    'settings.cookies_help_file':
      'If you select a file, it must be a cookies.txt exported in Netscape format.',
    'settings.cookies_help_strategy':
      'For YouTube, the app can try browser cookies and the Netscape file automatically.',
    'settings.proxy': 'Proxy',
    'settings.proxy_placeholder': 'Optional, e.g. http://user:pass@host:port',
    'settings.proxy_hint': 'Useful when YouTube limits high resolutions by IP/session',
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
    'settings.downloads': 'Downloads',
    'settings.max_concurrent': 'Max simultaneous downloads',
    'settings.rate_limit': 'Speed limit',
    'settings.rate_limit_hint':
      'Approximate total limit. 0 = unlimited, e.g. 5M ≈ 5 MB/s split across active downloads.',
    'settings.rate_limit_invalid': 'Invalid speed limit. Use 0, 500K, 5M or 1G.',

    'format_option.best_video_audio': 'Best Video + Audio',
    'format_option.best_single': 'Best (single file)',
    'format_option.audio_only': 'Audio Only (best)',
    'format_option.1080p': '1080p + Best Audio',
    'format_option.720p': '720p + Best Audio',
    'format_option.480p': '480p + Best Audio',

    'toast.urls_added': 'URLs added',
    'toast.urls_added_detail': '{count} URL(s) added to queue',
    'toast.download_complete': 'Download Complete',
    'toast.download_complete_detail': 'Download finished successfully!',
    'toast.url_detected': 'URL Detected',
    'toast.url_detected_detail': '{count} YouTube URL(s) detected in clipboard',
    'toast.format_selected': 'Format selected',
    'toast.format_selected_detail': 'Format {id} selected',
    'toast.url_copied': 'URL copied',

    'notification.url_detected': 'YouTube URL detected: {url}',
    'notification.download_complete_title': 'Download Complete',
    'notification.download_complete_body': 'Download finished successfully!',

    'lang.label': 'Language'
  },

  'pt-BR': {
    'nav.downloads': 'Downloads',
    'nav.settings': 'Configurações',

    'url.placeholder': 'Cole URLs do YouTube aqui (uma por linha)...',
    'url.add': 'Adicionar',
    'url.paste_tooltip': 'Colar da área de transferência',

    'empty.title': 'Nenhum download na fila.',
    'empty.subtitle': 'Cole URLs do YouTube acima ou copie uma URL para detectar automaticamente.',

    'downloads.items': '{count} item(ns) · {completed} concluído(s)',
    'downloads.start_all': 'Iniciar Todos',
    'downloads.clear_completed': 'Limpar Concluídos',
    'downloads.speed_graph_title': 'Velocidade total (últimos segundos)',

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

    // Etapas
    'stage.queued': 'Na Fila',
    'stage.analyzing': '🔍 Analisando...',
    'stage.downloading_video': '⬇️ Baixando vídeo',
    'stage.downloading_audio': '🎵 Baixando áudio',
    'stage.merging': '🔗 Fazendo merge...',
    'stage.complete': '✅ Concluído',

    'retry.indicator': '🔄 Tentativa {n}/3',

    'format.title': 'Formatos — {title}',
    'format.loading': 'Carregando formatos...',
    'format.cancel': 'Cancelar',
    'format.select': 'Selecionar',
    'format.selected_summary': 'Selecionado: {resolution} · {vcodec} · {ext}',
    'format.col.id': 'ID',
    'format.col.ext': 'Ext',
    'format.col.resolution': 'Resolução',
    'format.col.fps': 'FPS',
    'format.col.size': 'Tamanho',
    'format.col.video': 'Vídeo',
    'format.col.audio': 'Áudio',
    'format.col.type': 'Tipo',
    'format.col.note': 'Nota',
    'format.audio_only_short': 'Áudio',
    'format.type.both': 'Vídeo + Áudio',
    'format.type.video': 'Somente vídeo',
    'format.type.audio': 'Somente áudio',
    'format.merge_audio': 'Mesclar com melhor áudio',
    'format.merge_audio_hint': 'Adiciona +bestaudio para formatos sem áudio',
    'format.size_estimated': '~{size}',

    'settings.title': 'Configurações',
    'settings.cookies': 'Cookies',
    'settings.use_cookies': 'Usar cookies do navegador',
    'settings.browser': 'Navegador',
    'settings.browser_placeholder': 'Selecione',
    'settings.cookies_file': 'Arquivo cookies.txt',
    'settings.cookies_file_placeholder': 'Opcional: selecione um cookies.txt exportado',
    'settings.cookies_help_primary':
      'Use cookies quando o YouTube pedir autenticação ou confirmação de bot.',
    'settings.cookies_help_file':
      'Se escolher um arquivo, ele precisa ser um cookies.txt exportado em formato Netscape.',
    'settings.cookies_help_strategy':
      'No YouTube, o app pode tentar automaticamente os cookies do navegador e o arquivo Netscape.',
    'settings.proxy': 'Proxy',
    'settings.proxy_placeholder': 'Opcional, ex: http://user:pass@host:porta',
    'settings.proxy_hint': 'Ajuda quando o YouTube limita resoluções altas por IP/sessão',
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
    'settings.downloads': 'Downloads',
    'settings.max_concurrent': 'Downloads simultâneos',
    'settings.rate_limit': 'Limite de velocidade',
    'settings.rate_limit_hint':
      'Limite total aproximado. 0 = ilimitado, ex: 5M ≈ 5 MB/s dividido entre downloads ativos.',
    'settings.rate_limit_invalid': 'Limite inválido. Use 0, 500K, 5M ou 1G.',

    'format_option.best_video_audio': 'Melhor Vídeo + Áudio',
    'format_option.best_single': 'Melhor (single file)',
    'format_option.audio_only': 'Apenas Áudio (melhor)',
    'format_option.1080p': '1080p + Melhor Áudio',
    'format_option.720p': '720p + Melhor Áudio',
    'format_option.480p': '480p + Melhor Áudio',

    'toast.urls_added': 'URLs adicionadas',
    'toast.urls_added_detail': '{count} URL(s) adicionada(s) à fila',
    'toast.download_complete': 'Download Concluído',
    'toast.download_complete_detail': 'O download foi finalizado com sucesso!',
    'toast.url_detected': 'URL Detectada',
    'toast.url_detected_detail': '{count} URL(s) do YouTube detectada(s) na área de transferência',
    'toast.format_selected': 'Formato selecionado',
    'toast.format_selected_detail': 'Formato {id} selecionado',
    'toast.url_copied': 'URL copiada',

    'notification.url_detected': 'YouTube URL detectada: {url}',
    'notification.download_complete_title': 'Download Concluído',
    'notification.download_complete_body': 'Download finalizado com sucesso!',

    'lang.label': 'Idioma'
  }
}

const currentLocale = ref<Locale>((localStorage.getItem('ytdlp-gui-locale') as Locale) || 'pt-BR')

function t(key: string, params?: Record<string, string | number>): string {
  let text = translations[currentLocale.value][key] || key

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }

  return text
}

export function useI18n(): {
  t: (key: string, params?: Record<string, string | number>) => string
  currentLocale: typeof currentLocale
  toggleLocale: () => void
  setLocale: (locale: Locale) => void
  localeLabel: ComputedRef<string>
} {
  function toggleLocale(): void {
    currentLocale.value = currentLocale.value === 'pt-BR' ? 'en' : 'pt-BR'
    localStorage.setItem('ytdlp-gui-locale', currentLocale.value)
  }

  function setLocale(locale: Locale): void {
    currentLocale.value = locale
    localStorage.setItem('ytdlp-gui-locale', locale)
  }

  const localeLabel = computed(() => (currentLocale.value === 'pt-BR' ? '🇧🇷 PT-BR' : '🇺🇸 EN'))

  return {
    t,
    currentLocale,
    toggleLocale,
    setLocale,
    localeLabel
  }
}
