/**
 * Sistema de temas do app.
 *
 * Gerencia múltiplos temas visuais com CSS variables.
 * Os temas são aplicados adicionando uma classe no elemento root (html).
 * O tema selecionado é salvo no localStorage para persistir entre sessões.
 *
 * Temas disponíveis:
 * - dark-purple: Roxo escuro (padrão atual)
 * - dark-monokai: Inspirado no Monokai (obrigatório pelo usuário)
 * - dark-default: Cinza escuro neutro
 * - light: Tema claro
 * - system: Segue a preferência do SO (light/dark)
 */

import { ref, watch, computed } from 'vue'

export type ThemeId = 'dark-purple' | 'dark-monokai' | 'dark-default' | 'light' | 'system'

export interface ThemeOption {
  id: ThemeId
  label: string
  icon: string
}

/** Lista de temas disponíveis para o seletor nas configurações */
export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'dark-purple', label: 'Dark Purple', icon: 'pi pi-moon' },
  { id: 'dark-monokai', label: 'Dark Monokai', icon: 'pi pi-code' },
  { id: 'dark-default', label: 'Dark Default', icon: 'pi pi-moon' },
  { id: 'light', label: 'Light', icon: 'pi pi-sun' },
  { id: 'system', label: 'System', icon: 'pi pi-desktop' }
]

/** Chave usada no localStorage para persistir a escolha do tema */
const STORAGE_KEY = 'ytdlp-gui-theme'

/** Tema atual selecionado pelo usuário */
const currentTheme = ref<ThemeId>(
  (localStorage.getItem(STORAGE_KEY) as ThemeId) || 'dark-purple'
)

/**
 * Detecta se o SO do usuário está no modo escuro.
 * Usa a media query prefers-color-scheme do CSS.
 */
function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Retorna o tema efetivo (resolve 'system' para o tema real do SO).
 */
const effectiveTheme = computed<ThemeId>(() => {
  if (currentTheme.value === 'system') {
    return systemPrefersDark() ? 'dark-default' : 'light'
  }
  return currentTheme.value
})

/**
 * Aplica o tema ao documento HTML.
 * Remove todas as classes de tema anteriores e adiciona a nova.
 */
function applyTheme(themeId: ThemeId): void {
  const root = document.documentElement

  // Remove todas as classes de tema existentes
  THEME_OPTIONS.forEach((t) => root.classList.remove(`theme-${t.id}`))
  root.classList.remove('theme-light', 'theme-dark-default', 'theme-dark-purple', 'theme-dark-monokai')

  // Aplica o tema efetivo
  const resolved = themeId === 'system'
    ? (systemPrefersDark() ? 'dark-default' : 'light')
    : themeId

  root.classList.add(`theme-${resolved}`)
}

/**
 * Composable do Vue para usar o sistema de temas nos componentes.
 */
export function useTheme() {
  /** Define o tema ativo e persiste no localStorage */
  function setTheme(themeId: ThemeId): void {
    currentTheme.value = themeId
    localStorage.setItem(STORAGE_KEY, themeId)
    applyTheme(themeId)
  }

  /** Inicializa o tema (deve ser chamado no onMounted do App.vue) */
  function initTheme(): void {
    applyTheme(currentTheme.value)

    // Escuta mudanças na preferência do SO para o tema 'system'
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentTheme.value === 'system') {
        applyTheme('system')
      }
    })
  }

  // Observa mudanças no tema e re-aplica automaticamente
  watch(currentTheme, (newTheme) => {
    applyTheme(newTheme)
  })

  return {
    currentTheme,
    effectiveTheme,
    setTheme,
    initTheme,
    themeOptions: THEME_OPTIONS
  }
}
