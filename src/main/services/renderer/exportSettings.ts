/**
 * Translates ExportSettings into concrete FFmpeg encoder arguments.
 */

import {
  RESOLUTION_DIMENSIONS,
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

export function buildEncoderConfig(settings: ExportSettings, sourceFps: number): EncoderConfig {
  const dims = RESOLUTION_DIMENSIONS[settings.resolution];
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
