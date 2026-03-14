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
import { existsSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { checkDep, getPreferredYtdlpPath } from './deps'
import { generatePoToken } from './po-token'

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

type AuthStrategyLabel = 'none' | 'cookies-file' | 'cookies-browser'

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
  _forceCookiesForRetry?: boolean
  _youtubeExtractorArgs?: string
  _youtubeExtractorCandidates?: string[]
  _youtubeExtractorIndex?: number
  _youtubeAuthStrategyLabels?: AuthStrategyLabel[]
  _youtubeAuthStrategyIndex?: number
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

interface CookieAuthStrategy {
  label: Exclude<AuthStrategyLabel, 'none'>
  args: string[]
}

interface YouTubeAttemptPreference {
  extractorArgs: string
  authStrategyLabel: AuthStrategyLabel
  updatedAt: number
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
const FORMAT_PROBE_TIMEOUT_MS = 40000 // 40 segundos por candidato (YouTube pode ser lento)
const FORMAT_PROBE_QUEUE_DELAY_MS = 1500
const PO_TOKEN_TIMEOUT_MS = 4000

const inFlightFormatRequests = new Map<string, Promise<VideoInfo>>()
const youtubeAttemptPreferences = new Map<string, YouTubeAttemptPreference>()
const formatProbeQueue: Array<{
  url: string
  cookies?: CookieOptions
  ytdlpPath: string
  resolve: (value: VideoInfo) => void
  reject: (reason?: unknown) => void
}> = []
let formatProbeRunning = false
let nextFormatProbeAt = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function processFormatProbeQueue(): void {
  if (formatProbeRunning) {
    return
  }

  const next = formatProbeQueue.shift()
  if (!next) {
    return
  }

  formatProbeRunning = true
  ;(async () => {
    try {
      const waitMs = Math.max(0, nextFormatProbeAt - Date.now())
      if (waitMs > 0) {
        console.log('[listFormats] Waiting', waitMs, 'ms before next queued probe')
        await sleep(waitMs)
      }

      const info = await listFormatsImpl(next.url, next.cookies, next.ytdlpPath)
      next.resolve(info)
    } catch (err) {
      next.reject(err)
    } finally {
      nextFormatProbeAt = Date.now() + FORMAT_PROBE_QUEUE_DELAY_MS
      formatProbeRunning = false
      processFormatProbeQueue()
    }
  })().catch((err) => {
    console.error('[listFormats] Unexpected queue error:', err)
    next.reject(err)
    nextFormatProbeAt = Date.now() + FORMAT_PROBE_QUEUE_DELAY_MS
    formatProbeRunning = false
    processFormatProbeQueue()
  })
}

function enqueueFormatProbe(
  url: string,
  cookies: CookieOptions | undefined,
  ytdlpPath: string
): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    formatProbeQueue.push({ url, cookies, ytdlpPath, resolve, reject })
    processFormatProbeQueue()
  })
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

function buildDownloadRequestKey(
  options: Pick<
    DownloadOptions,
    'url' | 'useCookies' | 'cookieBrowser' | 'cookiesFilePath' | 'proxyUrl'
  >
): string {
  return buildFormatRequestKey(options.url, {
    useCookies: options.useCookies,
    cookieBrowser: options.cookieBrowser,
    cookiesFilePath: options.cookiesFilePath,
    proxyUrl: options.proxyUrl
  })
}

function rememberSuccessfulYouTubeAttempt(
  requestKey: string,
  extractorArgs: string,
  authStrategyLabel: AuthStrategyLabel
): void {
  if (!extractorArgs) {
    return
  }

  youtubeAttemptPreferences.set(requestKey, {
    extractorArgs,
    authStrategyLabel,
    updatedAt: Date.now()
  })
}

function getPreferredYouTubeAttempt(requestKey: string): YouTubeAttemptPreference | null {
  const preference = youtubeAttemptPreferences.get(requestKey)
  if (!preference) {
    return null
  }

  const THIRTY_MINUTES = 30 * 60 * 1000
  if (Date.now() - preference.updatedAt > THIRTY_MINUTES) {
    youtubeAttemptPreferences.delete(requestKey)
    return null
  }

  return preference
}

