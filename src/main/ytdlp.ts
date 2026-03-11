/**
 * Wrapper do yt-dlp para o processo main do Electron.
 *
 * Responsável por:
 * - Listar formatos disponíveis (`yt-dlp -j`)
 * - Gerenciar fila de downloads com limite de concorrência
 * - Detectar e emitir etapas do download (analisando, vídeo, áudio, merge)
 * - Auto-retry inteligente (continuar → limpar → recomeçar)
 * - Limitar velocidade de download (--limit-rate)
 */

import { spawn, ChildProcess } from 'child_process';
import { BrowserWindow, Notification } from 'electron';
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { checkDep } from './deps';

// ── Processos e fila ──

/** Mapa de processos ativos — permite cancelar downloads pelo ID */
const activeProcesses = new Map<string, ChildProcess>();

/** Fila de downloads pendentes aguardando slot */
const downloadQueue: Array<{
  options: DownloadOptions;
  mainWindow: BrowserWindow;
  retryCount: number;
}> = [];

/** Contador de downloads rodando agora */
let runningCount = 0;

/** Limite padrão de downloads simultâneos */
let maxConcurrent = 3;

// ── Interfaces ──

export interface DownloadOptions {
  id: string;
  url: string;
  outputDir: string;
  formatId?: string;
  useCookies: boolean;
  cookieBrowser: string;
  mergeFormat?: string;
  rateLimit?: string;
}

export interface CookieOptions {
  useCookies: boolean;
  cookieBrowser: string;
}

export interface FormatInfo {
  format_id: string;
  ext: string;
  resolution: string;
  height: number | null;
  fps: number | null;
  filesize: number | null;
  filesize_approx: number | null;
  vcodec: string;
  acodec: string;
  tbr: number | null;
  format_note: string;
}

export interface VideoInfo {
  id: string;
  title: string;
  thumbnail: string;
  duration: number;
  formats: FormatInfo[];
  url: string;
}

export interface QuickVideoInfo {
  title: string;
  thumbnail: string;
}

// ── Etapas do download ──
export type DownloadStage =
  | 'queued'
  | 'analyzing'
  | 'downloading_video'
  | 'downloading_audio'
  | 'merging'
  | 'complete';

// ── Funções internas ──

async function getYtdlpPath(): Promise<string> {
  const status = await checkDep('yt-dlp');
  if (!status.path) {
    throw new Error('yt-dlp not installed');
  }
  return status.path;
}

/**
 * Define o limite máximo de downloads simultâneos.
 *
 * @param max - Número máximo (1-10)
 */
export function setMaxConcurrent(max: number): void {
  maxConcurrent = Math.min(10, Math.max(1, max));
  processQueue();
}

/**
 * Retorna o limite atual de downloads simultâneos.
 */
export function getMaxConcurrent(): number {
  return maxConcurrent;
}

// ── Busca rápida ──

export async function fetchQuickInfo(
  url: string,
  cookies?: CookieOptions
): Promise<QuickVideoInfo> {
  const ytdlpPath = await getYtdlpPath();

  return new Promise((resolve) => {
    const args: string[] = [];

    if (cookies?.useCookies) {
      args.push('--cookies-from-browser', cookies.cookieBrowser);
    }

    args.push('--skip-download', '--no-playlist', '--print', '%(title)s\n%(thumbnail)s', url);

    const childProcess = spawn(ytdlpPath, args);
    let stdoutBuffer = '';

    childProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
    });

    childProcess.on('close', (exitCode) => {
      if (exitCode !== 0) {
        resolve({ title: '', thumbnail: '' });
        return;
      }

      const lines = stdoutBuffer.trim().split('\n');
      resolve({
        title: lines[0] || '',
        thumbnail: lines[1] || ''
      });
    });

    childProcess.on('error', () => {
      resolve({ title: '', thumbnail: '' });
    });
  });
}

// ── Listagem de formatos ──

