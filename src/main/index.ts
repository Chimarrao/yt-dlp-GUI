/**
 * Ponto de entrada do processo principal (Main Process) do Electron.
 *
 * Cria a janela principal, registra handlers IPC e
 * inicia o monitoramento da clipboard.
 */

import { app, shell, BrowserWindow, ipcMain, dialog, screen, Notification } from 'electron';
import { join } from 'path';
import { electronApp, is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';
import { checkDep, ensureDep } from './deps';
import { startClipboardWatcher, stopClipboardWatcher } from './clipboard';
import {
  startDownload,
  cancelDownload,
  listFormats,
  fetchQuickInfo,
  setMaxConcurrent,
  DownloadOptions,
  CookieOptions
} from './ytdlp';
import { loadSettings, saveSettings, PersistedSettings } from './settings-store';

/** Referência global para a janela principal */
let mainWindow: BrowserWindow | null = null;

/**
 * Cria a janela principal do app.
 * Tamanho proporcional à tela (75% de largura e altura).
 */
function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const windowWidth = Math.round(screenWidth * 0.75);
  const windowHeight = Math.round(screenHeight * 0.75);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  startClipboardWatcher(mainWindow);

  mainWindow.on('closed', () => {
    stopClipboardWatcher();
    mainWindow = null;
  });
}

/**
 * Inicialização do app.
 */
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron');

  // ── Handlers IPC: Dependências ──
  ipcMain.handle('deps:check', async (_, name: 'yt-dlp' | 'ffmpeg') => {
    return checkDep(name);
  });

  ipcMain.handle('deps:install', async (_, name: 'yt-dlp' | 'ffmpeg') => {
    return ensureDep(name);
  });

  // ── Handlers IPC: Configurações persistidas ──
  ipcMain.handle('settings:load', () => {
    return loadSettings();
  });

  ipcMain.handle('settings:save', (_, settings: PersistedSettings) => {
    saveSettings(settings);
    // Atualiza o limite de concorrência quando as settings mudam
    if (settings.maxConcurrentDownloads) {
      setMaxConcurrent(settings.maxConcurrentDownloads);
    }
  });

  // ── Handlers IPC: Operações do yt-dlp ──
  ipcMain.handle(
    'ytdlp:quick-info',
    async (_, url: string, cookies?: CookieOptions) => {
      return fetchQuickInfo(url, cookies);
    }
  );

  ipcMain.handle(
    'ytdlp:list-formats',
    async (_, url: string, cookies?: CookieOptions) => {
      return listFormats(url, cookies);
    }
  );

  ipcMain.handle('ytdlp:download', async (_, options: DownloadOptions) => {
    if (!mainWindow) {
      return;
    }
    await startDownload(options, mainWindow);
  });

  ipcMain.handle('ytdlp:cancel', async (_, id: string) => {
    return cancelDownload(id);
  });

  // ── Handlers IPC: Diálogos do SO ──
  ipcMain.handle('dialog:select-directory', async () => {
    if (!mainWindow) {
      return null;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── Handlers IPC: Notificações ──
  ipcMain.on('notify', (_, data: { title: string; body: string }) => {
    const notification = new Notification({
      title: data.title,
      body: data.body,
      silent: false
    });
    notification.show();
  });

  // Carrega settings no boot e aplica maxConcurrent
  const initialSettings = loadSettings();
  setMaxConcurrent(initialSettings.maxConcurrentDownloads);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
