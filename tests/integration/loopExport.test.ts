/**
 * Real end-to-end integration test for the "Loop Video to Audio" feature.
 *
 * This exercises the REAL code path with REAL ffmpeg/ffprobe against the REAL
 * sample files:
 *   - probe both files with the real probe service,
 *   - run the pure planLoopVideoToAudio,
 *   - build clips exactly as the store action does (3 muted video clips
 *     referencing the SAME asset + 1 full audio clip),
 *   - call the REAL exportProject (which assembles args from the REAL
 *     buildFilterGraph + buildEncoderConfig and runs the REAL ffmpeg),
 *   - ffprobe the output and assert codecs/duration/resolution/stream count,
 *   - assert the two ORIGINAL files are UNMODIFIED, and clean up the output.
 *
 * It needs real encoding, so it runs with a long timeout.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, statSync, rmSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, createId } from '@shared/utils/factories';
import { planLoopVideoToAudio } from '@shared/utils/loop';
import { probeMediaMetadata } from '../../src/main/services/media/probe';
import { exportProject } from '../../src/main/services/renderer/rendererService';
import type { ExportSettings, MediaAsset, Project, TimelineClip } from '@shared/types';

const VIDEO_PATH = 'C:\\Users\\sunny\\Downloads\\WhatsApp Video 2026-10-03 at 10.24.29 PM.mp4';
const AUDIO_PATH = 'C:\\Users\\sunny\\Downloads\\450d7d2e-3808-465d-8fde-fa6a43f675b2.mp3';

const EXPECTED_AUDIO_DURATION = 138.024;

function sha1(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(path);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function buildAsset(path: string, kind: MediaAsset['kind']): Promise<MediaAsset> {
  const metadata = await probeMediaMetadata(path);
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

const outputPath = join(tmpdir(), `loop-export-${Date.now()}.mp4`);

afterAll(() => {
  if (existsSync(outputPath)) rmSync(outputPath, { force: true });
});

describe('Loop Video to Audio — real export', () => {
  it('produces a validated 1920x1080 h264+aac mp4 matching the audio length', async () => {
    expect(existsSync(VIDEO_PATH), `missing sample video: ${VIDEO_PATH}`).toBe(true);
    expect(existsSync(AUDIO_PATH), `missing sample audio: ${AUDIO_PATH}`).toBe(true);

    // Capture originals (hash + size) BEFORE the export.
    const beforeVideo = { hash: await sha1(VIDEO_PATH), size: statSync(VIDEO_PATH).size };
    const beforeAudio = { hash: await sha1(AUDIO_PATH), size: statSync(AUDIO_PATH).size };

    // Build real assets by probing the real files.
    const videoAsset = await buildAsset(VIDEO_PATH, 'video');
    const audioAsset = await buildAsset(AUDIO_PATH, 'audio');

    const videoDuration = videoAsset.metadata.duration;
    const audioDuration = audioAsset.metadata.duration;
    expect(audioDuration).toBeCloseTo(EXPECTED_AUDIO_DURATION, 1);

    // Plan the loop (same pure function the store action uses).
    const plan = planLoopVideoToAudio(videoDuration, audioDuration);
    expect(plan.repetitions).toBe(3);

    // Build the project + clips exactly as the store action does.
    const project: Project = createProject('Loop Export Test');
    project.mediaAssets = [videoAsset, audioAsset];
    const videoTrackId = project.tracks.find((t) => t.kind === 'video')!.id;
    const audioTrackId = project.tracks.find((t) => t.kind === 'audio')!.id;

    const defaultTransform = {
      x: 0.5, y: 0.5, scale: 1, rotation: 0,
      flipHorizontal: false, flipVertical: false, opacity: 1,
    };
    const defaultCrop = { top: 0, bottom: 0, left: 0, right: 0 };

    const clips: TimelineClip[] = plan.clips.map((p) => ({
      id: createId(),
      assetId: videoAsset.id,
      trackId: videoTrackId,
      timelineStart: p.timelineStart,
      timelineDuration: p.timelineDuration,
      sourceStart: p.sourceStart,
      sourceEnd: p.sourceEnd,
      speed: 1,
      transform: { ...defaultTransform },
      crop: { ...defaultCrop },
      audio: { muted: true, volume: 0, fadeInSeconds: 0, fadeOutSeconds: 0 },
    }));
    clips.push({
      id: createId(),
      assetId: audioAsset.id,
      trackId: audioTrackId,
      timelineStart: 0,
      timelineDuration: audioDuration,
      sourceStart: 0,
      sourceEnd: audioDuration,
      speed: 1,
      transform: { ...defaultTransform },
      crop: { ...defaultCrop },
      audio: { muted: false, volume: 1, fadeInSeconds: 0, fadeOutSeconds: 0 },
    });
    project.clips = clips;

    const settings: ExportSettings = {
      resolution: '1080p',
      format: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      fps: 'source',
      quality: 'high',
      outputPath,
    };

    // Run the REAL export (real ffmpeg).
    const result = await exportProject(project, settings, () => {});

    expect(result.success, `export failed: ${result.error}\n${result.details ?? ''}`).toBe(true);
    expect(existsSync(outputPath)).toBe(true);

    // The service's own validation must have passed.
    expect(result.validation?.ok).toBe(true);

    // Independently ffprobe the output and assert the hard requirements.
    const out = await probeMediaMetadata(outputPath);
    const video = out.videoStreams[0];
    const audio = out.audioStreams[0];

    expect(out.videoStreams.length).toBeGreaterThanOrEqual(1);
    expect(out.audioStreams.length).toBe(1);

    expect(video.codec).toBe('h264');
    expect(video.width).toBe(1920);
    expect(video.height).toBe(1080);

    expect(audio.codec).toBe('aac');
    expect(audio.sampleRate).toBe(48000);
    expect(audio.channels).toBe(2);

    expect(out.duration).toBeCloseTo(EXPECTED_AUDIO_DURATION, 0);
    expect(Math.abs(out.duration - EXPECTED_AUDIO_DURATION)).toBeLessThanOrEqual(1.0);

    // Originals must be untouched.
    expect(statSync(VIDEO_PATH).size).toBe(beforeVideo.size);
    expect(statSync(AUDIO_PATH).size).toBe(beforeAudio.size);
    expect(await sha1(VIDEO_PATH)).toBe(beforeVideo.hash);
    expect(await sha1(AUDIO_PATH)).toBe(beforeAudio.hash);
  }, 300_000);
});
