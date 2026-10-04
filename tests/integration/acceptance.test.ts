/**
 * FINAL ACCEPTANCE TEST (spec section 53).
 *
 * The full real-world workflow, exercised through the REAL export pipeline with
 * REAL ffmpeg against the REAL sample files, then validated with ffprobe:
 *
 *   loop video to audio  (3x, muted original audio, last clip trimmed)
 *     + replacement MP3 audio (once, not looped)
 *     + 9:16 / 16:9 / 1:1 canvas with crop + reposition
 *     + PNG logo overlay (resized, centered)
 *     + text overlay
 *     + transition between the first two base clips
 *   -> export -> ffprobe validation (dimensions, codecs, 1 audio stream,
 *      duration ~ audio length) -> originals unmodified.
 *
 * Runs real encoding at three aspect ratios, so it uses a long timeout.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { existsSync, statSync, rmSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  buildAsset,
  clip,
  defaultAudio,
  newTmpOutput,
  cleanup,
  runExport,
  LOGO,
} from './helpers';
import { createProject, createId, createTrack } from '@shared/utils/factories';
import { planLoopVideoToAudio } from '@shared/utils/loop';
import type { Project, TextLayer } from '@shared/types';

const VIDEO_PATH = 'C:\\Users\\sunny\\Downloads\\WhatsApp Video 2026-10-03 at 10.24.29 PM.mp4';
const AUDIO_PATH = 'C:\\Users\\sunny\\Downloads\\450d7d2e-3808-465d-8fde-fa6a43f675b2.mp3';
const EXPECTED_AUDIO_DURATION = 138.024;

function sha1(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const s = createReadStream(path);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
    s.on('error', reject);
  });
}

const outputs: string[] = [];
afterAll(() => outputs.forEach(cleanup));

/**
 * Build the full acceptance project at a given canvas size + aspect ratio.
 * Mirrors exactly what the store actions / UI would produce.
 */
async function buildAcceptanceProject(
  width: number,
  height: number,
  aspectRatio: Project['canvas']['aspectRatio'],
): Promise<Project> {
  const videoAsset = await buildAsset(VIDEO_PATH, 'video');
  const audioAsset = await buildAsset(AUDIO_PATH, 'audio');
  const logoAsset = await buildAsset(LOGO, 'image');

  const project = createProject('Acceptance');
  project.mediaAssets = [videoAsset, audioAsset, logoAsset];
  project.canvas = { ...project.canvas, width, height, aspectRatio, fitMode: 'fill' };

  const baseVideoTrack = project.tracks.find((t) => t.kind === 'video')!;
  const audioTrack = project.tracks.find((t) => t.kind === 'audio')!;
  const overlayTrack = createTrack('video', 1, 'Overlay');
  project.tracks.push(overlayTrack);

  // --- Loop video to audio (same pure fn the UI action uses) ---
  const plan = planLoopVideoToAudio(videoAsset.metadata.duration, audioAsset.metadata.duration);

  const videoClips = plan.clips.map((p, i) =>
    clip({
      assetId: videoAsset.id,
      trackId: baseVideoTrack.id,
      timelineStart: p.timelineStart,
      timelineDuration: p.timelineDuration,
      sourceStart: p.sourceStart,
      sourceEnd: p.sourceEnd,
      // Mute every repeated clip's ORIGINAL audio (muted + volume 0).
      audio: { muted: true, volume: 0, fadeInSeconds: 0, fadeOutSeconds: 0 },
      // Reposition + crop the first clip a bit to prove transform/crop export.
      crop: i === 0 ? { top: 0.05, bottom: 0.05, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 },
      transform: {
        x: 0.5, y: 0.5, scale: 1, rotation: 0,
        flipHorizontal: false, flipVertical: false, opacity: 1,
      },
    }),
  );

  // Replacement audio: once, full length, NOT looped.
  const audioClip = clip({
    assetId: audioAsset.id,
    trackId: audioTrack.id,
    timelineStart: 0,
    timelineDuration: audioAsset.metadata.duration,
    sourceStart: 0,
    sourceEnd: audioAsset.metadata.duration,
    audio: { ...defaultAudio() },
  });

  // Logo overlay (resized to 25% of canvas, centered) for the first 10s.
  const logoClip = clip({
    assetId: logoAsset.id,
    trackId: overlayTrack.id,
    timelineStart: 0,
    timelineDuration: 10,
    sourceStart: 0,
    sourceEnd: 10,
    transform: {
      x: 0.5, y: 0.3, scale: 0.25, rotation: 0,
      flipHorizontal: false, flipVertical: false, opacity: 0.9,
    },
  });

  project.clips = [...videoClips, audioClip, logoClip];

  // Text overlay.
  const text: TextLayer = {
    id: createId(),
    trackId: baseVideoTrack.id,
    text: 'ACCEPTANCE',
    timelineStart: 0,
    timelineDuration: 8,
    fontFamily: 'sans',
    fontSize: 72,
    fontWeight: 700,
    color: '#ffffff',
    alignment: 'center',
    opacity: 1,
    backgroundColor: null,
    x: 0.5,
    y: 0.8,
    rotation: 0,
  };
  project.textLayers = [text];

  // Transition between the first two base clips (fade).
  if (videoClips.length >= 2) {
    project.transitions = [
      {
        id: createId(),
        kind: 'fade',
        fromClipId: videoClips[0].id,
        toClipId: videoClips[1].id,
        durationSeconds: 1,
      },
    ];
  }

  return project;
}

