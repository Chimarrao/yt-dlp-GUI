/**
 * Módulo de gestão de dependências externas (yt-dlp e ffmpeg).
 *
 * Responsável por verificar se os binários estão disponíveis no PATH do sistema
 * e, caso não estejam, instalar automaticamente usando o gerenciador de pacotes
 * apropriado para cada plataforma (brew no macOS, apt no Linux, download direto no Windows).
 */

import { execFile, exec } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, createWriteStream, chmodSync, mkdirSync, readdirSync } from 'fs'
import https from 'https'
import { Platform, getCurrentPlatform, getWhichCommand, isWindows } from '../shared/constants'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

/**
 * Retorna o diretório local onde salvamos binários baixados (apenas Windows).
 * Fica dentro do userData do Electron para não exigir permissão de admin.
 */
function getUserBinPath(): string {
  return join(app.getPath('userData'), 'bin')
}

/**
 * Tenta localizar um binário no PATH do sistema.
 * Se não encontrar, verifica também no diretório local de binários do app.
 *
 * @param name - Nome do binário (ex: 'yt-dlp', 'ffmpeg')
 * @returns Caminho absoluto do binário ou null se não encontrado
 */
function findInPath(name: string): Promise<string | null> {
  const whichCmd = getWhichCommand()

  return execFileAsync(whichCmd, [name])
    .then((result) => result.stdout.trim().split('\n')[0])
    .catch(() => {
      // Se não achou no PATH, verifica no diretório local de binários do app
      const extension = isWindows() ? '.exe' : ''
      const localBin = join(getUserBinPath(), name + extension)

      return existsSync(localBin) ? localBin : null
    })
}

/**
 * Faz download de um arquivo via HTTPS com suporte a redirecionamentos (301/302).
 *
 * @param url - URL de origem
 * @param dest - Caminho de destino no disco
 * @returns void
 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const followRedirects = (currentUrl: string): void => {
      https
        .get(currentUrl, (response) => {
          // Segue redirecionamentos automaticamente
          if (response.statusCode === 301 || response.statusCode === 302) {
            followRedirects(response.headers.location!)
            return
          }

          const fileStream = createWriteStream(dest)
          response.pipe(fileStream)

          fileStream.on('finish', () => {
            fileStream.close()
            resolve()
          })
        })
        .on('error', reject)
    }

    followRedirects(url)
  })
}

/**
 * Instala um binário de acordo com a plataforma do sistema operacional.
 * - macOS: usa `brew install`
 * - Linux: usa `sudo apt install -y`
 * - Windows: faz download direto do binário via HTTPS
 *
 * @param name - Nome do binário a instalar
 * @returns Caminho absoluto do binário instalado
 * @throws Error se a instalação falhar ou a plataforma não for suportada
 */
async function installBinary(name: 'yt-dlp' | 'ffmpeg'): Promise<string> {
  const platform = getCurrentPlatform()

  if (platform === Platform.Mac) {
    await execAsync(`brew install ${name}`)
    const path = await findInPath(name)
    if (!path) {
      throw new Error(`Failed to install ${name} via brew`)
    }
    return path
  }

  if (platform === Platform.Linux) {
    const packageName = name === 'yt-dlp' ? 'yt-dlp' : 'ffmpeg';
    await execAsync(`sudo apt install -y ${packageName}`);
    const path = await findInPath(name);
    if (!path) {
      throw new Error(`Failed to install ${name} via apt`);
    }
    return path;
  }

  if (platform === Platform.Windows) {
    const binDir = getUserBinPath()
    mkdirSync(binDir, { recursive: true })

    if (name === 'yt-dlp') {
      const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      const dest = join(binDir, 'yt-dlp.exe')
      await downloadFile(downloadUrl, dest)
      return dest
    }

    // ffmpeg no Windows — baixa o build GPL e extrai com PowerShell
    const downloadUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
    const zipDest = join(binDir, 'ffmpeg.zip')
    await downloadFile(downloadUrl, zipDest)

    await execAsync(
      `powershell -Command "Expand-Archive -Path '${zipDest}' -DestinationPath '${binDir}' -Force"`
    )

    // Procura a pasta extraída que começa com 'ffmpeg-'
    const extractedFolder = readdirSync(binDir).find((f) => f.startsWith('ffmpeg-'))
    if (!extractedFolder) {
      throw new Error('Failed to extract ffmpeg')
    }
    return join(binDir, extractedFolder, 'bin', 'ffmpeg.exe')
  }

  throw new Error(`Unsupported platform: ${platform}`)
}

// ── Tipos exportados ──

/** Status de uma dependência (nome, se está instalada, caminho e versão) */
export interface DepStatus {
  name: string
  installed: boolean
  path: string | null
  version: string | null
}

/**
 * Verifica se uma dependência está instalada e retorna seu status.
 *
 * @param name - Nome do binário a verificar
 * @returns Status da dependência com caminho e versão
 */
export async function checkDep(name: 'yt-dlp' | 'ffmpeg'): Promise<DepStatus> {
  const path = await findInPath(name)

  if (!path) {
    return { name, installed: false, path: null, version: null }
  }

  try {
    const { stdout } = await execFileAsync(path, ['--version'])
    return { name, installed: true, path, version: stdout.trim().split('\n')[0] }
  } catch {
    return { name, installed: true, path, version: 'unknown' }
  }
}

/**
 * Garante que uma dependência esteja instalada.
 * Se não estiver, instala automaticamente e retorna o novo status.
 *
 * @param name - Nome do binário a garantir
 * @returns Status atualizado da dependência
 */
export async function ensureDep(name: 'yt-dlp' | 'ffmpeg'): Promise<DepStatus> {
  let status = await checkDep(name)
  if (status.installed) {
    return status;
  }

  const installedPath = await installBinary(name)

  // No Unix, garante permissão de execução (pode não ser necessário via gerenciador de pacotes)
  if (!isWindows()) {
    try {
      chmodSync(installedPath, 0o755)
    } catch {
      // Ignora — gerenciadores de pacotes já setam permissões
    }
  }

  status = await checkDep(name)
  return status
}
