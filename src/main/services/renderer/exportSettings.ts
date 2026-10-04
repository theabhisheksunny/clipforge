/**
 * Translates ExportSettings into concrete FFmpeg encoder arguments.
 */

import {
  RESOLUTION_DIMENSIONS,
  type Canvas,
  type ExportSettings,
  type ExportVideoCodec,
  type ExportAudioCodec,
} from '@shared/types';

export interface EncoderConfig {
  width: number;
  height: number;
  fps: number | null;
  videoArgs: string[];
  audioArgs: string[];
  hasAudio: boolean;
}

const CRF_BY_QUALITY: Record<string, number> = {
  low: 30,
  medium: 24,
  high: 20,
};

function videoCodecArgs(codec: ExportVideoCodec, crf: number): string[] {
  switch (codec) {
    case 'h264':
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
    case 'h265':
      return ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'];
    case 'vp9':
      return ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-pix_fmt', 'yuv420p'];
    default:
      return ['-c:v', 'libx264', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
  }
}

function audioCodecArgs(codec: ExportAudioCodec): string[] {
  switch (codec) {
    case 'aac':
      return ['-c:a', 'aac', '-b:a', '192k'];
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', '160k'];
    case 'none':
      return ['-an'];
    default:
      return ['-c:a', 'aac', '-b:a', '192k'];
  }
}

/** Round to the nearest even integer (H.264/HEVC require even dimensions). */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * Derive export dimensions from the project canvas aspect ratio, using the
 * selected resolution preset as a QUALITY TIER (its shorter edge sets the
 * target). This makes a 9:16 project export 1080x1920 at "1080p", a 1:1 project
 * 1080x1080, etc. — instead of forcing every export to the preset's 16:9 size.
 */
export function resolveExportDimensions(
  canvas: Canvas,
  resolution: ExportSettings['resolution'],
): { width: number; height: number } {
  const preset = RESOLUTION_DIMENSIONS[resolution];
  // The quality tier is the preset's shorter edge (e.g. 1080p => 1080).
  const tier = Math.min(preset.width, preset.height);
  const cw = canvas.width > 0 ? canvas.width : 16;
  const ch = canvas.height > 0 ? canvas.height : 9;
  const ratio = cw / ch;
  if (ratio >= 1) {
    // Landscape or square: height = tier, width from ratio.
    return { width: even(tier * ratio), height: even(tier) };
  }
  // Portrait: width = tier, height from ratio.
  return { width: even(tier), height: even(tier / ratio) };
}

export function buildEncoderConfig(
  settings: ExportSettings,
  sourceFps: number,
  canvas: Canvas,
): EncoderConfig {
  const dims = resolveExportDimensions(canvas, settings.resolution);
  const crf =
    settings.quality === 'custom' && settings.customCrf != null
      ? settings.customCrf
      : CRF_BY_QUALITY[settings.quality] ?? 23;

  const fps = settings.fps === 'source' ? sourceFps : Number(settings.fps);

  return {
    width: dims.width,
    height: dims.height,
    fps: Number.isFinite(fps) && fps > 0 ? fps : null,
    videoArgs: videoCodecArgs(settings.videoCodec, crf),
    audioArgs: audioCodecArgs(settings.audioCodec),
    hasAudio: settings.audioCodec !== 'none',
  };
}
