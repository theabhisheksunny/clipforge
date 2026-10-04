/**
 * Media metadata extraction via ffprobe (spec section 2/27).
 * Returns structured MediaMetadata without ever modifying the source file.
 */

import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { getBinaryPaths } from '../ffmpeg/ffmpegLocator';
import type {
  AudioStreamInfo,
  MediaMetadata,
  VideoStreamInfo,
} from '@shared/types';

interface FfprobeStream {
  index: number;
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  display_aspect_ratio?: string;
  bit_rate?: string;
  pix_fmt?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
}

interface FfprobeFormat {
  duration?: string;
  format_name?: string;
  size?: string;
  bit_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

function parseFps(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split('/').map(Number);
  if (!den || Number.isNaN(num) || Number.isNaN(den)) return 0;
  return Math.round((num / den) * 1000) / 1000;
}

function runFfprobe(path: string): Promise<FfprobeOutput> {
  const { ffprobePath } = getBinaryPaths();
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    path,
  ];
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const child = spawn(ffprobePath, args, { windowsHide: true });
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err || `ffprobe exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(out) as FfprobeOutput);
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${String(e)}`));
      }
    });
  });
}

export async function probeMediaMetadata(path: string): Promise<MediaMetadata> {
  const probe = await runFfprobe(path);
  const streams = probe.streams ?? [];
  const format = probe.format ?? {};

  const videoStreams: VideoStreamInfo[] = streams
    .filter((s) => s.codec_type === 'video')
    .map((s) => ({
      index: s.index,
      codec: s.codec_name ?? 'unknown',
      width: s.width ?? 0,
      height: s.height ?? 0,
      fps: parseFps(s.avg_frame_rate) || parseFps(s.r_frame_rate),
      aspectRatio:
        s.display_aspect_ratio ??
        (s.width && s.height ? `${s.width}:${s.height}` : 'unknown'),
      bitRate: s.bit_rate ? Number(s.bit_rate) : null,
      pixelFormat: s.pix_fmt ?? null,
    }));

  const audioStreams: AudioStreamInfo[] = streams
    .filter((s) => s.codec_type === 'audio')
    .map((s) => ({
      index: s.index,
      codec: s.codec_name ?? 'unknown',
      sampleRate: s.sample_rate ? Number(s.sample_rate) : 0,
      channels: s.channels ?? 0,
      channelLayout: s.channel_layout ?? null,
      bitRate: s.bit_rate ? Number(s.bit_rate) : null,
    }));

  let sizeBytes = format.size ? Number(format.size) : 0;
  if (!sizeBytes) {
    try {
      sizeBytes = statSync(path).size;
    } catch {
      sizeBytes = 0;
    }
  }

  const metadata: MediaMetadata = {
    duration: format.duration ? Number(format.duration) : 0,
    format: format.format_name ?? null,
    sizeBytes,
    bitRate: format.bit_rate ? Number(format.bit_rate) : null,
    videoStreams,
    audioStreams,
  };

  // For still images ffprobe reports a video stream with duration 0.
  if (videoStreams.length && metadata.duration === 0) {
    metadata.imageWidth = videoStreams[0].width;
    metadata.imageHeight = videoStreams[0].height;
  }

  return metadata;
}
