/**
 * Pixel sampling helper: extract one frame from a video at a given time and
 * read the RGB value at a normalized (x,y) position. Used to objectively verify
 * overlay/transform/aspect behavior in exported files (not just dimensions).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function ffmpegPath(): string {
  // ffmpeg-static default export is the absolute path string.
  // Resolve via require to avoid ESM/CJS interop issues in the test runner.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const p = require('ffmpeg-static') as string;
  return p;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Returns the RGB of the pixel at normalized (nx, ny) in [0,1] from the frame
 * at `atSeconds`. Works by cropping a 1x1 region at that pixel and emitting a
 * raw RGB value via a tiny PPM.
 */
interface Ppm {
  w: number;
  h: number;
  data: Buffer; // RGB24, row-major
}

/** Extract a single full frame at `atSeconds` as a decoded PPM (P6). */
function extractFrame(videoPath: string, atSeconds: number): Ppm {
  const ff = ffmpegPath();
  const tmp = join(tmpdir(), `frame-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ppm`);
  const res = spawnSync(
    ff,
    [
      '-hide_banner', '-loglevel', 'error',
      '-ss', String(atSeconds),
      '-i', videoPath,
      '-frames:v', '1',
      '-f', 'image2',
      '-c:v', 'ppm',
      '-y', tmp,
    ],
    { windowsHide: true },
  );
  if (res.status !== 0 || !existsSync(tmp)) {
    throw new Error(`extractFrame failed: ${res.stderr?.toString() ?? 'unknown'}`);
  }
  try {
    const buf = readFileSync(tmp);
    // Parse P6 header: magic, width, height, maxval, then binary.
    let offset = 0;
    const readToken = (): string => {
      while (offset < buf.length && isWs(buf[offset])) offset++;
      const start = offset;
      while (offset < buf.length && !isWs(buf[offset])) offset++;
      return buf.toString('ascii', start, offset);
    };
    const magic = readToken();
    const w = parseInt(readToken(), 10);
    const h = parseInt(readToken(), 10);
    readToken(); // maxval
    offset++; // single whitespace after maxval precedes binary data
    if (magic !== 'P6' || !w || !h) {
      throw new Error(`unexpected PPM header: ${magic} ${w}x${h}`);
    }
    return { w, h, data: buf.subarray(offset) };
  } finally {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** RGB at normalized (nx,ny) in [0,1] from the frame at `atSeconds`. */
export function samplePixel(
  videoPath: string,
  atSeconds: number,
  nx: number,
  ny: number,
): RGB {
  const frame = extractFrame(videoPath, atSeconds);
  const x = Math.max(0, Math.min(frame.w - 1, Math.floor((frame.w - 1) * nx)));
  const y = Math.max(0, Math.min(frame.h - 1, Math.floor((frame.h - 1) * ny)));
  const idx = (y * frame.w + x) * 3;
  return { r: frame.data[idx], g: frame.data[idx + 1], b: frame.data[idx + 2] };
}

function isWs(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

export function isBlackish(rgb: RGB, threshold = 24): boolean {
  return rgb.r <= threshold && rgb.g <= threshold && rgb.b <= threshold;
}

export function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}
