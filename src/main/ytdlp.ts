/**
 * Wrapper do yt-dlp para o processo main do Electron.
 *
 * Responsável por:
 * - Listar formatos disponíveis de um vídeo (`yt-dlp -j`)
 * - Iniciar downloads com parsing de progresso em tempo real
 * - Cancelar downloads em andamento
 *
 * Comunica-se com o renderer via IPC (webContents.send), enviando eventos de
 * progresso, erro e conclusão conforme o yt-dlp escreve na stdout/stderr.
 */

import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow, Notification } from 'electron'
import { checkDep } from './deps'

/** Mapa de processos ativos — permite cancelar downloads pelo ID */
const activeProcesses = new Map<string, ChildProcess>()

// ── Interfaces ──

/** Opções para iniciar um download */
export interface DownloadOptions {
  id: string
  url: string
  outputDir: string
  formatId?: string
  useCookies: boolean
  cookieBrowser: string
  mergeFormat?: string
}

/** Opções de cookies para listagem de formatos */
export interface CookieOptions {
  useCookies: boolean
  cookieBrowser: string
}

/** Informações de um formato disponível */
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

/** Informações de um vídeo retornadas pelo yt-dlp */
export interface VideoInfo {
  id: string
  title: string
  thumbnail: string
  duration: number
  formats: FormatInfo[]
  url: string
}

/**
 * Obtém o caminho absoluto do binário yt-dlp.
 *
 * @returns Caminho do yt-dlp
 * @throws Error se o yt-dlp não estiver instalado
 */
async function getYtdlpPath(): Promise<string> {
  const status = await checkDep('yt-dlp')
  if (!status.path) {
    throw new Error('yt-dlp not installed')
  }
  return status.path
}

/** Informações rápidas de um vídeo (apenas título e thumbnail) */
export interface QuickVideoInfo {
  title: string
  thumbnail: string
}

/**
 * Busca título e thumbnail de um vídeo de forma rápida.
 * Usa --skip-download e --print para extrair apenas os metadados sem baixar nada.
 * Aceita cookies opcionais para vídeos com restrição de acesso.
 *
 * @param url - URL do vídeo
 * @param cookies - Configurações de cookies opcionais
 * @returns Título e thumbnail do vídeo
 */
export async function fetchQuickInfo(
  url: string,
  cookies?: CookieOptions
): Promise<QuickVideoInfo> {
  const ytdlpPath = await getYtdlpPath()

  return new Promise((resolve) => {
    const args: string[] = []

    if (cookies?.useCookies) {
      args.push('--cookies-from-browser', cookies.cookieBrowser)
    }

    // Usa --print para pegar só título e thumbnail sem baixar o vídeo
    args.push('--skip-download', '--no-playlist', '--print', '%(title)s\n%(thumbnail)s', url)

    const childProcess = spawn(ytdlpPath, args)
    let stdoutBuffer = ''

    childProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString()
    })

    childProcess.on('close', (exitCode) => {
      if (exitCode !== 0) {
        // Se falhar, retorna valores padrão sem lançar erro
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

/**
 * Lista os formatos disponíveis de um vídeo usando `yt-dlp -j`.
 * O flag `-j` retorna todas as informações do vídeo em formato JSON,
 * incluindo a lista de formatos com resolução, codec, tamanho etc.
 *
 * Importante: passa cookies quando disponível, pois o YouTube exige autenticação
 * para listar formatos 4K (2160p) e premium (AV1, VP9 de alta qualidade).
 *
 * @param url - URL do vídeo do YouTube
 * @param cookies - Configurações de cookies opcionais
 * @returns Objeto com informações do vídeo e lista de formatos
 */
export async function listFormats(url: string, cookies?: CookieOptions): Promise<VideoInfo> {
  const ytdlpPath = await getYtdlpPath()

  return new Promise((resolve, reject) => {
    const args: string[] = []

    // Passa cookies para que o YouTube libere formatos 4K e premium
    if (cookies?.useCookies) {
      args.push('--cookies-from-browser', cookies.cookieBrowser)
    }

    args.push('-j', '--no-playlist', url)

    const childProcess = spawn(ytdlpPath, args)

    let stdoutBuffer = ''
    let stderrBuffer = ''

    childProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString()
    })

    childProcess.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString()
    })

    childProcess.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stderrBuffer || `yt-dlp exited with code ${exitCode}`))
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

        resolve(videoInfo)
      } catch (parseError) {
        reject(new Error(`Failed to parse yt-dlp output: ${parseError}`))
      }
    })
  })
}