function isYouTubeUrl(url: string): boolean {
  return /(?:^|\.)youtube\.com|youtu\.be|music\.youtube\.com/i.test(url)
}

function extractYouTubeVideoId(url: string): string | null {
  const fromShort = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
  if (fromShort?.[1]) {
    return fromShort[1]
  }

  const fromQuery = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  if (fromQuery?.[1]) {
    return fromQuery[1]
  }

  const fromEmbed = url.match(/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/)
  if (fromEmbed?.[1]) {
    return fromEmbed[1]
  }

  return null
}

function buildYouTubeExtractorArgs(client: string, poToken?: string, visitorData?: string): string {
  let extractorArgs = `youtube:player_client=${client}`

  if (poToken) {
    extractorArgs += `;po_token=web.gvs+${poToken}`
  }
  if (visitorData) {
    extractorArgs += `;visitor_data=${visitorData}`
  }

  return extractorArgs
}

async function resolveYouTubeExtractorArgs(url: string): Promise<string> {
  if (!isYouTubeUrl(url)) {
    return ''
  }

  const videoId = extractYouTubeVideoId(url)
  if (!videoId) {
    return buildYouTubeExtractorArgs('default')
  }

  try {
    const { poToken, visitorData } = await generatePoToken(videoId)
    return buildYouTubeExtractorArgs('default', poToken, visitorData)
  } catch {
    return buildYouTubeExtractorArgs('default')
  }
}

async function resolveYouTubeExtractorArgsCandidates(url: string): Promise<string[]> {
  if (!isYouTubeUrl(url)) {
    return []
  }

  console.log('[resolveYouTubeExtractorArgsCandidates] Starting for URL:', url)

  const withoutToken = buildYouTubeExtractorArgs('default')
  const legacyWithoutToken = buildYouTubeExtractorArgs('default,-tv_simply')
  const safariWithoutToken = buildYouTubeExtractorArgs('web_safari')

  let withToken = withoutToken
  let poTokenResolved = false
  try {
    console.log(
      '[resolveYouTubeExtractorArgsCandidates] Attempting to fetch po-token (timeout:',
      PO_TOKEN_TIMEOUT_MS,
      'ms)'
    )
    withToken = await Promise.race<string>([
      resolveYouTubeExtractorArgs(url).then((token) => {
        console.log('[resolveYouTubeExtractorArgsCandidates] po-token resolved successfully')
        poTokenResolved = true
        return token
      }),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          console.log(
            '[resolveYouTubeExtractorArgsCandidates] po-token fetch timed out after',
            PO_TOKEN_TIMEOUT_MS,
            'ms'
          )
          resolve(withoutToken)
        }, PO_TOKEN_TIMEOUT_MS)
      })
    ])
  } catch (err) {
    console.error('[resolveYouTubeExtractorArgsCandidates] Error during po-token fetch:', err)
    withToken = withoutToken
  }

  const legacyWithToken = withToken.replace(
    'player_client=default',
    'player_client=default,-tv_simply'
  )

  const candidates = [
    ...new Set([withoutToken, legacyWithoutToken, safariWithoutToken, withToken, legacyWithToken])
  ].filter(Boolean)

  console.log(
    '[resolveYouTubeExtractorArgsCandidates] Generated',
    candidates.length,
    'candidates (poTokenResolved:',
    poTokenResolved,
    ')'
  )
  return candidates
}

function getYouTubeExtractorCandidatePriority(candidate: string): number {
  if (candidate.includes('player_client=default,-tv_simply') && candidate.includes('po_token=')) {
    return 0
  }
  if (candidate.includes('player_client=default,-tv_simply')) {
    return 1
  }
  if (candidate.includes('player_client=default') && candidate.includes('po_token=')) {
    return 2
  }
  if (candidate.includes('player_client=default')) {
    return 3
  }
  if (candidate.includes('player_client=web_safari')) {
    return 4
  }
  return 5
}

