/**
 * Builds an FFmpeg filter_complex graph from the project timeline
 * (spec sections 26, 27).
 *
 * Strategy (non-destructive — the source files are only read):
 *   - Each clip becomes a DISTINCT ffmpeg input, trimmed via -ss/-to, so the
 *     same source file placed N times resolves to N independent inputs
 *     (spec sections 3, 9).
 *   - The lowest-order ("base") video track is a sequential, gapless program:
 *     its clips are each scaled+padded to the canvas, SAR normalized and fps
 *     normalized, then joined with the `concat` filter (NOT overlay+enable).
 *     This matches the proven export command and gives a clean sequence.
 *   - Higher-order video tracks (PiP) and image layers overlay ON TOP of the
 *     concatenated base using overlay with enable='between(t,start,end)'.
 *   - Text layers are drawn with drawtext, timed with enable=between().
 *   - Audio: a video clip's original audio is included only when it is NOT
 *     muted AND the asset actually has an audio stream. Dedicated audio-track
 *     clips are delayed to their timeline start. Streams are mixed with amix
 *     (or passed through when there is a single stream) and the final audio is
 *     normalized to 48kHz stereo before the output label.
 */

import type {
  Project,
  TimelineClip,
  MediaAsset,
  TextLayer,
  Track,
} from '@shared/types';
import { clipEnd, projectDuration } from '@shared/utils/timeline';

export interface FilterGraph {
  /** Ordered input args: ['-ss','0','-to','5','-i','file', ...]. */
  inputArgs: string[];
  /** The full -filter_complex string. */
  filterComplex: string;
  /** Label of the final video stream, e.g. "[vout]". */
  videoOutLabel: string;
  /** Label of the final audio stream, or null if silent. */
  audioOutLabel: string | null;
  /** Total output duration in seconds. */
  durationSeconds: number;
}

interface BuildOptions {
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  /** Resolve an assetId to its MediaAsset. */
  assetById: Map<string, MediaAsset>;
}

