/**
 * Serviço de monitoramento da área de transferência.
 *
 * Não encontrei algo no Electron que monitorasse a área de transferência.
 */

import { clipboard, Notification, BrowserWindow } from 'electron';
import { YOUTUBE_URL_REGEX, CLIPBOARD_POLL_INTERVAL_MS } from '../shared/constants';

let lastClipboardText = '';
let pollingIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Inicia o monitoramento da área de transferência.
 *
 * @param mainWindow - Janela principal do Electron
 * @returns void
 */
export function startClipboardWatcher(mainWindow: BrowserWindow): void {
  lastClipboardText = clipboard.readText();

  pollingIntervalId = setInterval(() => {
    const currentText = clipboard.readText();

    if (currentText === lastClipboardText) {
      return;
    }

    lastClipboardText = currentText;

    const matches = currentText.match(YOUTUBE_URL_REGEX);

    if (!matches || matches.length === 0) {
      return;
    }

    const uniqueUrls = [...new Set(matches)];

    mainWindow.webContents.send('clipboard:youtube-url', uniqueUrls);

    const extraCount = uniqueUrls.length > 1 ? ` (+${uniqueUrls.length - 1})` : '';
    const notification = new Notification({
      title: 'yt-dlp GUI',
      body: `YouTube URL detected: ${uniqueUrls[0]}${extraCount}`,
      silent: false
    });
    notification.show();
  }, CLIPBOARD_POLL_INTERVAL_MS);
}

/**
 * Para o monitoramento da área de transferência.
 */
export function stopClipboardWatcher(): void {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
}
