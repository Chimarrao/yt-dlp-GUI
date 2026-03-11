/**
 * Módulo de gestão de dependências externas (yt-dlp e ffmpeg).
 *
 * Verifica se os binários estão no PATH e instala automaticamente
 * usando o gerenciador de pacotes da plataforma.
 */

import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, createWriteStream, chmodSync, mkdirSync, readdirSync } from 'fs';
import https from 'https';
import { Platform, getCurrentPlatform, getWhichCommand, isWindows } from '../shared/constants';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

function getUserBinPath(): string {
  return join(app.getPath('userData'), 'bin');
}

/**
 * Localiza um binário no PATH ou no diretório local.
 *
 * @param name - Nome do binário
 * @returns Caminho absoluto ou null
 */
function findInPath(name: string): Promise<string | null> {
  const whichCmd = getWhichCommand();

  return execFileAsync(whichCmd, [name])
    .then((result) => result.stdout.trim().split('\n')[0])
    .catch(() => {
      const extension = isWindows() ? '.exe' : '';
      const localBin = join(getUserBinPath(), name + extension);
      return existsSync(localBin) ? localBin : null;
    });
}

/**
 * Faz download de um arquivo via HTTPS com redirecionamentos.
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
          if (response.statusCode === 301 || response.statusCode === 302) {
            followRedirects(response.headers.location!);
            return;
          }

          const fileStream = createWriteStream(dest);
          response.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
        })
        .on('error', reject);
    };

    followRedirects(url);
  });
}

/**
 * Instala um binário de acordo com a plataforma.
 *
 * @param name - Nome do binário
 * @returns Caminho do binário instalado
 */
async function installBinary(name: 'yt-dlp' | 'ffmpeg'): Promise<string> {
  const platform = getCurrentPlatform();

  if (platform === Platform.Mac) {
    await execAsync(`brew install ${name}`);
    const path = await findInPath(name);
    if (!path) {
      throw new Error(`Failed to install ${name} via brew`);
    }
    return path;
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
    const binDir = getUserBinPath();
    mkdirSync(binDir, { recursive: true });

    if (name === 'yt-dlp') {
      const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
      const dest = join(binDir, 'yt-dlp.exe');
      await downloadFile(downloadUrl, dest);
      return dest;
    }

    const downloadUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
    const zipDest = join(binDir, 'ffmpeg.zip');
    await downloadFile(downloadUrl, zipDest);

    await execAsync(
      `powershell -Command "Expand-Archive -Path '${zipDest}' -DestinationPath '${binDir}' -Force"`
    );

    const extractedFolder = readdirSync(binDir).find((f) => f.startsWith('ffmpeg-'));
    if (!extractedFolder) {
      throw new Error('Failed to extract ffmpeg');
    }
    return join(binDir, extractedFolder, 'bin', 'ffmpeg.exe');
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

export interface DepStatus {
  name: string;
  installed: boolean;
  path: string | null;
  version: string | null;
}

/**
 * Verifica se uma dependência está instalada.
 *
 * @param name - Nome do binário
 * @returns Status com caminho e versão
 */
export async function checkDep(name: 'yt-dlp' | 'ffmpeg'): Promise<DepStatus> {
  const path = await findInPath(name);

  if (!path) {
    return { name, installed: false, path: null, version: null };
  }

  try {
    const { stdout } = await execFileAsync(path, ['--version']);
    return { name, installed: true, path, version: stdout.trim().split('\n')[0] };
  } catch {
    return { name, installed: true, path, version: 'unknown' };
  }
}

/**
 * Garante que uma dependência esteja instalada.
 *
 * @param name - Nome do binário
 * @returns Status atualizado
 */
export async function ensureDep(name: 'yt-dlp' | 'ffmpeg'): Promise<DepStatus> {
  let status = await checkDep(name);
  if (status.installed) {
    return status;
  }

  const installedPath = await installBinary(name);

  if (!isWindows()) {
    try {
      chmodSync(installedPath, 0o755);
    } catch {
      // ignora
    }
  }

  status = await checkDep(name);
  return status;
}
