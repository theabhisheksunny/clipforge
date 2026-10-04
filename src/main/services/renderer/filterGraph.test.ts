import { describe, it, expect } from 'vitest';
import { buildFilterGraph } from './filterGraph';
import { createProject, createClipFromAsset, createId } from '@shared/utils/factories';
import type { MediaAsset, Project } from '@shared/types';

function videoAsset(path: string, duration = 30): MediaAsset {
  return {
    id: createId(),
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    kind: 'video',
    extension: 'mp4',
    metadata: {
      duration,
      format: 'mov,mp4,m4a',
      sizeBytes: 1000,
      bitRate: 1000,
      videoStreams: [
        { index: 0, codec: 'h264', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', bitRate: 1000, pixelFormat: 'yuv420p' },
      ],
      audioStreams: [
        { index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: 'stereo', bitRate: 128000 },
      ],
    },
    missing: false,
    importedAt: Date.now(),
  };
}

function buildProjectWith(assets: MediaAsset[]): Project {
  const project = createProject('Test');
  project.mediaAssets = assets;
  return project;
}

function assetMap(project: Project): Map<string, MediaAsset> {
  const m = new Map<string, MediaAsset>();
  for (const a of project.mediaAssets) m.set(a.id, a);
  return m;
}

const OPTS = (project: Project) => ({
  canvasWidth: 1920,
  canvasHeight: 1080,
  fps: 30,
  assetById: assetMap(project),
});

describe('buildFilterGraph', () => {
  it('produces a video output label and no audio for an empty-ish project', () => {
    const project = createProject();
    const graph = buildFilterGraph(project, OPTS(project));
    expect(graph.videoOutLabel).toMatch(/^\[.*\]$/);
    expect(graph.audioOutLabel).toBeNull();
    // Base canvas is always one input.
    expect(graph.inputArgs.filter((a) => a === '-i').length).toBe(1);
  });

  it('registers one ffmpeg input per clip', () => {
    const asset = videoAsset('C:/media/clipA.mp4');
    const project = buildProjectWith([asset]);
    const trackId = project.tracks.find((t) => t.kind === 'video')!.id;
    project.clips = [
      createClipFromAsset({ asset, trackId, timelineStart: 0 }),
      createClipFromAsset({ asset, trackId, timelineStart: 30 }),
    ];
    const graph = buildFilterGraph(project, OPTS(project));
    // 1 base canvas + 2 clips = 3 inputs.
    const inputCount = graph.inputArgs.filter((a) => a === '-i').length;
    expect(inputCount).toBe(3);
  });

  it('gives the SAME source file imported twice two distinct inputs and audio streams', () => {
    // This is the core non-destructive requirement (spec sections 3, 9):
    // placing ram.mp4 twice must yield two independent inputs, not one shared.
    const ram = videoAsset('C:/media/ram.mp4', 20);
    const project = buildProjectWith([ram]);
    const trackId = project.tracks.find((t) => t.kind === 'video')!.id;

    const clipA = createClipFromAsset({ asset: ram, trackId, timelineStart: 0 });
    clipA.sourceStart = 0;
    clipA.sourceEnd = 10;
    clipA.timelineDuration = 10;

    const clipB = createClipFromAsset({ asset: ram, trackId, timelineStart: 10 });
    clipB.sourceStart = 10;
    clipB.sourceEnd = 20;
    clipB.timelineDuration = 10;

    project.clips = [clipA, clipB];
    const graph = buildFilterGraph(project, OPTS(project));

    // The same path appears as two separate -i entries with different -ss/-to.
    const iPaths: string[] = [];
    for (let i = 0; i < graph.inputArgs.length; i++) {
      if (graph.inputArgs[i] === '-i') iPaths.push(graph.inputArgs[i + 1]);
    }
    const ramInputs = iPaths.filter((p) => p === 'C:/media/ram.mp4');
    expect(ramInputs.length).toBe(2);

    // Two distinct per-clip audio streams must be delayed to different offsets.
    expect(graph.filterComplex).toContain(`a_${clipA.id}`);
    expect(graph.filterComplex).toContain(`a_${clipB.id}`);
    expect(graph.filterComplex).toContain('adelay=0|0');
    expect(graph.filterComplex).toContain('adelay=10000|10000');

    // Two audio streams get mixed.
    expect(graph.audioOutLabel).toBe('[aout]');
    expect(graph.filterComplex).toContain('amix=inputs=2');
  });

  it('omits a muted clip from the audio mix', () => {
    const asset = videoAsset('C:/media/clip.mp4', 10);
    const project = buildProjectWith([asset]);
    const trackId = project.tracks.find((t) => t.kind === 'video')!.id;
    const clip = createClipFromAsset({ asset, trackId, timelineStart: 0 });
    clip.audio.muted = true;
    project.clips = [clip];

    const graph = buildFilterGraph(project, OPTS(project));
    // Muted single clip => no audio output.
    expect(graph.audioOutLabel).toBeNull();
    expect(graph.filterComplex).not.toContain(`a_${clip.id}`);
  });

  it('applies -ss/-to trim points to a clip input', () => {
    const asset = videoAsset('C:/media/clip.mp4', 60);
    const project = buildProjectWith([asset]);
    const trackId = project.tracks.find((t) => t.kind === 'video')!.id;
    const clip = createClipFromAsset({ asset, trackId, timelineStart: 0 });
    clip.sourceStart = 15;
    clip.sourceEnd = 70 > 60 ? 60 : 55;
    clip.sourceEnd = 55;
    clip.timelineDuration = 40;
    project.clips = [clip];

    const graph = buildFilterGraph(project, OPTS(project));
    const ssIndex = graph.inputArgs.indexOf('-ss');
    expect(ssIndex).toBeGreaterThanOrEqual(0);
    expect(graph.inputArgs[ssIndex + 1]).toBe('15');
    const toIndex = graph.inputArgs.indexOf('-to');
    expect(graph.inputArgs[toIndex + 1]).toBe('55');
  });

  it('concatenates three sequential base-track clips with concat=n=3', () => {
    // Three placements of the SAME source on the base video track must be
    // composited with concat (not overlay), one input per placement.
    const asset = videoAsset('C:/media/loop.mp4', 60);
    const project = buildProjectWith([asset]);
    const trackId = project.tracks.find((t) => t.kind === 'video')!.id;
    project.clips = [
      createClipFromAsset({ asset, trackId, timelineStart: 0 }),
      createClipFromAsset({ asset, trackId, timelineStart: 60 }),
      createClipFromAsset({ asset, trackId, timelineStart: 120 }),
    ];

    const graph = buildFilterGraph(project, OPTS(project));

    // Three distinct inputs for the same path.
    const iPaths: string[] = [];
    for (let i = 0; i < graph.inputArgs.length; i++) {
      if (graph.inputArgs[i] === '-i') iPaths.push(graph.inputArgs[i + 1]);
    }
    expect(iPaths.filter((p) => p === 'C:/media/loop.mp4').length).toBe(3);

    // Composited via concat, not overlay-enable.
    expect(graph.filterComplex).toContain('concat=n=3:v=1:a=0');
    expect(graph.filterComplex).not.toContain('overlay=');
  });

  it('excludes a muted video clip audio and normalizes present audio to 48kHz stereo', () => {
    // A muted video clip contributes NO audio; its per-clip audio label is
    // absent and (as the only clip) there is no audio output at all.
    const muted = videoAsset('C:/media/muted.mp4', 10);
    const mutedProject = buildProjectWith([muted]);
    const mutedTrack = mutedProject.tracks.find((t) => t.kind === 'video')!.id;
    const mutedClip = createClipFromAsset({ asset: muted, trackId: mutedTrack, timelineStart: 0 });
    mutedClip.audio.muted = true;
    mutedProject.clips = [mutedClip];

    const mutedGraph = buildFilterGraph(mutedProject, OPTS(mutedProject));
    expect(mutedGraph.audioOutLabel).toBeNull();
    expect(mutedGraph.filterComplex).not.toContain(`a_${mutedClip.id}`);

    // When audio IS present it is normalized to 48kHz stereo.
    const audible = videoAsset('C:/media/audible.mp4', 10);
    const audibleProject = buildProjectWith([audible]);
    const audibleTrack = audibleProject.tracks.find((t) => t.kind === 'video')!.id;
    audibleProject.clips = [createClipFromAsset({ asset: audible, trackId: audibleTrack, timelineStart: 0 })];

    const audibleGraph = buildFilterGraph(audibleProject, OPTS(audibleProject));
    expect(audibleGraph.audioOutLabel).toBe('[aout]');
    expect(audibleGraph.filterComplex).toContain('aresample=48000');
    expect(audibleGraph.filterComplex).toContain('aformat=channel_layouts=stereo');
  });
});