/**
 * Inicia o download de um vídeo e envia eventos de progresso em tempo real para o renderer.
 *
 * Monta a linha de comando do yt-dlp com as opções fornecidas e parseia a stdout
 * para extrair porcentagem, velocidade e tempo estimado. Usa o flag `--newline`
 * para que cada atualização de progresso venha em uma nova linha, facilitando o parsing.
 *
 * @param options - Configurações do download (URL, formato, cookies, diretório de saída)
 * @param mainWindow - Janela principal para enviar eventos IPC
 */
export async function startDownload(
  options: DownloadOptions,
  mainWindow: BrowserWindow
): Promise<void> {
  const ytdlpPath = await getYtdlpPath()

  // Monta os argumentos do yt-dlp
  const args: string[] = []

  // Cookies do navegador (se habilitado)
  if (options.useCookies) {
    args.push('--cookies-from-browser', options.cookieBrowser)
  }

  // Formato de vídeo/áudio
  const format = options.formatId || 'bestvideo+bestaudio'
  args.push('-f', format)

  // Formato de saída após merge de vídeo+áudio
  args.push('--merge-output-format', options.mergeFormat || 'mkv')

  // Template do caminho de saída
  args.push('-o', `${options.outputDir}/%(title)s.%(ext)s`)

  // Modo newline: cada atualização de progresso fica em uma linha separada
  args.push('--newline')

  // Template de progresso customizado para facilitar o parsing
  args.push(
    '--progress-template',
    'download:%(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s'
  )

  args.push(options.url)

  const childProcess = spawn(ytdlpPath, args)
  activeProcesses.set(options.id, childProcess)

  // Regex para parsear linhas de progresso no formato: "  45.2% 12.3MiB/s 00:32"
  const progressRegex = /^\s*([\d.]+)%\s+(.+?)\s+(\S+)\s*$/

  childProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n')

    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine) continue

      const match = trimmedLine.match(progressRegex)
      if (match) {
        mainWindow.webContents.send('download:progress', {
          id: options.id,
          percent: parseFloat(match[1]),
          speed: match[2],
          eta: match[3]
        })
      }
    }
  })

  childProcess.stderr.on('data', (data) => {
    const errorText = data.toString().trim()
    if (errorText) {
      mainWindow.webContents.send('download:error', {
        id: options.id,
        error: errorText
      })
    }
  })

  childProcess.on('close', (exitCode) => {
    activeProcesses.delete(options.id)

    if (exitCode === 0) {
      // Download concluído com sucesso — notifica renderer e mostra notificação nativa
      mainWindow.webContents.send('download:complete', { id: options.id })

      const notification = new Notification({
        title: 'Download Complete',
        body: 'Download finished successfully!',
        silent: false
      })
      notification.show()
    } else {
      mainWindow.webContents.send('download:error', {
        id: options.id,
        error: `yt-dlp exited with code ${exitCode}`
      })
    }
  })

  childProcess.on('error', (err) => {
    activeProcesses.delete(options.id)
    mainWindow.webContents.send('download:error', {
      id: options.id,
      error: err.message
    })
  })
}

/**
 * Cancela um download em andamento.
 * Envia SIGTERM para o processo filho do yt-dlp.
 *
 * @param id - ID do download a cancelar
 * @returns true se o processo foi encontrado e cancelado, false se não existia
 */
export function cancelDownload(id: string): boolean {
  const childProcess = activeProcesses.get(id)

  if (childProcess) {
    childProcess.kill('SIGTERM')
    activeProcesses.delete(id)
    return true
  }

  return false
}