function prioritizeYouTubeExtractorCandidates(
  candidates: string[],
  preferredExtractorArgs?: string
): string[] {
  const uniqueCandidates = [...new Set(candidates.filter(Boolean))]

  return uniqueCandidates.sort((a, b) => {
    if (preferredExtractorArgs) {
      if (a === preferredExtractorArgs) {
        return -1
      }
      if (b === preferredExtractorArgs) {
        return 1
      }
    }

    return getYouTubeExtractorCandidatePriority(a) - getYouTubeExtractorCandidatePriority(b)
  })
}

function getMaxHeight(formats: FormatInfo[]): number {
  return formats.reduce((max, format) => Math.max(max, format.height || 0), 0)
}

function chooseBestVideoInfo(candidates: VideoInfo[]): VideoInfo {
  const sorted = [...candidates].sort((a, b) => {
    const maxHeightA = getMaxHeight(a.formats)
    const maxHeightB = getMaxHeight(b.formats)
    if (maxHeightA !== maxHeightB) {
      return maxHeightB - maxHeightA
    }

    const highCountA = a.formats.filter((f) => (f.height || 0) > 1080).length
    const highCountB = b.formats.filter((f) => (f.height || 0) > 1080).length
    if (highCountA !== highCountB) {
      return highCountB - highCountA
    }

    return b.formats.length - a.formats.length
  })

  return sorted[0]
}

function shouldUseCookiesForAttempt(options: DownloadOptions): boolean {
  if (!options.useCookies || options._dropCookiesForRetry) {
    return false
  }
  if (options._forceCookiesForRetry) {
    return true
  }
  // No YouTube, os downloads agora usam uma sequência explícita de autenticação em executeDownload.
  if (isYouTubeUrl(options.url)) {
    return false
  }
  return true
}

function needsFfmpeg(format: string): boolean {
  return format.includes('+')
}

function shouldRetryWithCookies(stderrOutput: string): boolean {
  return /sign in|private video|age-restricted|confirm your age|members-only|login|bot/i.test(
    stderrOutput
  )
}

