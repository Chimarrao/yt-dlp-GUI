export interface SelectableFormat {
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

export interface ResolvedFormatSelection<T extends SelectableFormat = SelectableFormat> {
  selectedFormat: T
  resolvedFormatId: string
}

const GENERIC_FORMAT_SELECTOR_REGEX = /(^|\+)(best|bestaudio|bestvideo)(?:\[[^\]]+\])?($|\+)/i

function hasVideo(format: SelectableFormat): boolean {
  return format.vcodec !== 'none'
}

function hasAudio(format: SelectableFormat): boolean {
  return format.acodec !== 'none'
}

function getEstimatedSize(format: SelectableFormat): number {
  return format.filesize || format.filesize_approx || 0
}

/**
 * Pontuação de compatibilidade do codec de vídeo.
 * Usada como desempate final: H.264 é preferido por máxima compatibilidade
 * com players, dispositivos e o processo de merge com ffmpeg.
 * Quanto maior a pontuação, mais compatível.
 */
function getVideoCodecCompatibilityScore(vcodec: string): number {
  if (!vcodec || vcodec === 'none') return -1
  if (vcodec.startsWith('avc1')) return 4 // H.264 — máxima compatibilidade
  if (vcodec.startsWith('vp09') || vcodec.startsWith('vp9')) return 3 // VP9 — boa compatibilidade
  if (vcodec.startsWith('hev1') || vcodec.startsWith('hvc1')) return 2 // H.265 — exige suporte de hardware
  if (vcodec.startsWith('av01')) return 1 // AV1 — menor compatibilidade (mas maior qualidade/compressão)
  return 2 // codec desconhecido — pontuação neutra
}

function getVideoFormats<T extends SelectableFormat>(formats: T[]): T[] {
  return formats.filter((format) => hasVideo(format))
}

function getMuxedFormats<T extends SelectableFormat>(formats: T[]): T[] {
  return formats.filter((format) => hasVideo(format) && hasAudio(format))
}

function getAudioFormats<T extends SelectableFormat>(formats: T[]): T[] {
  const audioOnly = formats.filter((format) => !hasVideo(format) && hasAudio(format))
  return audioOnly.length > 0 ? audioOnly : formats.filter((format) => hasAudio(format))
}

function sortFormatsByQuality<T extends SelectableFormat>(formats: T[]): T[] {
  return [...formats].sort((a, b) => {
    const heightDiff = (b.height || 0) - (a.height || 0)
    if (heightDiff !== 0) {
      return heightDiff
    }

    const fpsDiff = (b.fps || 0) - (a.fps || 0)
    if (fpsDiff !== 0) {
      return fpsDiff
    }

    const bitrateDiff = (b.tbr || 0) - (a.tbr || 0)
    if (bitrateDiff !== 0) {
      return bitrateDiff
    }

    const sizeDiff = getEstimatedSize(b) - getEstimatedSize(a)
    if (sizeDiff !== 0) {
      return sizeDiff
    }

    // Desempate final: prefere codec mais compatível (H.264 > VP9 > H.265 > AV1)
    return getVideoCodecCompatibilityScore(b.vcodec) - getVideoCodecCompatibilityScore(a.vcodec)
  })
}

function pickBestAudioFormat<T extends SelectableFormat>(formats: T[]): T | null {
  return sortFormatsByQuality(getAudioFormats(formats))[0] || null
}

function pickBestMuxedFormat<T extends SelectableFormat>(formats: T[]): T | null {
  return sortFormatsByQuality(getMuxedFormats(formats))[0] || null
}

function pickBestVideoFormat<T extends SelectableFormat>(
  formats: T[],
  maxHeight?: number
): T | null {
  const videoFormats = getVideoFormats(formats)
  if (videoFormats.length === 0) {
    return null
  }

  const withinHeight =
    typeof maxHeight === 'number'
      ? videoFormats.filter(
          (format) => (format.height || 0) > 0 && (format.height || 0) <= maxHeight
        )
      : videoFormats

  const candidates = withinHeight.length > 0 ? withinHeight : videoFormats
  const sorted = [...candidates].sort((a, b) => {
    const aVideoOnlyScore = hasAudio(a) ? 0 : 1
    const bVideoOnlyScore = hasAudio(b) ? 0 : 1
    if (aVideoOnlyScore !== bVideoOnlyScore) {
      return bVideoOnlyScore - aVideoOnlyScore
    }

    return sortFormatsByQuality([a, b])[0] === a ? -1 : 1
  })

  return sorted[0] || null
}

function buildResolvedFormatId(format: SelectableFormat, mergeWithBestAudio: boolean): string {
  if (mergeWithBestAudio && hasVideo(format) && !hasAudio(format)) {
    return `${format.format_id}+bestaudio`
  }
  return format.format_id
}

function parseRequestedHeightCap(formatId: string): number | null {
  const match = formatId.match(/^bestvideo\[height<=([0-9]+)\]\+bestaudio$/i)
  return match ? Number(match[1]) : null
}

/**
 * Converte o campo `vcodec` do yt-dlp em nome amigável para exibição na UI.
 */
export function codecLabel(vcodec: string): string {
  if (!vcodec || vcodec === 'none') return ''
  if (vcodec.startsWith('avc1')) return 'H.264'
  if (vcodec.startsWith('hev1') || vcodec.startsWith('hvc1')) return 'H.265'
  if (vcodec.startsWith('av01')) return 'AV1'
  if (vcodec.startsWith('vp09') || vcodec.startsWith('vp9')) return 'VP9'
  if (vcodec.startsWith('vp08') || vcodec.startsWith('vp8')) return 'VP8'
  if (vcodec.startsWith('mp4a')) return 'AAC'
  if (vcodec.startsWith('opus')) return 'Opus'
  return vcodec.split('.')[0]
}

export function isGenericFormatSelector(formatId?: string): boolean {
  const normalized = (formatId || '').trim()
  if (!normalized) {
    return true
  }

  return GENERIC_FORMAT_SELECTOR_REGEX.test(normalized)
}

export function resolveRequestedFormatSelection<T extends SelectableFormat>(
  formats: T[],
  requestedFormatId?: string
): ResolvedFormatSelection<T> | null {
  if (formats.length === 0) {
    return null
  }

  const requested = (requestedFormatId || '').trim()
  if (!requested) {
    return null
  }

  if (!isGenericFormatSelector(requested)) {
    const exact = formats.find((format) => format.format_id === requested)
    if (exact) {
      return { selectedFormat: exact, resolvedFormatId: requested }
    }

    const primaryId = requested.split('+')[0]
    const selectedFormat = formats.find((format) => format.format_id === primaryId)
    return selectedFormat ? { selectedFormat, resolvedFormatId: requested } : null
  }

  if (requested === 'best') {
    const bestMuxed = pickBestMuxedFormat(formats)
    if (bestMuxed) {
      return {
        selectedFormat: bestMuxed,
        resolvedFormatId: bestMuxed.format_id
      }
    }
  }

  if (requested === 'bestaudio') {
    const bestAudio = pickBestAudioFormat(formats)
    return bestAudio
      ? {
          selectedFormat: bestAudio,
          resolvedFormatId: bestAudio.format_id
        }
      : null
  }

  if (requested === 'bestvideo+bestaudio' || requested.startsWith('bestvideo[')) {
    const maxHeight = parseRequestedHeightCap(requested) ?? undefined
    const bestVideo = pickBestVideoFormat(formats, maxHeight)
    return bestVideo
      ? {
          selectedFormat: bestVideo,
          resolvedFormatId: buildResolvedFormatId(bestVideo, true)
        }
      : null
  }

  return null
}
