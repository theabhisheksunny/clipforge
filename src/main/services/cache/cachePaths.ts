/**
 * Application temp/cache directory management (spec section 31).
 *
 *   <userData>/
 *     cache/
 *     thumbnails/
 *     waveforms/
 *     proxies/
 *     renders/
 *     temp/
 *
 * Original user media is never written to or deleted here.
 */

import { app } from 'electron';
import { mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type CacheBucket =
  | 'cache'
  | 'thumbnails'
  | 'waveforms'
  | 'proxies'
  | 'renders'
  | 'temp';

const BUCKETS: CacheBucket[] = [
  'cache',
  'thumbnails',
  'waveforms',
  'proxies',
  'renders',
  'temp',
];

function rootDir(): string {
  return join(app.getPath('userData'), 'VideoEditor');
}

export function ensureCacheDirs(): void {
  const root = rootDir();
  for (const bucket of BUCKETS) {
    const dir = join(root, bucket);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function bucketDir(bucket: CacheBucket): string {
  const dir = join(rootDir(), bucket);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function cacheFilePath(bucket: CacheBucket, fileName: string): string {
  return join(bucketDir(bucket), fileName);
}

/**
 * Remove files older than maxAgeMs from the transient buckets. Never touches
 * original media (which lives outside these dirs by construction).
 */
export function cleanStaleCache(maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
  const now = Date.now();
  for (const bucket of ['thumbnails', 'waveforms', 'temp', 'proxies'] as CacheBucket[]) {
    const dir = join(rootDir(), bucket);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      try {
        const st = statSync(full);
        if (now - st.mtimeMs > maxAgeMs) rmSync(full, { force: true, recursive: true });
      } catch {
        /* ignore individual failures */
      }
    }
  }
}

export function autosavePath(): string {
  return cacheFilePath('temp', 'autosave.vedit');
}
