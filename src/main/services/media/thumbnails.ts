/**
 * Thumbnail and waveform generation. Both run FFmpeg out-of-band and cache
 * their results so the UI stays responsive (spec sections 14, 28).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runFfmpeg } from '../ffmpeg/ffmpegRunner';
import { cacheFilePath } from '../cache/cachePaths';
import type { WaveformData } from '@shared/types';

function keyFor(path: string, suffix: string): string {
  let mtime = 0;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    /* file may be missing */
  }
  return createHash('sha1').update(`${path}:${mtime}:${suffix}`).digest('hex');
}

/**
 * Extract a single frame as a JPEG and return it as a data URL. For images we
 * downscale the image itself. Cached by path+mtime.
 */
export async function generateThumbnail(
  path: string,
  atSeconds = 1,
  width = 240,
): Promise<string | null> {
  if (!existsSync(path)) return null;
  const outFile = cacheFilePath('thumbnails', `${keyFor(path, `t${atSeconds}w${width}`)}.jpg`);

  if (!existsSync(outFile)) {
    const result = await runFfmpeg({
      args: [
        '-ss', String(atSeconds),
        '-i', path,
        '-frames:v', '1',
        '-vf', `scale=${width}:-1`,
        '-q:v', '4',
        '-y', outFile,
      ],
    });
    if (result.code !== 0 || !existsSync(outFile)) {
      // Retry at t=0 for very short clips.
      const retry = await runFfmpeg({
        args: ['-i', path, '-frames:v', '1', '-vf', `scale=${width}:-1`, '-q:v', '4', '-y', outFile],
      });
      if (retry.code !== 0 || !existsSync(outFile)) return null;
    }
  }

  try {
    const buf = readFileSync(outFile);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Produce normalized audio peak data for waveform rendering. Uses FFmpeg to
 * downsample to a mono low-rate PCM stream, then buckets peaks. Cached as JSON.
 */
export async function generateWaveform(
  assetId: string,
  path: string,
  buckets = 1000,
): Promise<WaveformData | null> {
  if (!existsSync(path)) return null;
  const cacheFile = cacheFilePath('waveforms', `${keyFor(path, `wf${buckets}`)}.json`);

  if (existsSync(cacheFile)) {
    try {
      const parsed = JSON.parse(readFileSync(cacheFile, 'utf-8')) as WaveformData;
      return { ...parsed, assetId };
    } catch {
      /* regenerate on parse failure */
    }
  }

  // Decode to raw signed 16-bit mono PCM at a low sample rate.
  const sampleRate = 8000;
  const pcmFile = cacheFilePath('temp', `${keyFor(path, 'pcm')}.raw`);
  const result = await runFfmpeg({
    args: [
      '-i', path,
      '-ac', '1',
      '-ar', String(sampleRate),
      '-f', 's16le',
      '-y', pcmFile,
    ],
  });
  if (result.code !== 0 || !existsSync(pcmFile)) return null;

  let peaks: number[];
  try {
    const buf = readFileSync(pcmFile);
    const sampleCount = Math.floor(buf.length / 2);
    const samplesPerBucket = Math.max(1, Math.floor(sampleCount / buckets));
    peaks = new Array(Math.min(buckets, sampleCount)).fill(0);
    for (let b = 0; b < peaks.length; b++) {
      let peak = 0;
      const start = b * samplesPerBucket;
      const end = Math.min(sampleCount, start + samplesPerBucket);
      for (let i = start; i < end; i++) {
        const v = Math.abs(buf.readInt16LE(i * 2)) / 32768;
        if (v > peak) peak = v;
      }
      peaks[b] = Math.round(peak * 1000) / 1000;
    }
  } catch {
    return null;
  }

  const data: WaveformData = { assetId, peaks, samplesPerPeak: sampleRate };
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(cacheFile, JSON.stringify(data));
  } catch {
    /* cache write is best-effort */
  }
  return data;
}
