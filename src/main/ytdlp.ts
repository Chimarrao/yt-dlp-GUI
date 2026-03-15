/**
 * Adaptador do yt-dlp para o processo main do Electron.
 *
 * Responsável por:
 * - Listar formatos disponíveis (`yt-dlp -j`)
 * - Gerenciar fila de downloads com limite de concorrência
 * - Detectar e emitir etapas do download (analisando, vídeo, áudio, merge)
 * - Auto-retry inteligente (continuar → limpar → recomeçar)
 * - Limitar velocidade de download (--limit-rate)
 */

import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow, Notification } from 'electron'
import { appendFileSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { checkDep } from './deps'

// ── Processos e fila ──

/** Mapa de processos ativos — permite cancelar downloads pelo ID */
const activeProcesses = new Map<string, ChildProcess>()
const cancelledDownloads = new Set<string>()

/** Fila de downloads pendentes aguardando slot */
const downloadQueue: Array<{
  options: DownloadOptions
  mainWindow: BrowserWindow
  retryCount: number
}> = []

/** Contador de downloads rodando agora */
let runningCount = 0

/** Limite padrão de downloads simultâneos */
let maxConcurrent = 3

// ── Interfaces ──

export interface DownloadOptions {
  id: string
  url: string
  outputDir: string
  formatId?: string
  useCookies: boolean
  cookieBrowser: string
  cookiesFilePath?: string
  proxyUrl?: string
  mergeFormat?: string
  rateLimit?: string
  _dropCookiesForRetry?: boolean
}

export interface CookieOptions {
  useCookies: boolean
  cookieBrowser: string
  cookiesFilePath?: string
  proxyUrl?: string
}

export interface FormatInfo {
  format_id: string
  ext: string
  resolution: string
  height: number | null
  fps: number | null
  filesize: number | null
  filesize_approx: number | null
  vcodec: string
  acodec: string
  tbr: number | null
  format_note: string
}

export interface VideoInfo {
  id: string
  title: string
  thumbnail: string
  duration: number
  formats: FormatInfo[]
  url: string
}

export interface QuickVideoInfo {
  title: string
  thumbnail: string
}

// ── Etapas do download ──
export type DownloadStage =
  | 'queued'
  | 'analyzing'
  | 'downloading_video'
  | 'downloading_audio'
  | 'merging'
  | 'complete'

const RATE_LIMIT_REGEX = /^(?:0|\d+(?:\.\d+)?[KMG]?)$/i
const FORMAT_PROBE_TIMEOUT_MS = 30000 // Timeout curto para manter UX responsiva.
const YOUTUBE_EXTRACTOR_ARGS = 'youtube:player_client=web,web_creator,tv'
const LOG_FILE_PATH = join(process.cwd(), 'logs.txt')
const inFlightFormatRequests = new Map<string, Promise<VideoInfo>>()
let formatProbeQueue: Promise<void> = Promise.resolve()
let ytdlpPathCache: string | null = null
let ytdlpPathInFlight: Promise<string> | null = null

function logYtdlp(message: string, data?: unknown): void {
  const line = `${new Date().toISOString()} ${message}${
    data === undefined ? '' : ` ${typeof data === 'string' ? data : JSON.stringify(data)}`
  }`
  console.log(line)
  try {
    appendFileSync(LOG_FILE_PATH, `${line}\n`)
  } catch {
    // Evita quebrar o fluxo caso o arquivo de log não esteja acessível.
  }
}

function enqueueFormatProbe<T>(task: () => Promise<T>): Promise<T> {
  const run = formatProbeQueue.then(task, task)
  formatProbeQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function extractJsonPayload(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) {
    return null
  }

  return trimmed.slice(start, end + 1)
}

function buildFormatRequestKey(url: string, cookies?: CookieOptions): string {
  return JSON.stringify({
    url,
    useCookies: !!cookies?.useCookies,
    cookieBrowser: cookies?.cookieBrowser || '',
    cookiesFilePath: cookies?.cookiesFilePath || '',
    proxyUrl: cookies?.proxyUrl || ''
  })
}

function isYouTubeUrl(url: string): boolean {
  return /(?:^|\.)youtube\.com|youtu\.be|music\.youtube\.com/i.test(url)
}

function shouldUseCookiesForAttempt(options: DownloadOptions): boolean {
  return options.useCookies && !options._dropCookiesForRetry
}

function needsFfmpeg(format: string): boolean {
  return format.includes('+')
}

function applyCookiesArgs(
  args: string[],
  useCookies: boolean,
  cookieBrowser: string,
  cookiesFilePath?: string
): void {
  if (!useCookies) {
    return
  }

  const cookiePath = (cookiesFilePath || '').trim()
  if (cookiePath && existsSync(cookiePath)) {
    args.push('--cookies', cookiePath)
    return
  }

  args.push('--cookies-from-browser', cookieBrowser)
}

function applyProxyArg(args: string[], proxyUrl?: string): void {
  const proxy = (proxyUrl || '').trim()
  if (proxy) {
    args.push('--proxy', proxy)
  }
}

export function normalizeRateLimit(rateLimit?: string): string | null {
  const normalized = (rateLimit || '0').trim().toUpperCase()
  if (!normalized || normalized === '0') {
    return '0'
  }
  return RATE_LIMIT_REGEX.test(normalized) ? normalized : null
}

function parseRateLimitBytesPerSecond(rateLimit: string): number {
  if (rateLimit === '0') {
    return 0
  }

  const match = rateLimit.match(/^(\d+(?:\.\d+)?)([KMG]?)$/i)
  if (!match) {
    return 0
  }

  const value = Number(match[1])
  const unit = match[2].toUpperCase()
  const multiplier = unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : unit === 'K' ? 1024 : 1

  return Math.max(0, Math.round(value * multiplier))
}

function formatRateLimitBytesPerSecond(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) {
    return '0'
  }

  const units = ['', 'K', 'M', 'G']
  let value = bytesPerSecond
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  if (unitIndex === 0) {
    return String(Math.max(1, Math.round(value)))
  }

  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${rounded}${units[unitIndex]}`
}

function getAppliedRateLimit(rateLimit: string, activeDownloadCount: number): string {
  const totalBytesPerSecond = parseRateLimitBytesPerSecond(rateLimit)
  if (totalBytesPerSecond <= 0) {
    return '0'
  }

  const concurrentCount = Math.max(1, activeDownloadCount)
  const perDownloadBytesPerSecond = Math.max(1, Math.floor(totalBytesPerSecond / concurrentCount))
  return formatRateLimitBytesPerSecond(perDownloadBytesPerSecond)
}

// ── Funções internas ──

async function getYtdlpPath(): Promise<string> {
  if (ytdlpPathCache) {
    return ytdlpPathCache
  }

  if (!ytdlpPathInFlight) {
    ytdlpPathInFlight = (async () => {
      const status = await checkDep('yt-dlp')
      if (!status.path) {
        throw new Error('yt-dlp não encontrado. Instale o yt-dlp nas Configurações.')
      }

      ytdlpPathCache = status.path
      logYtdlp('[getYtdlpPath] Using installed path', {
        path: status.path,
        version: status.version
      })
      return status.path
    })().finally(() => {
      ytdlpPathInFlight = null
    })
  }

  return ytdlpPathInFlight
}

/**
 * Define o limite máximo de downloads simultâneos.
 *
 * @param max - Número máximo (1-10)
 */
export function setMaxConcurrent(max: number): void {
  maxConcurrent = Math.min(10, Math.max(1, max))
  processQueue()
}

/**
 * Retorna o limite atual de downloads simultâneos.
 */
export function getMaxConcurrent(): number {
  return maxConcurrent
}

// ── Busca rápida ──

export async function fetchQuickInfo(
  url: string,
  cookies?: CookieOptions
): Promise<QuickVideoInfo> {
  const ytdlpPath = await getYtdlpPath()

  return new Promise((resolve) => {
    const args: string[] = []

    if (cookies?.useCookies) {
      applyCookiesArgs(args, true, cookies.cookieBrowser || 'chrome', cookies.cookiesFilePath)
    }
    applyProxyArg(args, cookies?.proxyUrl)

    if (isYouTubeUrl(url)) {
      args.push('--extractor-args', YOUTUBE_EXTRACTOR_ARGS)
    }

    args.push('--skip-download', '--no-playlist', '--print', '%(title)s\n%(thumbnail)s', url)

    const childProcess = spawn(ytdlpPath, args)
    let stdoutBuffer = ''

    childProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString()
    })

    childProcess.on('close', (exitCode) => {
      if (exitCode !== 0) {
        resolve({ title: '', thumbnail: '' })
        return
      }

      const lines = stdoutBuffer.trim().split('\n')
      resolve({
        title: lines[0] || '',
        thumbnail: lines[1] || ''
      })
    })

    childProcess.on('error', () => {
      resolve({ title: '', thumbnail: '' })
    })
  })
}

// ── Listagem de formatos ──

export async function listFormats(url: string, cookies?: CookieOptions): Promise<VideoInfo> {
  const requestKey = buildFormatRequestKey(url, cookies)
  const existing = inFlightFormatRequests.get(requestKey)
  if (existing) {
    logYtdlp('[listFormats] Reusing in-flight request', { url })
    return existing
  }

  const task = (async () => {
    const ytdlpPath = await getYtdlpPath()
    logYtdlp('[listFormats] Queueing format probe', { url, ytdlpPath })
    return enqueueFormatProbe(() => listFormatsImpl(url, cookies, ytdlpPath))
  })()

  inFlightFormatRequests.set(requestKey, task)
  try {
    return await task
  } finally {
    inFlightFormatRequests.delete(requestKey)
  }
}

async function listFormatsImpl(
  url: string,
  cookies: CookieOptions | undefined,
  ytdlpPath: string
): Promise<VideoInfo> {
  const isYT = isYouTubeUrl(url)
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const args: string[] = []
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    let timedOut = false

    // Em YouTube, prioriza cookies do navegador para evitar arquivo Netscape desatualizado.
    if (cookies?.useCookies) {
      if (isYT) {
        args.push('--cookies-from-browser', cookies.cookieBrowser || 'chrome')
      } else {
        applyCookiesArgs(args, true, cookies.cookieBrowser || 'chrome', cookies.cookiesFilePath)
      }
    }
    applyProxyArg(args, cookies?.proxyUrl)

    // YouTube: usa extractor args que funcionam e pegam 4K
    if (isYT) {
      args.push('--extractor-args', YOUTUBE_EXTRACTOR_ARGS)
    }

    // -j funciona melhor com nightly para retornar formatos 2K/4K no YouTube.
    args.push('-j', '--no-playlist', '--no-warnings')
    args.push(url)

    logYtdlp('[listFormatsImpl] Running yt-dlp', {
      url,
      isYT,
      timeoutMs: FORMAT_PROBE_TIMEOUT_MS,
      args
    })

    const childProcess = spawn(ytdlpPath, args)

    const rejectOnce = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      reject(error)
    }

    timeout = setTimeout(() => {
      timedOut = true
      logYtdlp('[listFormatsImpl] Timeout ao buscar formatos', {
        url,
        timeoutMs: FORMAT_PROBE_TIMEOUT_MS
      })
      childProcess.kill('SIGKILL')
      rejectOnce(new Error(`Timeout ao buscar formatos (${FORMAT_PROBE_TIMEOUT_MS / 1000}s)`))
    }, FORMAT_PROBE_TIMEOUT_MS)

    let stdoutBuffer = ''
    let stderrBuffer = ''

    const tryResolveFromStdout = (origin: 'stream' | 'close'): boolean => {
      if (settled || !stdoutBuffer.trim()) {
        return false
      }

      const jsonPayload = extractJsonPayload(stdoutBuffer)
      if (!jsonPayload) {
        return false
      }

      try {
        const rawData = JSON.parse(jsonPayload)

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
        }

        if (!videoInfo.formats.length) {
          return false
        }

        settled = true
        if (timeout) {
          clearTimeout(timeout)
        }

        logYtdlp('[listFormatsImpl] Parsed formats', {
          url,
          origin,
          formats: videoInfo.formats.length,
          maxHeight: Math.max(
            ...videoInfo.formats.map((f) => (typeof f.height === 'number' ? f.height : 0))
          )
        })

        resolve(videoInfo)

        // Alguns binarios ficam presos apos imprimir JSON; encerra sem bloquear UI.
        try {
          childProcess.kill('SIGTERM')
        } catch {
          // ignore
        }

        return true
      } catch {
        return false
      }
    }

    childProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString()

      // Tenta finalizar cedo quando o JSON ja chegou completo.
      if (stdoutBuffer.trimEnd().endsWith('}')) {
        tryResolveFromStdout('stream')
      }
    })

    childProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderrBuffer += text
    })

    childProcess.on('close', (exitCode, signal) => {
      if (settled) {
        return
      }

      if (timeout) {
        clearTimeout(timeout)
      }

      const hasNonZeroExit = typeof exitCode === 'number' && exitCode !== 0

      logYtdlp('[listFormatsImpl] Process finished', {
        url,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        stdoutBytes: stdoutBuffer.length,
        stderrBytes: stderrBuffer.length,
        timedOut
      })

      if (!timedOut && signal) {
        rejectOnce(new Error(`yt-dlp interrompido por sinal: ${signal}`))
        return
      }

      if (hasNonZeroExit) {
        const stderrMessage = stderrBuffer.trim()
        const message = stderrMessage || `yt-dlp exited with code ${exitCode}`
        rejectOnce(new Error(message))
        return
      }

      if (!stdoutBuffer.trim()) {
        const stderrMessage = stderrBuffer.trim()
        rejectOnce(new Error(stderrMessage || 'yt-dlp não retornou dados de formatos.'))
        return
      }

      if (tryResolveFromStdout('close')) {
        return
      }

      rejectOnce(new Error(stderrBuffer.trim() || 'Saída JSON vazia ou inválida'))
    })

    childProcess.on('error', (err) => {
      logYtdlp('[listFormatsImpl] Spawn error', { url, error: err.message })
      rejectOnce(err)
    })
  })
}

// ── Fila de downloads ──

/**
 * Processa a fila: inicia downloads pendentes se houver slots disponíveis.
 */
function processQueue(): void {
  while (runningCount < maxConcurrent && downloadQueue.length > 0) {
    const next = downloadQueue.shift()
    if (next) {
      executeDownload(next.options, next.mainWindow, next.retryCount)
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
    downloadQueue.push({ options, mainWindow, retryCount: 0 })
    mainWindow.webContents.send('download:stage', {
      id: options.id,
      stage: 'queued' as DownloadStage
    })
    return
  }

  executeDownload(options, mainWindow, 0)
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
  runningCount++

  const ytdlpPath = await getYtdlpPath()
  const args: string[] = []
  const youtubeUrl = isYouTubeUrl(options.url)

  applyProxyArg(args, options.proxyUrl)

  // YouTube: usa extractor args que funcionam SEM cookies
  if (youtubeUrl) {
    args.push('--extractor-args', YOUTUBE_EXTRACTOR_ARGS)
  }

  const format = options.formatId || 'bestvideo+bestaudio'
  const cookiesEnabledThisAttempt = shouldUseCookiesForAttempt(options)
  const normalizedRateLimit = normalizeRateLimit(options.rateLimit)

  if (normalizedRateLimit === null) {
    runningCount = Math.max(0, runningCount - 1)
    mainWindow.webContents.send('download:error', {
      id: options.id,
      error: 'Invalid speed limit. Use 0 or values like 500K, 5M, 1G.'
    })
    processQueue()
    return
  }

  if (needsFfmpeg(format)) {
    const ffmpegStatus = await checkDep('ffmpeg')
    if (!ffmpegStatus.path) {
      runningCount = Math.max(0, runningCount - 1)
      mainWindow.webContents.send('download:error', {
        id: options.id,
        error: 'ffmpeg is required for merged video+audio downloads. Install ffmpeg in Settings.'
      })
      processQueue()
      return
    }
  }

  // Cookies (opcional, extractor-args já resolve)
  if (cookiesEnabledThisAttempt) {
    if (youtubeUrl) {
      args.push('--cookies-from-browser', options.cookieBrowser || 'chrome')
    } else {
      applyCookiesArgs(args, true, options.cookieBrowser || 'chrome', options.cookiesFilePath)
    }
  }

  // Formato
  args.push('-f', format)

  // Formato de merge
  args.push('--merge-output-format', options.mergeFormat || 'mkv')

  // Limite de velocidade
  const appliedRateLimit = getAppliedRateLimit(normalizedRateLimit, runningCount)
  if (appliedRateLimit !== '0') {
    args.push('--limit-rate', appliedRateLimit)
  }

  // Caminho de saída
  args.push('-o', `${options.outputDir}/%(title)s.%(ext)s`)

  // Progresso por linha
  args.push('--newline')

  // Modelo de progresso
  args.push(
    '--progress-template',
    'download:%(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s'
  )

  // Retries nativos do yt-dlp
  args.push('--retries', '3', '--fragment-retries', '3')

  // Se é retry, tenta continuar o download anterior
  if (retryCount > 0) {
    args.push('-c')
    mainWindow.webContents.send('download:retry', {
      id: options.id,
      retryCount
    })
  }

  args.push(options.url)

  console.log('[download] Starting', {
    id: options.id,
    retryCount,
    format,
    cookies: cookiesEnabledThisAttempt,
    rateLimit: appliedRateLimit
  })

  // Emite stage: analisando
  mainWindow.webContents.send('download:stage', {
    id: options.id,
    stage: 'analyzing' as DownloadStage
  })

  const childProcess = spawn(ytdlpPath, args)
  activeProcesses.set(options.id, childProcess)

  // Regex para progresso
  const progressRegex = /^\s*([\d.]+)%\s+(.+?)\s+(\S+)\s*$/

  // Rastreia quantos blocos de download já passaram (vídeo = 1, áudio = 2)
  let downloadPhaseCount = 0
  let currentStage: DownloadStage = 'analyzing'

  childProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n')

    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine) {
        continue
      }

      // Detecta mudança de stage pela saída do yt-dlp
      if (trimmedLine.startsWith('[download]') && !trimmedLine.includes('%')) {
        // Início de um novo bloco de download
        downloadPhaseCount++
        const newStage: DownloadStage =
          downloadPhaseCount <= 1 ? 'downloading_video' : 'downloading_audio'

        if (newStage !== currentStage) {
          currentStage = newStage
          mainWindow.webContents.send('download:stage', {
            id: options.id,
            stage: currentStage
          })
        }
      }

      // Detecta merge
      if (
        trimmedLine.startsWith('[Merger]') ||
        trimmedLine.startsWith('[ffmpeg]') ||
        trimmedLine.includes('Merging formats')
      ) {
        if (currentStage !== 'merging') {
          currentStage = 'merging'
          mainWindow.webContents.send('download:stage', {
            id: options.id,
            stage: 'merging'
          })
        }
      }

      // Progresso numérico
      const match = trimmedLine.match(progressRegex)
      if (match) {
        // Detecta primeiro envio de progresso → stage de download
        if (currentStage === 'analyzing') {
          currentStage = 'downloading_video'
          mainWindow.webContents.send('download:stage', {
            id: options.id,
            stage: currentStage
          })
        }

        mainWindow.webContents.send('download:progress', {
          id: options.id,
          percent: parseFloat(match[1]),
          speed: match[2],
          eta: match[3]
        })
      }
    }
  })

  // Coleta stderr para exibir erros
  let stderrAccum = ''

  childProcess.stderr.on('data', (data) => {
    const stderrText = data.toString()
    stderrAccum += stderrText
    console.log('[download] stderr:', stderrText)
  })

  childProcess.on('close', (exitCode) => {
    activeProcesses.delete(options.id)
    runningCount = Math.max(0, runningCount - 1)

    if (cancelledDownloads.has(options.id)) {
      cancelledDownloads.delete(options.id)
      mainWindow.webContents.send('download:cancelled', {
        id: options.id
      })
      processQueue()
      return
    }

    if (exitCode === 0) {
      // Sucesso
      mainWindow.webContents.send('download:stage', {
        id: options.id,
        stage: 'complete' as DownloadStage
      })
      mainWindow.webContents.send('download:complete', { id: options.id })

      const notification = new Notification({
        title: 'Download Complete',
        body: 'Download finished successfully!',
        silent: false
      })
      notification.show()
    } else {
      // Falha — retry simples (máx 2 tentativas)
      const maxRetries = 2

      if (retryCount < maxRetries) {
        const nextRetry = retryCount + 1

        // Na segunda falha, limpa arquivos parciais e tenta sem cookies
        if (nextRetry >= 2) {
          cleanPartialFiles(options.outputDir)
          options._dropCookiesForRetry = true
        }

        // Re-enfileira com retry
        downloadQueue.unshift({ options, mainWindow, retryCount: nextRetry })
      } else {
        // Esgotou tentativas — reporta erro
        const errorText = stderrAccum.trim() || `yt-dlp exited with code ${exitCode}`
        mainWindow.webContents.send('download:error', {
          id: options.id,
          error: errorText
        })
      }
    }

    // Processa próximo da fila
    processQueue()
  })

  childProcess.on('error', (err) => {
    activeProcesses.delete(options.id)
    runningCount = Math.max(0, runningCount - 1)

    if (cancelledDownloads.has(options.id)) {
      cancelledDownloads.delete(options.id)
      mainWindow.webContents.send('download:cancelled', {
        id: options.id
      })
      processQueue()
      return
    }

    mainWindow.webContents.send('download:error', {
      id: options.id,
      error: err.message
    })

    processQueue()
  })
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
      return
    }

    const files = readdirSync(dir)
    for (const file of files) {
      if (file.endsWith('.part') || file.endsWith('.ytdl')) {
        try {
          unlinkSync(join(dir, file))
          console.log('[cleanPartialFiles] Removed partial file:', file)
        } catch (err) {
          console.warn('[cleanPartialFiles] Error removing file:', file, err)
        }
      }
    }
  } catch (err) {
    console.error('[cleanPartialFiles] Error reading directory:', dir, err)
  }
}

/**
 * Cancela um download em andamento.
 *
 * @param id - ID do download a cancelar
 * @returns true se o processo foi cancelado
 */
export function cancelDownload(id: string): boolean {
  cancelledDownloads.add(id)

  // Remove todas as entradas da fila/retry para este id.
  let removedFromQueue = false
  for (let i = downloadQueue.length - 1; i >= 0; i--) {
    if (downloadQueue[i].options.id === id) {
      downloadQueue.splice(i, 1)
      removedFromQueue = true
    }
  }

  if (removedFromQueue) {
    return true
  }

  // Mata o processo se ja esta ativo
  const childProcess = activeProcesses.get(id)
  if (childProcess) {
    childProcess.kill('SIGTERM')
    return true
  }

  cancelledDownloads.delete(id)

  return false
}