function shouldDropCookiesForFormatRestriction(stderrOutput: string): boolean {
  return /Requested format is not available/i.test(stderrOutput)
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

function buildCookieAuthStrategies(
  cookieBrowser: string,
  cookiesFilePath?: string,
  preferredLabel?: Exclude<AuthStrategyLabel, 'none'>
): CookieAuthStrategy[] {
  const strategies: CookieAuthStrategy[] = []
  const cookiePath = (cookiesFilePath || '').trim()

  const browser = (cookieBrowser || 'chrome').trim()
  if (browser) {
    strategies.push({ label: 'cookies-browser', args: ['--cookies-from-browser', browser] })
  }

  if (cookiePath && existsSync(cookiePath)) {
    strategies.push({ label: 'cookies-file', args: ['--cookies', cookiePath] })
  }

  if (!preferredLabel) {
    return strategies
  }

  return strategies.sort((a, b) => {
    if (a.label === preferredLabel) {
      return -1
    }
    if (b.label === preferredLabel) {
      return 1
    }
    return 0
  })
}

function buildYouTubeDownloadAuthStrategyOrder(
  options: Pick<DownloadOptions, 'useCookies' | 'cookieBrowser' | 'cookiesFilePath'>,
  preferredLabel?: AuthStrategyLabel
): AuthStrategyLabel[] {
  const order: AuthStrategyLabel[] = []

  if (options.useCookies) {
    const preferredCookieStrategy =
      preferredLabel && preferredLabel !== 'none' ? preferredLabel : 'cookies-browser'

    for (const strategy of buildCookieAuthStrategies(
      options.cookieBrowser,
      options.cookiesFilePath,
      preferredCookieStrategy
    )) {
      order.push(strategy.label)
    }
  }

  order.push('none')

  if (preferredLabel) {
    const preferredIndex = order.indexOf(preferredLabel)
    if (preferredIndex > 0) {
      order.splice(preferredIndex, 1)
      order.unshift(preferredLabel)
    }
  }

  return [...new Set(order)]
}

function applyCookieStrategyArgs(
  args: string[],
  label: AuthStrategyLabel,
  cookieBrowser: string,
  cookiesFilePath?: string
): void {
  if (label === 'none') {
    return
  }

  const strategy = buildCookieAuthStrategies(cookieBrowser, cookiesFilePath, label).find(
    (candidate) => candidate.label === label
  )

  if (strategy) {
    args.push(...strategy.args)
  }
}

function advanceYouTubeAuthStrategy(options: DownloadOptions): boolean {
  const currentIndex = options._youtubeAuthStrategyIndex || 0
  const labels = options._youtubeAuthStrategyLabels || []
  if (currentIndex >= labels.length - 1) {
    return false
  }

  options._youtubeAuthStrategyIndex = currentIndex + 1
  return true
}

function resetYouTubeAuthStrategyOrder(
  options: DownloadOptions,
  preferredLabel?: AuthStrategyLabel
): void {
  options._youtubeAuthStrategyLabels = buildYouTubeDownloadAuthStrategyOrder(
    options,
    preferredLabel
  )
  options._youtubeAuthStrategyIndex = 0
}

function advanceYouTubeExtractorCandidate(options: DownloadOptions): boolean {
  const currentIndex = options._youtubeExtractorIndex || 0
  const candidates = options._youtubeExtractorCandidates || []
  if (currentIndex >= candidates.length - 1) {
    return false
  }

  options._youtubeExtractorIndex = currentIndex + 1
  return true
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
  const preferredPath = await getPreferredYtdlpPath()
  if (preferredPath) {
    console.log('[getYtdlpPath] Using preferred path:', preferredPath)
    return preferredPath
  }

  const status = await checkDep('yt-dlp')
  console.log('[getYtdlpPath] checkDep status:', status)
  if (!status.path) {
    throw new Error('yt-dlp not installed')
  }
  console.log('[getYtdlpPath] Using checked path:', status.path)
  return status.path
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

    applyCookiesArgs(
      args,
      !!cookies?.useCookies,
      cookies?.cookieBrowser || 'chrome',
      cookies?.cookiesFilePath
    )
    applyProxyArg(args, cookies?.proxyUrl)

    if (isYouTubeUrl(url)) {
      args.push('--extractor-args', 'youtube:player_client=default,-tv_simply')
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
    console.log('[listFormats] Reusing in-flight request for URL:', url)
    return existing
  }

  const task = (async () => {
    const ytdlpPath = await getYtdlpPath()
    console.log('[listFormats] Queueing format probe for URL:', url, 'with ytdlp path:', ytdlpPath)

    // Timeout global para toda a operação (evita bloqueios infinitos)
    const globalTimeout = setTimeout(() => {
      console.error('[listFormats] GLOBAL TIMEOUT: listFormats exceeded max time')
    }, FORMAT_PROBE_TIMEOUT_MS * 5)

    try {
      return await enqueueFormatProbe(url, cookies, ytdlpPath)
    } finally {
      clearTimeout(globalTimeout)
    }
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
  const requestKey = buildFormatRequestKey(url, cookies)
  const preferredAttempt = getPreferredYouTubeAttempt(requestKey)

  const runSingleProbe = async (extractorArgs: string, authArgs: string[]): Promise<VideoInfo> => {
    return new Promise((resolve, reject) => {
      const args: string[] = [...authArgs]

      applyProxyArg(args, cookies?.proxyUrl)

      if (isYouTubeUrl(url) && extractorArgs) {
        args.push('--extractor-args', extractorArgs)
      }

      // Evita travas longas de rede durante a sondagem de formatos.
      args.push('--socket-timeout', '12', '--retries', '1')
      args.push('-j', '--no-playlist', url)

      console.log('[listFormats] Running yt-dlp with args:', JSON.stringify(args))
      const childProcess = spawn(ytdlpPath, args)

      const timeout = setTimeout(() => {
        console.error(
          '[listFormats] Process timeout after',
          FORMAT_PROBE_TIMEOUT_MS,
          'ms - killing process'
        )
        childProcess.kill('SIGKILL')
        fail(new Error(`yt-dlp probe timed out after ${FORMAT_PROBE_TIMEOUT_MS}ms`))
      }, FORMAT_PROBE_TIMEOUT_MS)

      let stdoutBuffer = ''
      let stderrBuffer = ''
      let hasStartedReceivingData = false
      let settled = false

      const fail = (error: Error): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        reject(error)
      }

      const succeed = (info: VideoInfo): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        resolve(info)
      }

      childProcess.stdout.on('data', (chunk) => {
        if (!hasStartedReceivingData) {
          console.log('[listFormats] Started receiving stdout data')
          hasStartedReceivingData = true
        }
        stdoutBuffer += chunk.toString()
      })

      childProcess.stderr.on('data', (chunk) => {
        const stderrText = chunk.toString()
        stderrBuffer += stderrText
        console.log('[listFormats] stderr:', stderrText)

        // Falha rapida: o YouTube ja confirmou bloqueio de bot/login.
        if (shouldRetryWithCookies(stderrBuffer)) {
          console.warn('[listFormats] Fast-fail triggered due to bot/login challenge')
          childProcess.kill('SIGKILL')
          fail(new Error(stderrBuffer || 'YouTube requires authentication'))
        }
      })

      childProcess.on('close', (exitCode) => {
        if (settled) {
          return
        }

        clearTimeout(timeout)
        console.log(
          '[listFormats] Process closed with exit code:',
          exitCode,
          'stdout length:',
          stdoutBuffer.length
        )

        if (exitCode !== 0) {
          console.error('[listFormats] yt-dlp exited with code:', exitCode, 'stderr:', stderrBuffer)
          fail(new Error(stderrBuffer || `yt-dlp exited with code ${exitCode}`))
          return
        }

        try {
          const rawData = JSON.parse(stdoutBuffer)

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

          console.log('[listFormats] Successfully parsed', videoInfo.formats.length, 'formats')
          succeed(videoInfo)
        } catch (parseError) {
          console.error(
            '[listFormats] Failed to parse JSON:',
            parseError,
            'stdout length:',
            stdoutBuffer.length,
            'stdout:',
            stdoutBuffer.substring(0, 200)
          )
          fail(new Error(`Failed to parse yt-dlp output: ${parseError}`))
        }
      })

      childProcess.on('error', (err) => {
        console.error('[listFormats] childProcess error:', err)
        fail(err instanceof Error ? err : new Error(String(err)))
      })
    })
  }

  const runWithCookies = async (
    useAuth: boolean,
    extractorArgs = ''
  ): Promise<{ info: VideoInfo; authStrategyLabel: AuthStrategyLabel }> => {
    if (!(useAuth && cookies?.useCookies)) {
      const info = await runSingleProbe(extractorArgs, [])
      return { info, authStrategyLabel: 'none' }
    }

    const preferredAuthLabel =
      preferredAttempt?.authStrategyLabel && preferredAttempt.authStrategyLabel !== 'none'
        ? preferredAttempt.authStrategyLabel
        : 'cookies-browser'

    const strategies = buildCookieAuthStrategies(
      cookies.cookieBrowser,
      cookies.cookiesFilePath,
      preferredAuthLabel
    )
    if (strategies.length === 0) {
      const info = await runSingleProbe(extractorArgs, [])
      return { info, authStrategyLabel: 'none' }
    }

    let lastError: Error | null = null
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i]
      try {
        console.log('[listFormats] Auth strategy:', strategy.label)
        const info = await runSingleProbe(extractorArgs, strategy.args)
        return { info, authStrategyLabel: strategy.label }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        lastError = error

        const hasNextStrategy = i < strategies.length - 1
        if (hasNextStrategy && shouldRetryWithCookies(error.message)) {
          console.warn(
            '[listFormats] Auth challenge with strategy',
            strategy.label,
            '- trying next strategy'
          )
          continue
        }

        throw error
      }
    }

    throw lastError || new Error('Failed to list formats with all auth strategies')
  }

  if (!isYouTubeUrl(url)) {
    console.log('[listFormats] Non-YouTube URL, running simple probe')
    return (await runWithCookies(!!cookies?.useCookies)).info
  }

  const results: VideoInfo[] = []
  let lastError: unknown = null
  let consecutiveTimeouts = 0 // Rastreia timeouts consecutivos
  let authChallengeDetected = false

  const extractorCandidates = await resolveYouTubeExtractorArgsCandidates(url)
  const orderedCandidates = prioritizeYouTubeExtractorCandidates(
    extractorCandidates.length > 0 ? extractorCandidates : [buildYouTubeExtractorArgs('default')],
    preferredAttempt?.extractorArgs
  )

  console.log(
    '[listFormats] YouTube URL detected. Trying',
    orderedCandidates.length,
    'extractor candidates'
  )
  if (preferredAttempt) {
    console.log('[listFormats] Prioritizing remembered YouTube attempt:', preferredAttempt)
  }

  const attempt = async (index: number, useAuth: boolean, extractorArgs: string): Promise<void> => {
    const startTime = Date.now()
    try {
      console.log(
        '[listFormats] Candidate',
        index + 1,
        '/',
        orderedCandidates.length,
        '- Attempting with useAuth:',
        useAuth,
        'extractorArgs:',
        extractorArgs
      )
      const { info, authStrategyLabel } = await runWithCookies(useAuth, extractorArgs)
      const duration = Date.now() - startTime
      results.push(info)
      consecutiveTimeouts = 0 // Reset timeout counter on success
      rememberSuccessfulYouTubeAttempt(requestKey, extractorArgs, authStrategyLabel)
      console.log(
        '[listFormats] Candidate',
        index + 1,
        'succeeded in',
        duration,
        'ms - got',
        info.formats.length,
        'formats, max height:',
        getMaxHeight(info.formats),
        'auth strategy:',
        authStrategyLabel
      )
    } catch (err) {
      const duration = Date.now() - startTime
      console.error('[listFormats] Candidate', index + 1, 'failed after', duration, 'ms:', err)
      if (err instanceof Error && shouldRetryWithCookies(err.message)) {
        authChallengeDetected = true
      }
      // Se foi timeout, incrementa contador
      if (err instanceof Error && err.message.includes('timed out')) {
        consecutiveTimeouts++
        console.warn('[listFormats] Timeout detected - consecutive timeouts:', consecutiveTimeouts)
      } else {
        consecutiveTimeouts = 0
      }
      lastError = err
    }
  }

  // No comportamento atual do YouTube, tentativas anônimas costumam falhar com bot checks e atrasar a UI.
  // Por isso, tenta primeiro o caminho autenticado quando os cookies estão habilitados.
  if (cookies?.useCookies) {
    console.log('[listFormats] Cookies enabled, trying authenticated attempts first')
    for (let i = 0; i < orderedCandidates.length; i++) {
      if (authChallengeDetected) {
        console.log(
          '[listFormats] Auth challenge already detected, skipping remaining authenticated attempts'
        )
        break
      }
      // Se temos 2+ timeouts consecutivos, pula para anônimo
      if (consecutiveTimeouts >= 2) {
        console.log(
          '[listFormats] Too many consecutive timeouts (' +
            consecutiveTimeouts +
            '), skipping to anonymous attempts'
        )
        break
      }
      await attempt(i, true, orderedCandidates[i])

      const latest = results[results.length - 1]
      if (latest && getMaxHeight(latest.formats) > 1080) {
        console.log('[listFormats] Got 4K+ formats with cookies, returning early')
        return latest
      }
    }
  }

  // Fallbacks anônimos ainda são úteis quando os próprios cookies restringem codecs ou formatos.
  console.log('[listFormats] Trying anonymous attempts')
  for (let i = 0; i < orderedCandidates.length; i++) {
    if (authChallengeDetected) {
      console.log('[listFormats] Auth challenge detected, skipping remaining anonymous attempts')
      break
    }
    // Se temos 2+ timeouts consecutivos em anônimo, salta
    if (consecutiveTimeouts >= 2) {
      console.log(
        '[listFormats] Too many consecutive timeouts (' +
          consecutiveTimeouts +
          '), skipping further attempts'
      )
      break
    }
    await attempt(i, false, orderedCandidates[i])

    const latest = results[results.length - 1]
    if (latest && getMaxHeight(latest.formats) > 1080) {
      console.log('[listFormats] Got 4K+ formats anonymously, returning early')
      return latest
    }
  }

  // Se nenhum candidato funcionar, faz uma última tentativa com argumentos mínimos.
  if (results.length === 0) {
    console.log(
      '[listFormats] All extractor candidates failed. Trying final fallback with no extractor args'
    )
    try {
      const { info: fallbackInfo } = await runWithCookies(false, '')
      results.push(fallbackInfo)
      console.log(
        '[listFormats] Fallback attempt succeeded with',
        fallbackInfo.formats.length,
        'formats'
      )
    } catch (err) {
      console.error('[listFormats] Fallback attempt also failed:', err)
    }
  }

  if (results.length === 0) {
    console.error('[listFormats] All attempts failed. Last error:', lastError)
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError || 'Failed to list formats'))
  }

  console.log('[listFormats] Choosing best from', results.length, 'successful probes')
  return chooseBestVideoInfo(results)
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
  const requestKey = buildDownloadRequestKey(options)
  const preferredYouTubeAttempt = youtubeUrl ? getPreferredYouTubeAttempt(requestKey) : null
  let currentYouTubeAuthLabel: AuthStrategyLabel = 'none'

  applyProxyArg(args, options.proxyUrl)

  if (youtubeUrl) {
    if (!options._youtubeExtractorCandidates || options._youtubeExtractorCandidates.length === 0) {
      options._youtubeExtractorCandidates = await resolveYouTubeExtractorArgsCandidates(options.url)
    }

    options._youtubeExtractorCandidates = prioritizeYouTubeExtractorCandidates(
      options._youtubeExtractorCandidates,
      preferredYouTubeAttempt?.extractorArgs
    )
    if (typeof options._youtubeExtractorIndex !== 'number' || options._youtubeExtractorIndex < 0) {
      options._youtubeExtractorIndex = 0
    }

    options._youtubeExtractorArgs =
      options._youtubeExtractorCandidates[options._youtubeExtractorIndex || 0] || ''
    if (options._youtubeExtractorArgs) {
      args.push('--extractor-args', options._youtubeExtractorArgs)
    }

    if (!options._youtubeAuthStrategyLabels || options._youtubeAuthStrategyLabels.length === 0) {
      resetYouTubeAuthStrategyOrder(options, preferredYouTubeAttempt?.authStrategyLabel)
    } else if (
      typeof options._youtubeAuthStrategyIndex !== 'number' ||
      options._youtubeAuthStrategyIndex < 0
    ) {
      options._youtubeAuthStrategyIndex = 0
    }

    currentYouTubeAuthLabel =
      options._youtubeAuthStrategyLabels?.[options._youtubeAuthStrategyIndex || 0] || 'none'
  }

  const format = options.formatId || 'bestvideo+bestaudio'
  const cookiesEnabledThisAttempt = youtubeUrl
    ? currentYouTubeAuthLabel !== 'none'
    : shouldUseCookiesForAttempt(options)
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

  // Cookies
  if (youtubeUrl) {
    applyCookieStrategyArgs(
      args,
      currentYouTubeAuthLabel,
      options.cookieBrowser,
      options.cookiesFilePath
    )
  } else if (cookiesEnabledThisAttempt) {
    applyCookiesArgs(args, true, options.cookieBrowser, options.cookiesFilePath)
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

  console.log('[download] Starting attempt', {
    id: options.id,
    retryCount,
    format,
    extractorArgs: options._youtubeExtractorArgs || '',
    authStrategy: currentYouTubeAuthLabel,
    cookiesEnabledThisAttempt,
    configuredRateLimit: normalizedRateLimit,
    appliedRateLimit,
    activeDownloadCount: runningCount,
    outputDir: options.outputDir
  })
  console.log('[download] Running yt-dlp with args:', JSON.stringify(args))

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
      if (youtubeUrl && options._youtubeExtractorArgs) {
        rememberSuccessfulYouTubeAttempt(
          requestKey,
          options._youtubeExtractorArgs,
          currentYouTubeAuthLabel
        )
      }

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
      // Falha — tenta auto-retry (máx 3 tentativas)
      const maxRetries = 3

      if (retryCount < maxRetries) {
        const nextRetry = retryCount + 1

        // Na segunda falha (retryCount >= 1), limpa arquivos parciais
        if (nextRetry >= 2) {
          cleanPartialFiles(options.outputDir)
        }

        // Se o YouTube bloqueou formato 4K/DASH por causa de cookies (SABR), log de erro avisa.
        // O próximo retry deve tentar remover os cookies!
        if (
          options.useCookies &&
          youtubeUrl &&
          !cookiesEnabledThisAttempt &&
          !options._forceCookiesForRetry &&
          shouldRetryWithCookies(stderrAccum)
        ) {
          options._forceCookiesForRetry = true
          options._dropCookiesForRetry = false
        }

        if (
          options.useCookies &&
          cookiesEnabledThisAttempt &&
          !options._dropCookiesForRetry &&
          shouldDropCookiesForFormatRestriction(stderrAccum)
        ) {
          options._dropCookiesForRetry = true
          options._forceCookiesForRetry = false
        }

        if (youtubeUrl) {
          const hasAuthChallenge = shouldRetryWithCookies(stderrAccum)
          const hasFormatRestriction = shouldDropCookiesForFormatRestriction(stderrAccum)
          let retryPlanUpdated = false

          if (hasAuthChallenge) {
            retryPlanUpdated = advanceYouTubeAuthStrategy(options)

            if (!retryPlanUpdated && advanceYouTubeExtractorCandidate(options)) {
              resetYouTubeAuthStrategyOrder(options, preferredYouTubeAttempt?.authStrategyLabel)
              retryPlanUpdated = true
            }
          } else if (hasFormatRestriction) {
            const anonymousIndex = options._youtubeAuthStrategyLabels?.indexOf('none') ?? -1
            const currentAuthIndex = options._youtubeAuthStrategyIndex || 0

            if (
              currentYouTubeAuthLabel !== 'none' &&
              anonymousIndex >= 0 &&
              anonymousIndex !== currentAuthIndex
            ) {
              options._youtubeAuthStrategyIndex = anonymousIndex
              retryPlanUpdated = true
            }

            if (!retryPlanUpdated && advanceYouTubeExtractorCandidate(options)) {
              resetYouTubeAuthStrategyOrder(options, 'none')
              retryPlanUpdated = true
            }
          } else {
            if (advanceYouTubeExtractorCandidate(options)) {
              resetYouTubeAuthStrategyOrder(options, preferredYouTubeAttempt?.authStrategyLabel)
              retryPlanUpdated = true
            } else if (advanceYouTubeAuthStrategy(options)) {
              retryPlanUpdated = true
            }
          }

          console.log('[download] Retry decision', {
            id: options.id,
            nextRetry,
            hasAuthChallenge,
            hasFormatRestriction,
            retryPlanUpdated,
            nextExtractorIndex: options._youtubeExtractorIndex || 0,
            nextExtractorArgs:
              options._youtubeExtractorCandidates?.[options._youtubeExtractorIndex || 0] || '',
            nextAuthStrategy:
              options._youtubeAuthStrategyLabels?.[options._youtubeAuthStrategyIndex || 0] || 'none'
          })
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
