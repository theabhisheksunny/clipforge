/**
 * Thin wrapper around spawning FFmpeg processes with progress parsing and
 * cancellation. Never invoked directly from the renderer — only via services.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { getBinaryPaths } from './ffmpegLocator';

export interface FfmpegRunOptions {
  args: string[];
  /** Total expected output duration (seconds) for progress calculation. */
  totalDurationSeconds?: number;
  onProgress?: (info: { outTimeSeconds: number; progress: number; raw: string }) => void;
  signal?: AbortSignal;
}

export interface FfmpegRunResult {
  code: number | null;
  stderr: string;
  cancelled: boolean;
}

/** Parse `-progress pipe:1` key=value lines for out_time. */
function parseProgress(chunk: string): number | null {
  // out_time_ms is microseconds in modern ffmpeg; out_time_us also appears.
  const msMatch = chunk.match(/out_time_ms=(\d+)/);
  if (msMatch) return Number(msMatch[1]) / 1_000_000;
  const usMatch = chunk.match(/out_time_us=(\d+)/);
  if (usMatch) return Number(usMatch[1]) / 1_000_000;
  const timeMatch = chunk.match(/out_time=(\d+):(\d+):(\d+\.?\d*)/);
  if (timeMatch) {
    return Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
  }
  return null;
}

export function runFfmpeg(opts: FfmpegRunOptions): Promise<FfmpegRunResult> {
  const { ffmpegPath } = getBinaryPaths();
  const args = ['-hide_banner', ...opts.args];

  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    let stderr = '';
    let cancelled = false;

    try {
      child = spawn(ffmpegPath, args, { windowsHide: true });
    } catch (err) {
      resolve({ code: -1, stderr: String(err), cancelled: false });
      return;
    }

    const onAbort = () => {
      cancelled = true;
      child.kill('SIGKILL');
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    // Progress is emitted on stdout when `-progress pipe:1` is in args.
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      const t = parseProgress(text);
      if (t !== null && opts.onProgress) {
        const progress = opts.totalDurationSeconds
          ? Math.min(1, t / opts.totalDurationSeconds)
          : 0;
        opts.onProgress({ outTimeSeconds: t, progress, raw: text });
      }
    });

    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      // Keep stderr bounded for very long renders.
      if (stderr.length > 200_000) stderr = stderr.slice(-150_000);
    });

    child.on('error', (err) => {
      resolve({ code: -1, stderr: stderr + '\n' + String(err), cancelled });
    });

    child.on('close', (code) => {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      resolve({ code, stderr, cancelled });
    });
  });
}
