/**
 * Ponto de entrada do processo principal (Main Process) do Electron.
 *
 * Este é o primeiro código que roda quando o app inicia. Ele:
 * 1. Cria a janela principal (BrowserWindow) com tamanho proporcional à tela
 * 2. Registra todos os handlers IPC — são os "endpoints" que o renderer pode chamar
 * 3. Inicia o monitoramento da clipboard para detectar URLs do YouTube
 *
 * Comunicação Main ↔ Renderer:
 * - O renderer NÃO tem acesso direto ao Node.js/sistema operacional
 * - Para executar ações no SO, o renderer envia mensagens IPC (Inter-Process Communication)
 * - O main recebe essas mensagens nos handlers abaixo e executa a ação solicitada
 * - Cada `ipcMain.handle(canal, callback)` registra um handler para um canal específico
 * - No renderer, a chamada correspondente é `window.api.nomeDaFuncao()` (definido no preload)
 */

import { app, shell, BrowserWindow, ipcMain, dialog, screen, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { checkDep, ensureDep } from './deps'
import { startClipboardWatcher, stopClipboardWatcher } from './clipboard'
import {
  startDownload,
  cancelDownload,
  listFormats,
  fetchQuickInfo,
  DownloadOptions,
  CookieOptions
} from './ytdlp'

/** Referência global para a janela principal */
let mainWindow: BrowserWindow | null = null

/**
 * Cria a janela principal do app.
 * O tamanho é proporcional à tela do usuário (75% de largura e altura).
 */
function createWindow(): void {
  // Calcula dimensões proporcionais ao display principal
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
  const windowWidth = Math.round(screenWidth * 0.75)
  const windowHeight = Math.round(screenHeight * 0.75)

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
  })

  // Só mostra a janela quando ela estiver pronta (evita flash branco)
  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  // Links externos abrem no navegador padrão, não dentro do app
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Em desenvolvimento carrega do dev server (com hot-reload), em produção carrega o HTML estático
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Inicia o monitoramento da clipboard
  startClipboardWatcher(mainWindow)

  // Limpa recursos quando a janela for fechada
  mainWindow.on('closed', () => {
    stopClipboardWatcher()
    mainWindow = null
  })
}

/**
 * Inicialização do app — executado quando o Electron termina de carregar.
 */
app.whenReady().then(() => {
  // Configura o ID do app para notificações no Windows
  electronApp.setAppUserModelId('com.electron')

  // Verifica se yt-dlp/ffmpeg estão instalados e retorna status
  ipcMain.handle('deps:check', async (_, name: 'yt-dlp' | 'ffmpeg') => {
    return checkDep(name)
  })

  // Instala yt-dlp/ffmpeg se não estiverem disponíveis
  ipcMain.handle('deps:install', async (_, name: 'yt-dlp' | 'ffmpeg') => {
    return ensureDep(name)
  })

  // ── Handlers IPC: Operações do yt-dlp ──
  // Busca rápida de título e thumbnail de um vídeo (sem baixar)
  ipcMain.handle(
    'ytdlp:quick-info',
    async (_, url: string, cookies?: CookieOptions) => {
      return fetchQuickInfo(url, cookies)
    }
  )

  // Consulta os formatos disponíveis de um vídeo (resolução, codec, tamanho)
  // Passa cookies para que o YouTube libere formatos 4K e premium
  ipcMain.handle(
    'ytdlp:list-formats',
    async (_, url: string, cookies?: CookieOptions) => {
      return listFormats(url, cookies)
    }
  )

  // Inicia o download de um vídeo com as opções fornecidas
  ipcMain.handle('ytdlp:download', async (_, options: DownloadOptions) => {
    if (!mainWindow) {
      return;
    }
    await startDownload(options, mainWindow)
  })

  // Cancela um download em andamento pelo seu ID
  ipcMain.handle('ytdlp:cancel', async (_, id: string) => {
    return cancelDownload(id)
  })

  // ── Handlers IPC: Diálogos do sistema operacional ──
  // Abre o seletor nativo de diretórios e retorna o caminho escolhido
  ipcMain.handle('dialog:select-directory', async () => {
    if (!mainWindow) {
      return null;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── Handlers IPC: Notificações nativas ──
  // Exibe uma notificação do sistema operacional (title, body)
  ipcMain.on('notify', (_, data: { title: string; body: string }) => {
    const notification = new Notification({
      title: data.title,
      body: data.body,
      silent: false
    })
    notification.show()
  })

  createWindow()

  // No macOS, recria a janela se o ícone no dock for clicado e não houver janelas abertas
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Encerra o app quando todas as janelas forem fechadas (exceto no macOS, que mantém na dock)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
