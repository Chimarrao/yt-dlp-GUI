/**
 * Persistência de configurações do app em disco.
 *
 * Salva e carrega configurações de um arquivo JSON no
 * diretório de dados do Electron (app.getPath('userData')).
 * Isso garante que tema, cookies, formato etc. sobrevivam
 * entre sessões sem depender de electron-store.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/** Estrutura das configurações persistidas */
export interface PersistedSettings {
  theme: string;
  locale: string;
  useCookies: boolean;
  cookieBrowser: string;
  outputDir: string;
  defaultFormat: string;
  mergeFormat: string;
  maxConcurrentDownloads: number;
  rateLimit: string;
}

/** Valores padrão */
const DEFAULTS: PersistedSettings = {
  theme: 'dark-purple',
  locale: 'pt-BR',
  useCookies: true,
  cookieBrowser: 'chrome',
  outputDir: '~/Downloads',
  defaultFormat: 'bestvideo+bestaudio',
  mergeFormat: 'mkv',
  maxConcurrentDownloads: 3,
  rateLimit: '0'
};

/** Caminho do arquivo de configurações */
function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/**
 * Carrega configurações do disco.
 * Se o arquivo não existir, retorna os valores padrão.
 *
 * @returns Configurações persistidas
 */
export function loadSettings(): PersistedSettings {
  const filePath = getSettingsPath();

  if (!existsSync(filePath)) {
    return { ...DEFAULTS };
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Mescla com defaults para garantir que novos campos existam
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Salva configurações no disco.
 * Cria o diretório se não existir.
 *
 * @param settings - Configurações a serem salvas
 */
export function saveSettings(settings: PersistedSettings): void {
  const filePath = getSettingsPath();
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}