export async function listFormats(url: string, cookies?: CookieOptions): Promise<VideoInfo> {
  const ytdlpPath = await getYtdlpPath();

  return new Promise((resolve, reject) => {
    const args: string[] = [];

    if (cookies?.useCookies) {
      args.push('--cookies-from-browser', cookies.cookieBrowser);
    }

    args.push('-j', '--no-playlist', url);

    const childProcess = spawn(ytdlpPath, args);

    let stdoutBuffer = '';
    let stderrBuffer = '';

    childProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
    });

    childProcess.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
    });

    childProcess.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stderrBuffer || `yt-dlp exited with code ${exitCode}`));
        return;
      }

      try {
        const rawData = JSON.parse(stdoutBuffer);

        const videoInfo: VideoInfo = {
          id: rawData.id,
          title: rawData.title || 'Unknown',
          thumbnail: rawData.thumbnail || '',
          duration: rawData.duration || 0,
          url,
          formats: (rawData.formats || []).map(
            (f: Record<string, unknown>): FormatInfo => ({
              format_id: String(f.format_id || ''),
              ext: String(f.ext || ''),
              resolution: String(f.resolution || 'audio only'),
              height: (f.height as number) || null,
              fps: (f.fps as number) || null,
              filesize: (f.filesize as number) || null,
              filesize_approx: (f.filesize_approx as number) || null,
              vcodec: String(f.vcodec || 'none'),
              acodec: String(f.acodec || 'none'),
              tbr: (f.tbr as number) || null,
              format_note: String(f.format_note || '')
            })
          )
        };

        resolve(videoInfo);
      } catch (parseError) {
        reject(new Error(`Failed to parse yt-dlp output: ${parseError}`));
      }
    });
  });
}

// ── Fila de downloads ──

/**
 * Processa a fila: inicia downloads pendentes se houver slots disponíveis.
 */
function processQueue(): void {
  while (runningCount < maxConcurrent && downloadQueue.length > 0) {
    const next = downloadQueue.shift();
    if (next) {
      executeDownload(next.options, next.mainWindow, next.retryCount);
    }
  }
}

/**
 * Entrada pública para iniciar um download.
 * Se o limite de concorrência foi atingido, o download entra na fila.
 *
 * @param options - Opções do download
 * @param mainWindow - Janela principal do Electron
 */
export async function startDownload(
  options: DownloadOptions,
  mainWindow: BrowserWindow
): Promise<void> {
  if (runningCount >= maxConcurrent) {
    // Coloca na fila e avisa o renderer
    downloadQueue.push({ options, mainWindow, retryCount: 0 });
    mainWindow.webContents.send('download:stage', {
      id: options.id,
      stage: 'queued' as DownloadStage
    });
    return;
  }

  executeDownload(options, mainWindow, 0);
}

/**
 * Executa o download de fato (chamado pela fila ou diretamente).
 * Faz parsing de stages (etapas), progresso, e gerencia auto-retry.
 *
 * @param options - Opções do download
 * @param mainWindow - Janela principal
 * @param retryCount - Número de tentativas já feitas
 */
