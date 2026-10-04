/**
 * Shared helpers for the evaluation harness. These build real Projects from the
 * synthetic fixtures, run the REAL exportProject (real ffmpeg), and probe the
 * output. Used to drive every feature through its real code path.
 */

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, rmSync } from 'node:fs';
import { createProject, createId } from '@shared/utils/factories';
import { probeMediaMetadata } from '../../src/main/services/media/probe';
import { exportProject } from '../../src/main/services/renderer/rendererService';
import type {
  ExportSettings,
  MediaAsset,
  MediaMetadata,
  Project,
  TimelineClip,
  Transform,
  Crop,
  AudioProperties,
} from '@shared/types';

export const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'media');
export const LANDSCAPE = join(FIXTURES, 'landscape_720_5s.mp4');
export const PORTRAIT = join(FIXTURES, 'portrait_720_4s.mp4');
export const SHORT = join(FIXTURES, 'short_480_3s.mp4');
export const LOGO = join(FIXTURES, 'logo.png');
export const MUSIC = join(FIXTURES, 'music_8s.wav');

export function defaultTransform(): Transform {
  return {
    x: 0.5, y: 0.5, scale: 1, rotation: 0,
    flipHorizontal: false, flipVertical: false, opacity: 1,
  };
}
export function defaultCrop(): Crop {
  return { top: 0, bottom: 0, left: 0, right: 0 };
}
export function defaultAudio(): AudioProperties {
  return { volume: 1, muted: false, fadeInSeconds: 0, fadeOutSeconds: 0 };
}

export async function buildAsset(path: string, kind: MediaAsset['kind']): Promise<MediaAsset> {
  const metadata: MediaMetadata = await probeMediaMetadata(path);
  return {
    id: createId(),
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    kind,
    extension: path.split('.').pop()?.toLowerCase() ?? '',
    metadata,
    missing: false,
    importedAt: Date.now(),
  };
}

export function clip(partial: Partial<TimelineClip> & Pick<TimelineClip, 'assetId' | 'trackId' | 'timelineStart' | 'timelineDuration' | 'sourceStart' | 'sourceEnd'>): TimelineClip {
  return {
    id: createId(),
    speed: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    audio: defaultAudio(),
    ...partial,
  };
}

export function newTmpOutput(tag: string): string {
  return join(tmpdir(), `ve-eval-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.mp4`);
}

export function cleanup(path: string): void {
  if (existsSync(path)) {
    try {
      rmSync(path, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export interface RunResult {
  outputPath: string;
  success: boolean;
  error?: string;
  details?: string;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioStreamCount: number;
  duration: number | null;
  fps: number | null;
}

export const DEFAULT_SETTINGS: Omit<ExportSettings, 'outputPath'> = {
  resolution: '1080p',
  format: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  fps: 'source',
  quality: 'medium',
};

/** Export a project with the REAL pipeline and probe the result. */
export async function runExport(
  project: Project,
  settings: Partial<ExportSettings> & { outputPath: string },
): Promise<RunResult> {
  const full: ExportSettings = { ...DEFAULT_SETTINGS, ...settings };
  const result = await exportProject(project, full, () => {});
  const out: RunResult = {
    outputPath: full.outputPath,
    success: result.success,
    error: result.error,
    details: result.details,
    width: null,
    height: null,
    videoCodec: null,
    audioCodec: null,
    audioStreamCount: 0,
    duration: null,
    fps: null,
  };
  if (existsSync(full.outputPath)) {
    const meta = await probeMediaMetadata(full.outputPath);
    const v = meta.videoStreams[0];
    const a = meta.audioStreams[0];
    out.width = v?.width ?? null;
    out.height = v?.height ?? null;
    out.videoCodec = v?.codec ?? null;
    out.audioCodec = a?.codec ?? null;
    out.audioStreamCount = meta.audioStreams.length;
    out.duration = meta.duration > 0 ? meta.duration : null;
    out.fps = v?.fps ?? null;
  }
  return out;
}

/** Probe a specific pixel's RGB from a frame of a video at time t (via ffmpeg). */
export { probeMediaMetadata };
