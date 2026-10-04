/**
 * Evaluation harness — drives editor features through the REAL export pipeline
 * (buildFilterGraph -> exportProject -> real ffmpeg) and validates outputs with
 * ffprobe + pixel sampling. These are the automated equivalent of a QA engineer
 * clicking through the UI, since the live Electron GUI cannot be driven here.
 *
 * Uses the small synthetic fixtures for speed.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'node:path';
import {
  buildAsset,
  clip,
  newTmpOutput,
  cleanup,
  runExport,
  LANDSCAPE,
  LOGO,
  MUSIC,
  SHORT,
  FIXTURES,
} from './helpers';
import { samplePixel, colorDistance } from './pixel';

const SOLID_BLUE = join(FIXTURES, 'solid_blue_720_5s.mp4');
const BLUE = { r: 0, g: 0, b: 255 };
import { createProject } from '@shared/utils/factories';
import type { Project } from '@shared/types';

const outputs: string[] = [];
function out(tag: string): string {
  const p = newTmpOutput(tag);
  outputs.push(p);
  return p;
}
afterAll(() => outputs.forEach(cleanup));

async function baseProject(name: string): Promise<{
  project: Project;
  videoTrackId: string;
  audioTrackId: string;
}> {
  const project = createProject(name);
  const videoTrackId = project.tracks.find((t) => t.kind === 'video')!.id;
  const audioTrackId = project.tracks.find((t) => t.kind === 'audio')!.id;
  return { project, videoTrackId, audioTrackId };
}

describe('Export basics', () => {
  it('exports a single landscape clip to 1080p h264+aac', async () => {
    const { project, videoTrackId } = await baseProject('single');
    const v = await buildAsset(LANDSCAPE, 'video');
    project.mediaAssets = [v];
    project.clips = [
      clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 0, timelineDuration: 5, sourceStart: 0, sourceEnd: 5 }),
    ];
    const r = await runExport(project, { outputPath: out('single'), resolution: '1080p' });
    expect(r.success, r.error).toBe(true);
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
    expect(r.videoCodec).toBe('h264');
    expect(r.audioCodec).toBe('aac');
    expect(r.duration).toBeCloseTo(5, 0);
  }, 120_000);

  it('concatenates two clips to the summed duration', async () => {
    const { project, videoTrackId } = await baseProject('concat');
    const v = await buildAsset(SHORT, 'video');
    project.mediaAssets = [v];
    project.clips = [
      clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 0, timelineDuration: 3, sourceStart: 0, sourceEnd: 3 }),
      clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 3, timelineDuration: 3, sourceStart: 0, sourceEnd: 3 }),
    ];
    const r = await runExport(project, { outputPath: out('concat') });
    expect(r.success, r.error).toBe(true);
    expect(r.duration).toBeCloseTo(6, 0);
  }, 120_000);
});

describe('Audio: mute / replace / volume', () => {
  it('muted base video + external music => exactly one audio stream (the music)', async () => {
    const { project, videoTrackId, audioTrackId } = await baseProject('replace');
    const v = await buildAsset(LANDSCAPE, 'video');
    const a = await buildAsset(MUSIC, 'audio');
    project.mediaAssets = [v, a];
    project.clips = [
      clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 0, timelineDuration: 5, sourceStart: 0, sourceEnd: 5, audio: { muted: true, volume: 0, fadeInSeconds: 0, fadeOutSeconds: 0 } }),
      clip({ assetId: a.id, trackId: audioTrackId, timelineStart: 0, timelineDuration: 8, sourceStart: 0, sourceEnd: 8 }),
    ];
    const r = await runExport(project, { outputPath: out('replace') });
    expect(r.success, r.error).toBe(true);
    expect(r.audioStreamCount).toBe(1);
    expect(r.audioCodec).toBe('aac');
  }, 120_000);
});

describe('Image overlay correctness (preview vs export)', () => {
  it('a small centered logo overlay must NOT cover the whole frame', async () => {
    // Base = SOLID BLUE video (deterministic corners). Overlay = 200x200 logo
    // on a SECOND video track, scale 0.3, centered. A correct render keeps the
    // frame corners BLUE (base shows through) and the center NON-blue (logo).
    // The pre-fix bug made the overlay fill the whole canvas (padded black), so
    // corners would be black, not blue.
    const { project, videoTrackId } = await baseProject('overlay');
    const v = await buildAsset(SOLID_BLUE, 'video');
    const logo = await buildAsset(LOGO, 'image');
    project.mediaAssets = [v, logo];

    const overlayTrack = {
      id: 'ov-track',
      kind: 'video' as const,
      name: 'Overlay',
      order: 1,
      muted: false,
      solo: false,
      locked: false,
      hidden: false,
      volume: 1,
    };
    project.tracks.push(overlayTrack);

    project.clips = [
      clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 0, timelineDuration: 5, sourceStart: 0, sourceEnd: 5 }),
      clip({
        assetId: logo.id,
        trackId: overlayTrack.id,
        timelineStart: 0,
        timelineDuration: 5,
        sourceStart: 0,
        sourceEnd: 5,
        transform: { x: 0.5, y: 0.5, scale: 0.3, rotation: 0, flipHorizontal: false, flipVertical: false, opacity: 1 },
      }),
    ];
    const r = await runExport(project, { outputPath: out('overlay'), resolution: '720p' });
    expect(r.success, r.error).toBe(true);

    // Corner must still be the blue base (overlay does NOT cover it).
    const corner = samplePixel(r.outputPath, 2.5, 0.03, 0.03);
    expect(
      colorDistance(corner, BLUE),
      `corner ${JSON.stringify(corner)} should be near blue (base shows through), overlay must not cover the whole frame`,
    ).toBeLessThan(60);

    // Center must be the logo (NOT blue).
    const center = samplePixel(r.outputPath, 2.5, 0.5, 0.5);
    expect(
      colorDistance(center, BLUE),
      `center ${JSON.stringify(center)} should be the logo (clearly different from blue)`,
    ).toBeGreaterThan(80);
  }, 120_000);
});

describe('Aspect ratio: export dimensions follow the canvas (BUG8 fix)', () => {
  async function exportAt(w: number, h: number, ratio: Project['canvas']['aspectRatio'], tag: string) {
    const { project, videoTrackId } = await baseProject(tag);
    const v = await buildAsset(LANDSCAPE, 'video');
    project.mediaAssets = [v];
    project.canvas = { ...project.canvas, width: w, height: h, aspectRatio: ratio };
    project.clips = [
      clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 0, timelineDuration: 5, sourceStart: 0, sourceEnd: 5 }),
    ];
    return runExport(project, { outputPath: out(tag), resolution: '1080p' });
  }

  it('9:16 canvas exports a portrait 1080x1920 file at the 1080p tier', async () => {
    const r = await exportAt(1080, 1920, '9:16', 'ar-portrait');
    expect(r.success, r.error).toBe(true);
    expect(r.width).toBe(1080);
    expect(r.height).toBe(1920);
  }, 120_000);

  it('1:1 canvas exports a square 1080x1080 file', async () => {
    const r = await exportAt(1080, 1080, '1:1', 'ar-square');
    expect(r.success, r.error).toBe(true);
    expect(r.width).toBe(1080);
    expect(r.height).toBe(1080);
  }, 120_000);

  it('16:9 canvas exports 1920x1080', async () => {
    const r = await exportAt(1920, 1080, '16:9', 'ar-landscape');
    expect(r.success, r.error).toBe(true);
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
  }, 120_000);
});

describe('Fit mode (letterbox vs fill)', () => {
  it('fit mode letterboxes a landscape source into a portrait canvas (black bars top/bottom)', async () => {
    // Landscape (16:9) into a 9:16 canvas with fit => wide short strip centered,
    // top and bottom are black bars.
    const { project, videoTrackId } = await baseProject('fit-mode');
    const v = await buildAsset(SOLID_BLUE, 'video');
    project.mediaAssets = [v];
    project.canvas = { ...project.canvas, width: 1080, height: 1920, aspectRatio: '9:16', fitMode: 'fit' };
    project.clips = [
      clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 0, timelineDuration: 5, sourceStart: 0, sourceEnd: 5 }),
    ];
    const r = await runExport(project, { outputPath: out('fit-mode'), resolution: '720p' });
    expect(r.success, r.error).toBe(true);
    // Top (10%) must be a black letterbox bar; vertical center must be the blue source.
    const top = samplePixel(r.outputPath, 2.5, 0.5, 0.08);
    const mid = samplePixel(r.outputPath, 2.5, 0.5, 0.5);
    expect(top.r + top.g + top.b, `top bar ${JSON.stringify(top)} should be black`).toBeLessThan(40);
    expect(colorDistance(mid, BLUE), `center ${JSON.stringify(mid)} should be blue source`).toBeLessThan(60);
  }, 120_000);

  it('fill mode covers the whole portrait canvas (no black bars)', async () => {
    const { project, videoTrackId } = await baseProject('fill-mode');
    const v = await buildAsset(SOLID_BLUE, 'video');
    project.mediaAssets = [v];
    project.canvas = { ...project.canvas, width: 1080, height: 1920, aspectRatio: '9:16', fitMode: 'fill' };
    project.clips = [
      clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 0, timelineDuration: 5, sourceStart: 0, sourceEnd: 5 }),
    ];
    const r = await runExport(project, { outputPath: out('fill-mode'), resolution: '720p' });
    expect(r.success, r.error).toBe(true);
    // With fill, the whole frame (incl. top) is the blue source — no bars.
    const top = samplePixel(r.outputPath, 2.5, 0.5, 0.08);
    expect(colorDistance(top, BLUE), `top ${JSON.stringify(top)} should be blue (filled, no bar)`).toBeLessThan(60);
  }, 120_000);
});

describe('Transitions render (BUG5 fix)', () => {
  it('a fade transition between two clips produces a valid, correctly-shortened output', async () => {
    const { project, videoTrackId } = await baseProject('transition');
    const v = await buildAsset(SHORT, 'video');
    project.mediaAssets = [v];
    const c1 = clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 0, timelineDuration: 3, sourceStart: 0, sourceEnd: 3 });
    const c2 = clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 3, timelineDuration: 3, sourceStart: 0, sourceEnd: 3 });
    project.clips = [c1, c2];
    project.transitions = [
      { id: 'tr1', kind: 'fade', fromClipId: c1.id, toClipId: c2.id, durationSeconds: 1 },
    ];
    const r = await runExport(project, { outputPath: out('transition') });
    expect(r.success, r.error).toBe(true);
    // xfade overlaps by 1s, so total ~= 3 + 3 - 1 = 5s.
    expect(r.duration).toBeCloseTo(5, 0);
  }, 120_000);
});

describe('Speed changes affect duration', () => {
  it('2x speed halves a clip timeline duration in the output', async () => {
    const { project, videoTrackId } = await baseProject('speed');
    const v = await buildAsset(SHORT, 'video');
    project.mediaAssets = [v];
    // 3s source at 2x => 1.5s timeline.
    project.clips = [
      clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 0, timelineDuration: 1.5, sourceStart: 0, sourceEnd: 3, speed: 2 }),
    ];
    const r = await runExport(project, { outputPath: out('speed') });
    expect(r.success, r.error).toBe(true);
    expect(r.duration).toBeCloseTo(1.5, 1);
  }, 120_000);
});

describe('Text overlay renders', () => {
  it('a text layer draws non-background pixels onto the frame', async () => {
    const { project, videoTrackId } = await baseProject('text');
    const v = await buildAsset(SOLID_BLUE, 'video');
    project.mediaAssets = [v];
    project.clips = [
      clip({ assetId: v.id, trackId: videoTrackId, timelineStart: 0, timelineDuration: 5, sourceStart: 0, sourceEnd: 5 }),
    ];
    project.textLayers = [
      {
        id: 'txt1',
        trackId: videoTrackId,
        text: 'HELLO WORLD TEST',
        timelineStart: 0,
        timelineDuration: 5,
        fontFamily: 'sans',
        fontSize: 120,
        fontWeight: 700,
        color: '#ffffff',
        alignment: 'center',
        opacity: 1,
        backgroundColor: null,
        x: 0.5,
        y: 0.5,
        rotation: 0,
      },
    ];
    const r = await runExport(project, { outputPath: out('text'), resolution: '720p' });
    expect(r.success, r.error).toBe(true);
    // Scan a horizontal line through the vertical center for any white-ish text
    // pixel (base is pure blue; white text must introduce high R+G).
    let foundText = false;
    for (let i = 0; i <= 20 && !foundText; i++) {
      const px = samplePixel(r.outputPath, 2.5, i / 20, 0.5);
      if (px.r > 180 && px.g > 180) foundText = true;
    }
    expect(foundText, 'expected white text pixels on the blue frame').toBe(true);
  }, 120_000);
});
