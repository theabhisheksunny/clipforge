/**
 * Locates and verifies FFmpeg / FFprobe binaries (spec section 27).
 *
 * Resolution order:
 *   1. Explicit override from app settings / env (FFMPEG_PATH, FFPROBE_PATH).
 *   2. Bundled binaries from ffmpeg-static / ffprobe-static.
 *   3. System PATH ("ffmpeg" / "ffprobe").
 *
 * Verification runs `-version` and parses the result. A friendly status is
 * returned so the renderer can show a clear error instead of crashing.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { FfmpegStatus } from '@shared/types';

// ffmpeg-static exports the binary path as its default export (string | null).
// ffprobe-static exports { path }. Both may be unpacked from the asar at runtime.
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

/** When packaged, binaries live under app.asar.unpacked. Fix the path. */
function unpackedPath(p: string | null | undefined): string | null {
  if (!p) return null;
  return p.replace('app.asar', 'app.asar.unpacked');
}

function resolveFfmpegPath(): string | null {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const bundled = unpackedPath(ffmpegStatic as unknown as string | null);
  if (bundled && existsSync(bundled)) return bundled;
  // Fall back to PATH lookup; verification will confirm it works.
  return 'ffmpeg';
}

function resolveFfprobePath(): string | null {
  if (process.env.FFPROBE_PATH && existsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH;
  }
  const bundled = unpackedPath((ffprobeStatic as { path?: string })?.path);
  if (bundled && existsSync(bundled)) return bundled;
  return 'ffprobe';
}

function runVersion(binary: string): Promise<{ ok: boolean; version: string | null }> {
  return new Promise((resolve) => {
    try {
      const child = spawn(binary, ['-version'], { windowsHide: true });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.on('error', () => resolve({ ok: false, version: null }));
      child.on('close', (code) => {
        if (code === 0) {
          const match = out.match(/version\s+(\S+)/i);
          resolve({ ok: true, version: match ? match[1] : 'unknown' });
        } else {
          resolve({ ok: false, version: null });
        }
      });
    } catch {
      resolve({ ok: false, version: null });
    }
  });
}

let cached: { ffmpegPath: string; ffprobePath: string } | null = null;

/** Returns resolved paths, caching after first successful verification. */
export function getBinaryPaths(): { ffmpegPath: string; ffprobePath: string } {
  if (cached) return cached;
  const ffmpegPath = resolveFfmpegPath() ?? 'ffmpeg';
  const ffprobePath = resolveFfprobePath() ?? 'ffprobe';
  return { ffmpegPath, ffprobePath };
}

export async function verifyFfmpeg(): Promise<FfmpegStatus> {
  const { ffmpegPath, ffprobePath } = getBinaryPaths();

  const [ffmpeg, ffprobe] = await Promise.all([
    runVersion(ffmpegPath),
    runVersion(ffprobePath),
  ]);

  if (ffmpeg.ok && ffprobe.ok) {
    cached = { ffmpegPath, ffprobePath };
    return {
      available: true,
      ffmpegPath,
      ffprobePath,
      ffmpegVersion: ffmpeg.version,
      ffprobeVersion: ffprobe.version,
    };
  }

  const missing: string[] = [];
  if (!ffmpeg.ok) missing.push('FFmpeg');
  if (!ffprobe.ok) missing.push('FFprobe');

  return {
    available: false,
    ffmpegPath: ffmpeg.ok ? ffmpegPath : null,
    ffprobePath: ffprobe.ok ? ffprobePath : null,
    ffmpegVersion: ffmpeg.version,
    ffprobeVersion: ffprobe.version,
    error: `${missing.join(' and ')} could not be found or executed. Install FFmpeg or set FFMPEG_PATH / FFPROBE_PATH.`,
  };
}
