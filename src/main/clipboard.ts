/**
 * Serviço de monitoramento da área de transferência.
 * 
 * Não encontrei algo no Electron que monitorasse a área de transferência.
 */

import { clipboard, Notification, BrowserWindow } from 'electron'
import { YOUTUBE_URL_REGEX, CLIPBOARD_POLL_INTERVAL_MS } from '../shared/constants'

/** Último texto lido da clipboard (para detectar mudanças) */
let lastClipboardText = ''

/** ID do intervalo ativo, para poder parar o watcher depois */
let pollingIntervalId: ReturnType<typeof setInterval> | null = null

/**
 * Inicia o monitoramento da área de transferência.
 *
 * @param mainWindow - Janela principal do Electron, usada para enviar eventos IPC ao renderer
 * @returns void
 */
export function startClipboardWatcher(mainWindow: BrowserWindow): void {
  // Salva o texto atual para não disparar logo no início
  lastClipboardText = clipboard.readText()

  pollingIntervalId = setInterval(() => {
    const currentText = clipboard.readText()

    // Se o texto não mudou, não precisa fazer nada
    if (currentText === lastClipboardText) {
      return
    }

    lastClipboardText = currentText

    // Tenta encontrar URLs do YouTube no texto copiado
    const matches = currentText.match(YOUTUBE_URL_REGEX)

    if (!matches || matches.length === 0) {
      return
    }

    // Remove duplicatas caso o mesmo link apareça múltiplas vezes
    const uniqueUrls = [...new Set(matches)]

    // Envia as URLs encontradas para o processo do renderer
    mainWindow.webContents.send('clipboard:youtube-url', uniqueUrls)

    // Exibe uma notificação nativa do sistema operacional
    const extraCount = uniqueUrls.length > 1 ? ` (+${uniqueUrls.length - 1})` : ''
    const notification = new Notification({
      title: 'yt-dlp GUI',
      body: `YouTube URL detected: ${uniqueUrls[0]}${extraCount}`,
      silent: false
    })
    notification.show()
  }, CLIPBOARD_POLL_INTERVAL_MS)
}

/**
 * Para o monitoramento da área de transferência.
 * Deve ser chamado quando a janela for fechada para liberar recursos.
 */
export function stopClipboardWatcher(): void {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId)
    pollingIntervalId = null
  }
}
