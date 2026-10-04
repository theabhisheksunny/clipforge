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
  FitMode,
} from '@shared/types';
import { existsSync } from 'node:fs';
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
  /** How base-track sources map onto the canvas (fit/fill/stretch). */
  fitMode: FitMode;
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

/**
 * Resolve a usable TrueType font for drawtext. ffmpeg-static has no bundled
 * fontconfig, so drawtext must be given an explicit fontfile or it fails with
 * "Fontconfig error: Cannot load default config file". Pick the first system
 * font that exists for the current platform.
 */
let cachedFontFile: string | null | undefined;
function resolveFontFile(): string | null {
  if (cachedFontFile !== undefined) return cachedFontFile;
  const candidates =
    process.platform === 'win32'
      ? ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\segoeui.ttf', 'C:\\Windows\\Fonts\\tahoma.ttf']
      : process.platform === 'darwin'
        ? ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']
        : [
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            '/usr/share/fonts/TTF/DejaVuSans.ttf',
          ];
  cachedFontFile = candidates.find((p) => existsSync(p)) ?? null;
  return cachedFontFile;
}

/** Escape a filesystem path for use inside a drawtext fontfile= option. */
function escFontPath(p: string): string {
  // drawtext parses ':' and '\' specially; forward slashes + escaped colon
  // work on Windows (C\:/Windows/Fonts/arial.ttf).
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/** End time of any timed layer (clip or text). */
function layerEnd(item: { timelineStart: number; timelineDuration: number }): number {
  return item.timelineStart + item.timelineDuration;
}

/** Common pre-composition steps shared by base and overlay clips: speed, crop,
 * flips, rotation. (Scaling/padding differs between base and overlay.) */
function commonTransformSteps(clip: TimelineClip, isImage: boolean): string[] {
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
  // Rotation (expand canvas, transparent corners).
  if (clip.transform.rotation) {
    steps.push(`rotate=${(clip.transform.rotation * Math.PI) / 180}:c=none`);
  }
  return steps;
}

/**
 * BASE-track clip chain: map the source onto the FULL canvas honoring the
 * project fitMode and the clip's own scale, then pad/crop to exact canvas size
 * so every base segment is identical in size for concat.
 *
 *  - fit:     scale so the whole frame fits (decrease), then pad with bars.
 *  - fill:    scale so the frame covers the canvas (increase), then crop.
 *  - stretch: scale to exactly WxH (distorts).
 *
 * The clip's transform.scale multiplies the mapped size (zoom in/out), and
 * transform.x/y recenters within the canvas (only visible when not full-bleed).
 */
function baseVideoSteps(
  clip: TimelineClip,
  isImage: boolean,
  W: number,
  H: number,
  fps: number,
  fitMode: FitMode,
): string[] {
  const steps = commonTransformSteps(clip, isImage);
  const scale = clip.transform.scale || 1;

  if (fitMode === 'stretch') {
    // Distort to exactly the canvas (ignores aspect; scale multiplies).
    steps.push(`scale=${Math.max(2, Math.round(W * scale))}:${Math.max(2, Math.round(H * scale))}`);
    steps.push('setsar=1');
    // If scaled past the canvas, center-crop back to exact size.
    steps.push(`crop=${W}:${H}`);
  } else if (fitMode === 'fill') {
    // Cover the canvas (increase), then center-crop the overflow to WxH.
    const sw = Math.max(2, Math.round(W * scale));
    const sh = Math.max(2, Math.round(H * scale));
    steps.push(`scale=${sw}:${sh}:force_original_aspect_ratio=increase`);
    steps.push('setsar=1');
    steps.push(`crop=${W}:${H}`);
  } else {
    // fit: whole frame visible; letterbox/pillarbox with centered bars.
    const sw = Math.max(2, Math.round(W * scale));
    const sh = Math.max(2, Math.round(H * scale));
    steps.push(`scale=${sw}:${sh}:force_original_aspect_ratio=decrease`);
    steps.push('setsar=1');
    steps.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`);
    // Guard against a 1px rounding overshoot from an upscaled (scale>1) frame.
    steps.push(`crop=${W}:${H}`);
  }
  // Flatten onto an opaque canvas for a consistent base.
  steps.push('format=yuv420p');
  steps.push(`fps=${fps}`);
  return steps;
}

/**
 * OVERLAY clip chain (image layer or higher-track PiP video): scale the source
 * to a fraction of the canvas governed by transform.scale, preserving aspect,
 * WITHOUT padding to the full canvas, and carry an alpha channel so opacity and
 * rounded/transparent regions composite correctly. The overlay is then placed
 * by the caller using the overlay filter with x/y as the CENTER.
 */
function overlayVideoSteps(
  clip: TimelineClip,
  isImage: boolean,
  W: number,
  H: number,
  fps: number,
): string[] {
  const steps = commonTransformSteps(clip, isImage);
  // Default overlay occupies up to the full canvas at scale=1; a logo at
  // scale 0.3 is ~30% of the canvas's bounding box. Preserve aspect ratio.
  const scale = clip.transform.scale || 1;
  const bw = Math.max(1, Math.round(W * scale));
  const bh = Math.max(1, Math.round(H * scale));
  steps.push(`scale=${bw}:${bh}:force_original_aspect_ratio=decrease`);
  steps.push('setsar=1');
  // Ensure an alpha channel, then apply opacity to the alpha only (no black
  // box — transparent regions stay transparent).
  steps.push('format=rgba');
  if (clip.transform.opacity < 1) {
    steps.push(`colorchannelmixer=aa=${clamp01(clip.transform.opacity)}`);
  }
  steps.push(`fps=${fps}`);
  return steps;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function buildFilterGraph(project: Project, opts: BuildOptions): FilterGraph {
  const { canvasWidth: W, canvasHeight: H, fps, fitMode, assetById } = opts;

  const videoTracks = sortByOrder(project.tracks.filter((t) => t.kind === 'video'));
  const audioTracks = project.tracks.filter((t) => t.kind === 'audio');
  const baseTrackId = videoTracks.length ? videoTracks[0].id : null;

  // Total timeline duration, reduced by the overlap of any base-track xfade
  // transitions (each xfade shortens the program by its duration).
  const baseClipIds = new Set(
    project.clips.filter((c) => c.trackId === baseTrackId).map((c) => c.id),
  );
  let transitionOverlap = 0;
  for (const tr of project.transitions) {
    if (baseClipIds.has(tr.fromClipId)) transitionOverlap += Math.max(0.1, tr.durationSeconds);
  }
  const duration = Math.max(
    0.1,
    projectDuration(project.clips, project.textLayers.map(layerEnd)) - transitionOverlap,
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

  function registerVideoClip(clip: TimelineClip, role: 'base' | 'overlay'): string {
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

    const steps =
      role === 'base'
        ? baseVideoSteps(clip, isImage, W, H, fps, fitMode)
        : overlayVideoSteps(clip, isImage, W, H, fps);
    filters.push(`[${idx}:v]${steps.join(',')}[${vlabel}]`);
    return vlabel;
  }

  // --- Base video track: join the sequential clips ---
  // A transition between two adjacent base clips (same track) is applied with
  // xfade, which overlaps them by the transition duration; otherwise clips are
  // joined with a hard-cut concat.
  const baseLabels: string[] = [];
  for (const clip of baseClips) {
    baseLabels.push(registerVideoClip(clip, 'base'));
  }

  // Map base clip id -> outgoing transition (from this clip to the next).
  const transitionFrom = new Map<string, { kind: string; duration: number }>();
  for (const tr of project.transitions) {
    transitionFrom.set(tr.fromClipId, {
      kind: xfadeName(tr.kind),
      duration: Math.max(0.1, tr.durationSeconds),
    });
  }

  const hasBaseTransitions = baseClips.some((c) => transitionFrom.has(c.id));

  let currentBase: string;
  if (baseLabels.length === 0) {
    // No base-track clips: the lavfi canvas is the base.
    currentBase = `${baseInput}:v`;
  } else if (baseLabels.length === 1) {
    currentBase = baseLabels[0];
  } else if (!hasBaseTransitions) {
    // Simple, efficient path: a single concat for the whole sequence.
    const inputs = baseLabels.map((l) => `[${l}]`).join('');
    filters.push(`${inputs}concat=n=${baseLabels.length}:v=1:a=0[vbase]`);
    currentBase = 'vbase';
  } else {
    // Transitions present: fold clips left-to-right, using xfade (which overlaps
    // the two clips by the transition duration) where a transition is defined,
    // else a pairwise concat. Track the running timeline offset for xfade.
    let acc = baseLabels[0];
    let accDuration = baseClips[0].timelineDuration;
    for (let i = 1; i < baseLabels.length; i++) {
      const prevClip = baseClips[i - 1];
      const nextLabel = baseLabels[i];
      const tr = transitionFrom.get(prevClip.id);
      const outLabel = `vb${i}`;
      if (tr) {
        const d = Math.min(tr.duration, baseClips[i].timelineDuration, accDuration);
        const offset = Math.max(0, accDuration - d);
        filters.push(
          `[${acc}][${nextLabel}]xfade=transition=${tr.kind}:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[${outLabel}]`,
        );
        accDuration = accDuration + baseClips[i].timelineDuration - d;
      } else {
        filters.push(`[${acc}][${nextLabel}]concat=n=2:v=1:a=0[${outLabel}]`);
        accDuration += baseClips[i].timelineDuration;
      }
      acc = outLabel;
    }
    currentBase = acc;
  }

  // --- Overlay higher-track video clips (PiP) and image layers on top ---
  // Overlays are scaled to a fraction of the canvas and positioned by x/y as
  // the CENTER of the overlay, matching the renderer preview.
  let overlayStep = 0;
  for (const clip of overlayClips) {
    const label = registerVideoClip(clip, 'overlay');
    const outLabel = `ov${overlayStep}`;
    // x/y are the normalized center position; convert to top-left for overlay.
    const x = `(W-w)*${clamp01(clip.transform.x)}`;
    const y = `(H-h)*${clamp01(clip.transform.y)}`;
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
    const fontFile = resolveFontFile();
    const parts = [
      `text='${esc(t.text)}'`,
      `fontsize=${t.fontSize}`,
      `fontcolor=${t.color}@${t.opacity}`,
      `x=(w-text_w)*${t.x}`,
      `y=(h-text_h)*${t.y}`,
      `enable='between(t,${t.timelineStart},${layerEnd(t)})'`,
    ];
    // Explicit font is required (no fontconfig in ffmpeg-static).
    if (fontFile) parts.unshift(`fontfile='${escFontPath(fontFile)}'`);
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

/** Map our TransitionKind to an ffmpeg xfade transition name. */
function xfadeName(kind: string): string {
  switch (kind) {
    case 'fade':
    case 'crossdissolve':
      return 'fade';
    case 'slide':
      return 'slideleft';
    case 'wipe':
      return 'wipeleft';
    case 'zoom':
      return 'zoomin';
    case 'cut':
    default:
      return 'fade';
  }
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
