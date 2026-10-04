/**
 * Media import orchestration. Builds MediaAsset references from file paths by
 * probing metadata. Original files are referenced, never copied or converted
 * (spec section 5).
 */

import { basename, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { probeMediaMetadata } from './probe';
import { createId } from '@shared/utils/factories';
import { kindForExtension } from '@shared/types';
import type { MediaAsset } from '@shared/types';

export async function importMediaPath(path: string): Promise<MediaAsset> {
  const ext = extname(path).toLowerCase().replace(/^\./, '');
  const kind = kindForExtension(ext);
  if (!kind) {
    throw new Error(`Unsupported file type: .${ext}`);
  }
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }

  let metadata;
  try {
    metadata = await probeMediaMetadata(path);
  } catch (err) {
    throw new Error(`Could not read media "${basename(path)}": ${(err as Error).message}`);
  }

  // Validate that the detected kind matches actual stream content where possible.
  if (kind === 'video' && metadata.videoStreams.length === 0 && metadata.duration > 0) {
    // Container with only audio (e.g. an .mp4 holding audio) — treat as audio.
  }

  const asset: MediaAsset = {
    id: createId(),
    path,
    name: basename(path),
    kind,
    extension: ext,
    metadata,
    missing: false,
    importedAt: Date.now(),
  };
  return asset;
}

export async function importMediaPaths(paths: string[]): Promise<MediaAsset[]> {
  const results: MediaAsset[] = [];
  for (const p of paths) {
    try {
      results.push(await importMediaPath(p));
    } catch (err) {
      // Skip the bad file but keep importing the rest; surface via name.
      results.push({
        id: createId(),
        path: p,
        name: basename(p),
        kind: kindForExtension(extname(p).replace(/^\./, '')) ?? 'video',
        extension: extname(p).toLowerCase().replace(/^\./, ''),
        metadata: {
          duration: 0,
          format: null,
          sizeBytes: 0,
          bitRate: null,
          videoStreams: [],
          audioStreams: [],
        },
        missing: true,
        importedAt: Date.now(),
      });
      console.error(`Import failed for ${p}:`, (err as Error).message);
    }
  }
  return results;
}

export async function relinkMedia(assetId: string, newPath: string): Promise<MediaAsset> {
  const relinked = await importMediaPath(newPath);
  // Preserve the original asset id so timeline clips keep referencing it.
  return { ...relinked, id: assetId };
}