async function executeDownload(
  options: DownloadOptions,
  mainWindow: BrowserWindow,
  retryCount: number
): Promise<void> {
  runningCount++;

  const ytdlpPath = await getYtdlpPath();
  const args: string[] = [];

  // Cookies
  if (options.useCookies) {
    args.push('--cookies-from-browser', options.cookieBrowser);
  }

  // Formato
  const format = options.formatId || 'bestvideo+bestaudio';
  args.push('-f', format);

  // Merge format
  args.push('--merge-output-format', options.mergeFormat || 'mkv');

  // Rate limit
  if (options.rateLimit && options.rateLimit !== '0') {
    args.push('--limit-rate', options.rateLimit);
  }

  // Output path
  args.push('-o', `${options.outputDir}/%(title)s.%(ext)s`);

  // Progresso por linha
  args.push('--newline');

  // Template de progresso
  args.push(
    '--progress-template',
    'download:%(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s'
  );

  // Retries nativos do yt-dlp
  args.push('--retries', '3', '--fragment-retries', '3');

  // Se é retry, tenta continuar o download anterior
  if (retryCount > 0) {
    args.push('-c');
    mainWindow.webContents.send('download:retry', {
      id: options.id,
      retryCount
    });
  }

  args.push(options.url);

  // Emite stage: analisando
  mainWindow.webContents.send('download:stage', {
    id: options.id,
    stage: 'analyzing' as DownloadStage
  });

  const childProcess = spawn(ytdlpPath, args);
  activeProcesses.set(options.id, childProcess);

  // Regex para progresso
  const progressRegex = /^\s*([\d.]+)%\s+(.+?)\s+(\S+)\s*$/;

  // Rastreia quantos blocos de download já passaram (vídeo = 1, áudio = 2)
  let downloadPhaseCount = 0;
  let currentStage: DownloadStage = 'analyzing';

  childProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }

      // Detecta mudança de stage pela saída do yt-dlp
      if (trimmedLine.startsWith('[download]') && !trimmedLine.includes('%')) {
        // Início de um novo bloco de download
        downloadPhaseCount++;
        const newStage: DownloadStage = downloadPhaseCount <= 1
          ? 'downloading_video'
          : 'downloading_audio';

        if (newStage !== currentStage) {
          currentStage = newStage;
          mainWindow.webContents.send('download:stage', {
            id: options.id,
            stage: currentStage
          });
        }
      }

      // Detecta merge
      if (
        trimmedLine.startsWith('[Merger]') ||
        trimmedLine.startsWith('[ffmpeg]') ||
        trimmedLine.includes('Merging formats')
      ) {
        if (currentStage !== 'merging') {
          currentStage = 'merging';
          mainWindow.webContents.send('download:stage', {
            id: options.id,
            stage: 'merging'
          });
        }
      }

      // Progresso numérico
      const match = trimmedLine.match(progressRegex);
      if (match) {
        // Detecta primeiro envio de progresso → stage de download
        if (currentStage === 'analyzing') {
          currentStage = 'downloading_video';
          mainWindow.webContents.send('download:stage', {
            id: options.id,
            stage: currentStage
          });
        }

        mainWindow.webContents.send('download:progress', {
          id: options.id,
          percent: parseFloat(match[1]),
          speed: match[2],
          eta: match[3]
        });
      }
    }
  });

  // Coleta stderr para exibir erros
  let stderrAccum = '';

  childProcess.stderr.on('data', (data) => {
    stderrAccum += data.toString();
  });

  childProcess.on('close', (exitCode) => {
    activeProcesses.delete(options.id);
    runningCount--;

    if (exitCode === 0) {
      // Sucesso
      mainWindow.webContents.send('download:stage', {
        id: options.id,
        stage: 'complete' as DownloadStage
      });
      mainWindow.webContents.send('download:complete', { id: options.id });

      const notification = new Notification({
        title: 'Download Complete',
        body: 'Download finished successfully!',
        silent: false
      });
      notification.show();
    } else {
      // Falha — tenta auto-retry (máx 3 tentativas)
      const maxRetries = 3;

      if (retryCount < maxRetries) {
        const nextRetry = retryCount + 1;

        // Na segunda falha (retryCount >= 1), limpa arquivos parciais
        if (nextRetry >= 2) {
          cleanPartialFiles(options.outputDir);
        }

        // Re-enfileira com retry
        downloadQueue.unshift({ options, mainWindow, retryCount: nextRetry });
      } else {
        // Esgotou tentativas — reporta erro
        const errorText = stderrAccum.trim() || `yt-dlp exited with code ${exitCode}`;
        mainWindow.webContents.send('download:error', {
          id: options.id,
          error: errorText
        });
      }
    }

    // Processa próximo da fila
    processQueue();
  });

  childProcess.on('error', (err) => {
    activeProcesses.delete(options.id);
    runningCount--;

    mainWindow.webContents.send('download:error', {
      id: options.id,
      error: err.message
    });

    processQueue();
  });
}

/**
 * Remove arquivos parciais (.part, .ytdl) do diretório.
 * Chamado antes de uma nova tentativa limpa.
 *
 * @param dir - Diretório de saída
 */
function cleanPartialFiles(dir: string): void {
  try {
    if (!existsSync(dir)) {
      return;
    }

    const files = readdirSync(dir);
    for (const file of files) {
      if (file.endsWith('.part') || file.endsWith('.ytdl')) {
        try {
          unlinkSync(join(dir, file));
        } catch {
          // ignora erros ao deletar
        }
      }
    }
  } catch {
    // ignora
  }
}

/**
 * Cancela um download em andamento.
 *
 * @param id - ID do download a cancelar
 * @returns true se o processo foi cancelado
 */
export function cancelDownload(id: string): boolean {
  // Remove da fila se ainda não começou
  const queueIndex = downloadQueue.findIndex((item) => item.options.id === id);
  if (queueIndex !== -1) {
    downloadQueue.splice(queueIndex, 1);
    return true;
  }

  // Mata o processo se já está ativo
  const childProcess = activeProcesses.get(id);
  if (childProcess) {
    childProcess.kill('SIGTERM');
    activeProcesses.delete(id);
    runningCount--;
    processQueue();
    return true;
  }

  return false;
}