function esc(text: string): string {
  // Escape for drawtext: backslash, colon, single quote, percent.
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/** End time of any timed layer (clip or text). */
function layerEnd(item: { timelineStart: number; timelineDuration: number }): number {
  return item.timelineStart + item.timelineDuration;
}

/**
 * Build the per-clip video processing chain applied before composition:
 * speed, crop, flips, rotation, scale+pad to canvas, SAR, opacity, fps.
 */
function videoProcessingSteps(
  clip: TimelineClip,
  isImage: boolean,
  W: number,
  H: number,
  fps: number,
): string[] {
  const steps: string[] = [];

  // Speed via setpts (video only; audio handled separately).
  if (!isImage && clip.speed !== 1) {
    steps.push(`setpts=${(1 / clip.speed).toFixed(6)}*PTS`);
  }
  // Crop (fractional insets of the source frame).
  const { top, bottom, left, right } = clip.crop;
  if (top || bottom || left || right) {
    steps.push(
      `crop=w=iw*(1-${left}-${right}):h=ih*(1-${top}-${bottom}):x=iw*${left}:y=ih*${top}`,
    );
  }
  // Flips.
  if (clip.transform.flipHorizontal) steps.push('hflip');
  if (clip.transform.flipVertical) steps.push('vflip');
  // Rotation.
  if (clip.transform.rotation) {
    steps.push(`rotate=${(clip.transform.rotation * Math.PI) / 180}:c=none`);
  }
  // Scale to fit the canvas preserving aspect, then pad to the exact canvas
  // size and normalize SAR so concat/overlay inputs are uniform.
  steps.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
  steps.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`);
  steps.push('setsar=1');
  // Opacity via format+colorchannelmixer alpha.
  if (clip.transform.opacity < 1) {
    steps.push('format=rgba');
    steps.push(`colorchannelmixer=aa=${clip.transform.opacity}`);
  }
  // Normalize fps.
  steps.push(`fps=${fps}`);

  return steps;
}

export function buildFilterGraph(project: Project, opts: BuildOptions): FilterGraph {
  const { canvasWidth: W, canvasHeight: H, fps, assetById } = opts;

  const videoTracks = sortByOrder(project.tracks.filter((t) => t.kind === 'video'));
  const audioTracks = project.tracks.filter((t) => t.kind === 'audio');
  const baseTrackId = videoTracks.length ? videoTracks[0].id : null;

  const duration = Math.max(
    0.1,
    projectDuration(project.clips, project.textLayers.map(layerEnd)),
  );

  const inputArgs: string[] = [];
  const filters: string[] = [];
  let inputIndex = 0;

  // --- Base canvas (color source) ---
  // Used as the composition surface for overlays/text, and as the base video
  // when the base track has no clips.
  inputArgs.push(
    '-f', 'lavfi',
    '-i', `color=c=${project.canvas.backgroundColor.replace('#', '0x')}:s=${W}x${H}:r=${fps}:d=${duration}`,
  );
  const baseInput = inputIndex;
  inputIndex++;

  // Collect clips grouped per video track in draw order (lower tracks first).
  // Separate the base track (concatenated) from overlay tracks (composited).
  const baseClips: TimelineClip[] = [];
  const overlayClips: TimelineClip[] = [];
  for (const track of videoTracks) {
    const clips = project.clips
      .filter((c) => c.trackId === track.id)
      .filter((c) => {
        const a = assetById.get(c.assetId);
        return a && (a.kind === 'video' || a.kind === 'image');
      })
      .sort((a, b) => a.timelineStart - b.timelineStart);
    if (track.id === baseTrackId) baseClips.push(...clips);
    else overlayClips.push(...clips);
  }

  // Register a video input per clip and build its processed stream.
  // Track the ffmpeg input index per clip id so the same source file imported
  // multiple times resolves to distinct inputs (spec sections 3, 9).
  const inputIndexByClipId = new Map<string, number>();

  function registerVideoClip(clip: TimelineClip): string {
    const asset = assetById.get(clip.assetId)!;
    const isImage = asset.kind === 'image';

    if (isImage) {
      inputArgs.push('-loop', '1', '-t', String(clip.timelineDuration), '-i', asset.path);
    } else {
      inputArgs.push(
        '-ss', String(clip.sourceStart),
        '-to', String(clip.sourceEnd),
        '-i', asset.path,
      );
    }
    const idx = inputIndex++;
    inputIndexByClipId.set(clip.id, idx);
    const vlabel = `v${idx}`;

    const steps = videoProcessingSteps(clip, isImage, W, H, fps);
    filters.push(`[${idx}:v]${steps.join(',')}[${vlabel}]`);
    return vlabel;
  }

  // --- Base video track: concat the sequential clips ---
  const baseLabels: string[] = [];
  for (const clip of baseClips) {
    baseLabels.push(registerVideoClip(clip));
  }

  let currentBase: string;
  if (baseLabels.length >= 1) {
    const inputs = baseLabels.map((l) => `[${l}]`).join('');
    filters.push(`${inputs}concat=n=${baseLabels.length}:v=1:a=0[vbase]`);
    currentBase = 'vbase';
  } else {
    // No base-track clips: the lavfi canvas is the base.
    currentBase = `${baseInput}:v`;
  }

  // --- Overlay higher-track video clips (PiP) and image layers on top ---
  let overlayStep = 0;
  for (const clip of overlayClips) {
    const label = registerVideoClip(clip);
    const outLabel = `ov${overlayStep}`;
    const x = `(W-w)*${clip.transform.x}`;
    const y = `(H-h)*${clip.transform.y}`;
    const start = clip.timelineStart;
    const end = clipEnd(clip);
    filters.push(
      `[${currentBase}][${label}]overlay=x=${x}:y=${y}:enable='between(t,${start},${end})'[${outLabel}]`,
    );
    currentBase = outLabel;
    overlayStep++;
  }

  // --- Text layers via drawtext ---
  for (const text of project.textLayers) {
    const outLabel = `ov${overlayStep}`;
    const t = text as TextLayer;
    const parts = [
      `text='${esc(t.text)}'`,
      `fontsize=${t.fontSize}`,
      `fontcolor=${t.color}@${t.opacity}`,
      `x=(w-text_w)*${t.x}`,
      `y=(h-text_h)*${t.y}`,
      `enable='between(t,${t.timelineStart},${layerEnd(t)})'`,
    ];
    if (t.backgroundColor) {
      parts.push('box=1', `boxcolor=${t.backgroundColor}@${t.opacity}`, 'boxborderw=10');
    }
    filters.push(`[${currentBase}]drawtext=${parts.join(':')}[${outLabel}]`);
    currentBase = outLabel;
    overlayStep++;
  }

  const videoOutLabel = `[${currentBase}]`;

  // --- Audio ---
  const audioMixLabels: string[] = [];

  // Audio from video clips (unless muted / no audio stream).
  // Covers both base and overlay (PiP) video tracks.
  for (const clip of [...baseClips, ...overlayClips]) {
    const asset = assetById.get(clip.assetId)!;
    if (asset.kind !== 'video') continue;
    if (clip.audio.muted || asset.metadata.audioStreams.length === 0) continue;
    const inputPos = inputIndexByClipId.get(clip.id);
    if (inputPos == null) continue;
    const alabel = `a_${clip.id}`;
    const steps = buildAudioSteps(clip);
    const delayMs = Math.round(clip.timelineStart * 1000);
    filters.push(
      `[${inputPos}:a]${steps.length ? steps.join(',') + ',' : ''}adelay=${delayMs}|${delayMs}[${alabel}]`,
    );
    audioMixLabels.push(alabel);
  }

  // Dedicated audio-track assets (music, voice over). Placed once (no looping);
  // delayed to the clip's timeline start.
  for (const track of audioTracks) {
    if (track.muted) continue;
    const clips = project.clips
      .filter((c) => c.trackId === track.id)
      .filter((c) => assetById.get(c.assetId)?.kind === 'audio');
    for (const clip of clips) {
      const asset = assetById.get(clip.assetId)!;
      inputArgs.push('-ss', String(clip.sourceStart), '-to', String(clip.sourceEnd), '-i', asset.path);
      const idx = inputIndex++;
      if (clip.audio.muted) continue;
      const alabel = `a_${clip.id}`;
      const steps = buildAudioSteps(clip, track);
      const delayMs = Math.round(clip.timelineStart * 1000);
      filters.push(
        `[${idx}:a]${steps.length ? steps.join(',') + ',' : ''}adelay=${delayMs}|${delayMs}[${alabel}]`,
      );
      audioMixLabels.push(alabel);
    }
  }

  // Normalize the final audio to 48kHz stereo (matches the proven command and
  // keeps the output a consistent AAC-friendly layout regardless of sources).
  const normalize = 'aresample=48000,aformat=channel_layouts=stereo';
  let audioOutLabel: string | null = null;
  if (audioMixLabels.length === 1) {
    filters.push(
      `[${audioMixLabels[0]}]apad=whole_dur=${duration},${normalize}[aout]`,
    );
    audioOutLabel = '[aout]';
  } else if (audioMixLabels.length > 1) {
    const inputs = audioMixLabels.map((l) => `[${l}]`).join('');
    filters.push(
      `${inputs}amix=inputs=${audioMixLabels.length}:duration=longest:dropout_transition=0,apad=whole_dur=${duration},${normalize}[aout]`,
    );
    audioOutLabel = '[aout]';
  }

  return {
    inputArgs,
    filterComplex: filters.join(';'),
    videoOutLabel,
    audioOutLabel,
    durationSeconds: duration,
  };
}

/** Audio processing steps: speed (atempo), volume, fades, track volume. */
function buildAudioSteps(clip: TimelineClip, audioTrack?: Track): string[] {
  const steps: string[] = [];
  if (clip.speed !== 1) {
    // atempo supports 0.5..2.0 per instance; chain for larger factors.
    let remaining = clip.speed;
    const factors: number[] = [];
    while (remaining > 2) {
      factors.push(2);
      remaining /= 2;
    }
    while (remaining < 0.5) {
      factors.push(0.5);
      remaining /= 0.5;
    }
    factors.push(Math.round(remaining * 1000) / 1000);
    for (const f of factors) steps.push(`atempo=${f}`);
  }
  const trackVol = audioTrack ? audioTrack.volume : 1;
  const vol = clip.audio.volume * trackVol;
  if (vol !== 1) steps.push(`volume=${vol}`);
  if (clip.audio.fadeInSeconds > 0) {
    steps.push(`afade=t=in:st=0:d=${clip.audio.fadeInSeconds}`);
  }
  if (clip.audio.fadeOutSeconds > 0) {
    const outStart = Math.max(0, clip.timelineDuration - clip.audio.fadeOutSeconds);
    steps.push(`afade=t=out:st=${outStart}:d=${clip.audio.fadeOutSeconds}`);
  }
  return steps;
}