describe('FINAL ACCEPTANCE — full workflow at multiple aspect ratios', () => {
  let beforeVideo: { hash: string; size: number };
  let beforeAudio: { hash: string; size: number };

  beforeAll(async () => {
    expect(existsSync(VIDEO_PATH), `missing sample video`).toBe(true);
    expect(existsSync(AUDIO_PATH), `missing sample audio`).toBe(true);
    beforeVideo = { hash: await sha1(VIDEO_PATH), size: statSync(VIDEO_PATH).size };
    beforeAudio = { hash: await sha1(AUDIO_PATH), size: statSync(AUDIO_PATH).size };
  });

  async function runAt(
    w: number,
    h: number,
    ar: Project['canvas']['aspectRatio'],
    tag: string,
  ) {
    const project = await buildAcceptanceProject(w, h, ar);
    const outputPath = newTmpOutput(tag);
    outputs.push(outputPath);
    // Transition shortens the program by 1s (one fade), so expect audioLen - 1.
    const r = await runExport(project, { outputPath, resolution: '1080p', quality: 'low' });
    expect(r.success, `[${tag}] export failed: ${r.error}\n${r.details ?? ''}`).toBe(true);
    expect(r.videoCodec, `[${tag}] video codec`).toBe('h264');
    expect(r.audioCodec, `[${tag}] audio codec`).toBe('aac');
    expect(r.audioStreamCount, `[${tag}] exactly one audio stream`).toBe(1);
    expect(r.width, `[${tag}] width`).toBe(w);
    expect(r.height, `[${tag}] height`).toBe(h);
    // Duration ~ audio length minus the 1s transition overlap, within tolerance.
    expect(Math.abs((r.duration ?? 0) - (EXPECTED_AUDIO_DURATION - 1))).toBeLessThanOrEqual(1.5);
    return r;
  }

  it('exports 9:16 (1080x1920)', async () => {
    await runAt(1080, 1920, '9:16', 'accept-portrait');
  }, 300_000);

  it('exports 16:9 (1920x1080)', async () => {
    await runAt(1920, 1080, '16:9', 'accept-landscape');
  }, 300_000);

  it('exports 1:1 (1080x1080)', async () => {
    await runAt(1080, 1080, '1:1', 'accept-square');
  }, 300_000);

  it('left the original files unmodified', async () => {
    expect(statSync(VIDEO_PATH).size).toBe(beforeVideo.size);
    expect(statSync(AUDIO_PATH).size).toBe(beforeAudio.size);
    expect(await sha1(VIDEO_PATH)).toBe(beforeVideo.hash);
    expect(await sha1(AUDIO_PATH)).toBe(beforeAudio.hash);
  }, 60_000);
});
