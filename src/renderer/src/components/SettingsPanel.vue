<template>
  <div class="settings-view">
    <!-- Seção: Tema -->
    <div class="settings-section">
      <h3><i class="pi pi-palette" style="margin-right: 8px"></i>{{ t('settings.theme') }}</h3>
      <div class="settings-row">
        <label>{{ t('settings.theme') }}</label>
        <div class="theme-selector">
          <button
            v-for="theme in themeOptions"
            :key="theme.id"
            class="theme-chip"
            :class="{ active: currentTheme === theme.id }"
            @click="handleThemeChange(theme.id)"
          >
            <span class="theme-dot" :style="{ background: getThemeColor(theme.id) }"></span>
            {{ theme.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Seção: Downloads -->
    <div class="settings-section">
      <h3><i class="pi pi-download" style="margin-right: 8px"></i>{{ t('settings.downloads') }}</h3>
      <div class="settings-row">
        <label>{{ t('settings.max_concurrent') }}</label>
        <div style="display: flex; align-items: center; gap: 10px">
          <InputNumber
            v-model="settings.maxConcurrentDownloads"
            :min="1"
            :max="10"
            show-buttons
            style="width: 100px"
          />
        </div>
      </div>
      <div class="settings-row">
        <label>{{ t('settings.rate_limit') }}</label>
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
          <InputText
            v-model="settings.rateLimit"
            placeholder="0"
            style="width: 100px"
            @blur="handleRateLimitBlur"
          />
          <span style="font-size: 11px; color: var(--text-secondary)">{{
            t('settings.rate_limit_hint')
          }}</span>
          <small v-if="rateLimitError" class="settings-inline-error">{{ rateLimitError }}</small>
        </div>
      </div>
    </div>

    <!-- Seção: Cookies -->
    <div class="settings-section">
      <h3><i class="pi pi-lock" style="margin-right: 8px"></i>{{ t('settings.cookies') }}</h3>
      <div class="settings-row">
        <label>{{ t('settings.use_cookies') }}</label>
        <ToggleSwitch v-model="settings.useCookies" />
      </div>
      <div v-if="settings.useCookies" class="settings-row">
        <label>{{ t('settings.browser') }}</label>
        <Select
          v-model="settings.cookieBrowser"
          :options="browsers"
          option-label="label"
          option-value="value"
          :placeholder="t('settings.browser_placeholder')"
          style="width: 200px"
        />
      </div>
      <div v-if="settings.useCookies" class="settings-row">
        <label></label>
        <div class="settings-help-block">
          <small>{{ t('settings.cookies_help_primary') }}</small>
          <small>{{ t('settings.cookies_help_file') }}</small>
          <small>{{ t('settings.cookies_help_strategy') }}</small>
        </div>
      </div>
      <div v-if="settings.useCookies" class="settings-row">
        <label>{{ t('settings.cookies_file') }}</label>
        <div style="display: flex; gap: 8px; align-items: center; flex: 1">
          <InputText
            v-model="settings.cookiesFilePath"
            :placeholder="t('settings.cookies_file_placeholder')"
            style="flex: 1"
            readonly
          />
          <Button
            icon="pi pi-file"
            severity="secondary"
            outlined
            size="small"
            @click="pickCookiesFile"
          />
          <Button
            v-if="settings.cookiesFilePath"
            icon="pi pi-times"
            severity="secondary"
            text
            size="small"
            @click="clearCookiesFile"
          />
        </div>
      </div>
      <div v-if="settings.useCookies" class="settings-row">
        <label>{{ t('settings.proxy') }}</label>
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 1">
          <InputText
            v-model="settings.proxyUrl"
            :placeholder="t('settings.proxy_placeholder')"
            style="flex: 1"
          />
          <span style="font-size: 11px; color: var(--text-secondary)">{{
            t('settings.proxy_hint')
          }}</span>
        </div>
      </div>
    </div>

    <!-- Seção: Saída -->
    <div class="settings-section">
      <h3><i class="pi pi-folder" style="margin-right: 8px"></i>{{ t('settings.output') }}</h3>
      <div class="settings-row">
        <label>{{ t('settings.output_dir') }}</label>
        <div style="display: flex; gap: 8px; align-items: center; flex: 1">
          <InputText
            v-model="settings.outputDir"
            :placeholder="t('settings.output_dir_placeholder')"
            style="flex: 1"
            readonly
          />
          <Button
            icon="pi pi-folder-open"
            severity="secondary"
            outlined
            size="small"
            @click="pickDirectory"
          />
        </div>
      </div>
      <div class="settings-row">
        <label>{{ t('settings.merge_format') }}</label>
        <Select
          v-model="settings.mergeFormat"
          :options="mergeFormats"
          option-label="label"
          option-value="value"
          style="width: 200px"
        />
      </div>
    </div>

    <!-- Seção: Qualidade -->
    <div class="settings-section">
      <h3><i class="pi pi-sliders-h" style="margin-right: 8px"></i>{{ t('settings.quality') }}</h3>
      <div class="settings-row">
        <label>{{ t('settings.default_format') }}</label>
        <Select
          v-model="settings.defaultFormat"
          :options="defaultFormats"
          option-label="label"
          option-value="value"
          style="width: 260px"
        />
      </div>
    </div>

    <!-- Seção: Idioma -->
    <div class="settings-section">
      <h3><i class="pi pi-globe" style="margin-right: 8px"></i>{{ t('lang.label') }}</h3>
      <div class="settings-row">
        <label>{{ t('lang.label') }}</label>
        <Button
          :label="localeLabel"
          icon="pi pi-arrows-h"
          severity="secondary"
          outlined
          size="small"
          @click="handleLocaleChange"
        />
      </div>
    </div>

    <!-- Seção: Dependências -->
    <div class="settings-section">
      <h3>
        <i class="pi pi-wrench" style="margin-right: 8px"></i>{{ t('settings.dependencies') }}
      </h3>
      <div class="settings-row">
        <label>yt-dlp</label>
        <Tag
          :severity="ytdlpStatus?.installed ? 'success' : 'danger'"
          :value="ytdlpStatus?.installed ? `✓ ${ytdlpStatus.version}` : t('settings.not_installed')"
        />
        <Button
          v-if="!ytdlpStatus?.installed"
          :label="t('settings.install')"
          icon="pi pi-download"
          severity="warn"
          size="small"
          :loading="installingYtdlp"
          @click="handleInstallDep('yt-dlp')"
        />
      </div>
      <div class="settings-row">
        <label>ffmpeg</label>
        <Tag
          :severity="ffmpegStatus?.installed ? 'success' : 'danger'"
          :value="
            ffmpegStatus?.installed ? `✓ ${ffmpegStatus.version}` : t('settings.not_installed')
          "
        />
        <Button
          v-if="!ffmpegStatus?.installed"
          :label="t('settings.install')"
          icon="pi pi-download"
          severity="warn"
          size="small"
          :loading="installingFfmpeg"
          @click="handleInstallDep('ffmpeg')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Painel de configurações.
 * Inclui: tema, max downloads, rate limit, cookies, saída, qualidade, idioma, deps.
 * Mudanças são salvas automaticamente via auto-save no store.
 */

import { ref, onMounted, computed } from 'vue'
import ToggleSwitch from 'primevue/toggleswitch'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useDownloads, normalizeRateLimitInput, isValidRateLimit } from '../stores/downloads'
import { useI18n } from '../i18n'
import { useTheme, type ThemeId } from '../themes'

const { settings, scheduleSave } = useDownloads()
const { t, toggleLocale, localeLabel } = useI18n()
const { currentTheme, setTheme, themeOptions } = useTheme()

interface DepStatus {
  name: string
  installed: boolean
  path: string | null
  version: string | null
}

const ytdlpStatus = ref<DepStatus | null>(null)
const ffmpegStatus = ref<DepStatus | null>(null)
const installingYtdlp = ref(false)
const installingFfmpeg = ref(false)
const rateLimitError = ref('')

const browsers = [
  { label: 'Chrome', value: 'chrome' },
  { label: 'Firefox', value: 'firefox' },
  { label: 'Edge', value: 'edge' },
  { label: 'Brave', value: 'brave' },
  { label: 'Opera', value: 'opera' },
  { label: 'Safari', value: 'safari' },
  { label: 'Chromium', value: 'chromium' }
]

const mergeFormats = [
  { label: 'MKV', value: 'mkv' },
  { label: 'MP4', value: 'mp4' },
  { label: 'WebM', value: 'webm' }
]

const defaultFormats = computed(() => [
  { label: t('format_option.best_video_audio'), value: 'bestvideo+bestaudio' },
  { label: t('format_option.best_single'), value: 'best' },
  { label: t('format_option.audio_only'), value: 'bestaudio' },
  { label: t('format_option.1080p'), value: 'bestvideo[height<=1080]+bestaudio' },
  { label: t('format_option.720p'), value: 'bestvideo[height<=720]+bestaudio' },
  { label: t('format_option.480p'), value: 'bestvideo[height<=480]+bestaudio' }
])

function getThemeColor(themeId: ThemeId): string {
  const colors: Record<ThemeId, string> = {
    'dark-purple': '#667eea',
    'dark-monokai': '#a6e22e',
    'dark-default': '#5c9ce6',
    light: '#5c6bc0',
    system: '#888'
  }
  return colors[themeId]
}

function handleThemeChange(themeId: ThemeId): void {
  setTheme(themeId)
  scheduleSave()
}

function handleLocaleChange(): void {
  toggleLocale()
  scheduleSave()
}

async function checkDeps(): Promise<void> {
  ytdlpStatus.value = await window.api.checkDep('yt-dlp')
  ffmpegStatus.value = await window.api.checkDep('ffmpeg')
}

async function handleInstallDep(name: 'yt-dlp' | 'ffmpeg'): Promise<void> {
  if (name === 'yt-dlp') {
    installingYtdlp.value = true
  } else {
    installingFfmpeg.value = true
  }

  try {
    const status = await window.api.installDep(name)
    if (name === 'yt-dlp') {
      ytdlpStatus.value = status
    } else {
      ffmpegStatus.value = status
    }
  } catch (err) {
    console.error(`Failed to install ${name}:`, err)
  } finally {
    if (name === 'yt-dlp') {
      installingYtdlp.value = false
    } else {
      installingFfmpeg.value = false
    }
  }
}

async function pickDirectory(): Promise<void> {
  const selectedDir = await window.api.selectDirectory()
  if (selectedDir) {
    settings.outputDir = selectedDir
  }
}

async function pickCookiesFile(): Promise<void> {
  const selectedFile = await window.api.selectCookiesFile()
  if (selectedFile) {
    settings.cookiesFilePath = selectedFile
    scheduleSave()
  }
}

function clearCookiesFile(): void {
  settings.cookiesFilePath = ''
  scheduleSave()
}

function handleRateLimitBlur(): void {
  const normalized = normalizeRateLimitInput(settings.rateLimit)
  if (!isValidRateLimit(normalized)) {
    rateLimitError.value = t('settings.rate_limit_invalid')
    settings.rateLimit = '0'
    return
  }

  rateLimitError.value = ''
  settings.rateLimit = normalized
}

onMounted(async () => {
  if (!settings.outputDir) {
    settings.outputDir = '~/Downloads'
  }
  settings.rateLimit = normalizeRateLimitInput(settings.rateLimit)
  await checkDeps()
})
</script>

<style scoped>
.settings-inline-error {
  color: var(--danger-color);
  font-size: 11px;
}

.settings-help-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 11px;
}
</style>
