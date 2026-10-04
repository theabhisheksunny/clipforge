/**
 * Pure timeline operations. These functions take clips and return new clips;
 * they never mutate inputs. The editor store applies the results. Keeping them
 * pure makes undo/redo and unit testing straightforward (spec rule 12).
 */

import type { TimelineClip } from '../types/project';
import { createId } from './factories';

const EPS = 1e-6;

export function clipEnd(clip: TimelineClip): number {
  return clip.timelineStart + clip.timelineDuration;
}

/** Source seconds consumed per timeline second, accounting for speed. */
export function sourcePerTimelineSecond(clip: TimelineClip): number {
  return clip.speed;
}

/**
 * Split a clip at an absolute timeline time. Returns [left, right] or null if
 * the time is not strictly inside the clip. Both halves reference the same
 * asset with adjusted source in/out points (non-destructive — spec section 8).
 */
export function splitClip(clip: TimelineClip, timelineTime: number): [TimelineClip, TimelineClip] | null {
  if (timelineTime <= clip.timelineStart + EPS) return null;
  if (timelineTime >= clipEnd(clip) - EPS) return null;

  const offsetTimeline = timelineTime - clip.timelineStart;
  const offsetSource = offsetTimeline * clip.speed;
  const splitSource = clip.sourceStart + offsetSource;

  const left: TimelineClip = {
    ...clip,
    timelineDuration: offsetTimeline,
    sourceEnd: splitSource,
    transform: { ...clip.transform },
    crop: { ...clip.crop },
    audio: { ...clip.audio },
  };

  const right: TimelineClip = {
    ...clip,
    id: createId(),
    timelineStart: timelineTime,
    timelineDuration: clip.timelineDuration - offsetTimeline,
    sourceStart: splitSource,
    transform: { ...clip.transform },
    crop: { ...clip.crop },
    audio: { ...clip.audio },
  };

  return [left, right];
}

/**
 * Duplicate a clip, placing the copy immediately after the original on the same
 * track. Independent source edits are preserved (spec section 9).
 */
export function duplicateClip(clip: TimelineClip): TimelineClip {
  return {
    ...clip,
    id: createId(),
    timelineStart: clipEnd(clip),
    transform: { ...clip.transform },
    crop: { ...clip.crop },
    audio: { ...clip.audio },
  };
}

/**
 * Trim the start edge of a clip by a timeline delta (positive trims inward).
 * Adjusts sourceStart so the remaining content is non-destructive. Clamps so
 * the clip keeps a minimum duration and never exceeds the source range.
 */
export function trimStart(clip: TimelineClip, deltaTimeline: number, minDuration = 0.1): TimelineClip {
  const newDuration = clip.timelineDuration - deltaTimeline;
  if (newDuration < minDuration) deltaTimeline = clip.timelineDuration - minDuration;

  const deltaSource = deltaTimeline * clip.speed;
  const newSourceStart = clip.sourceStart + deltaSource;
  const clampedSourceStart = Math.max(0, newSourceStart);
  const appliedSourceDelta = clampedSourceStart - clip.sourceStart;
  const appliedTimelineDelta = appliedSourceDelta / clip.speed;

  return {
    ...clip,
    timelineStart: clip.timelineStart + appliedTimelineDelta,
    timelineDuration: clip.timelineDuration - appliedTimelineDelta,
    sourceStart: clampedSourceStart,
  };
}

/**
 * Trim the end edge of a clip by a timeline delta (positive trims inward).
 */
export function trimEnd(
  clip: TimelineClip,
  deltaTimeline: number,
  sourceLimit: number,
  minDuration = 0.1,
): TimelineClip {
  let newDuration = clip.timelineDuration - deltaTimeline;
  if (newDuration < minDuration) newDuration = minDuration;

  let newSourceEnd = clip.sourceStart + newDuration * clip.speed;
  if (newSourceEnd > sourceLimit + EPS) {
    newSourceEnd = sourceLimit;
    newDuration = (newSourceEnd - clip.sourceStart) / clip.speed;
  }

  return {
    ...clip,
    timelineDuration: newDuration,
    sourceEnd: newSourceEnd,
  };
}

/** Set an absolute playback speed, keeping source in/out and recomputing timeline duration. */
export function setSpeed(clip: TimelineClip, speed: number): TimelineClip {
  const safeSpeed = Math.max(0.05, speed);
  const sourceSpan = clip.sourceEnd - clip.sourceStart;
  return {
    ...clip,
    speed: safeSpeed,
    timelineDuration: sourceSpan / safeSpeed,
  };
}

/**
 * Reflow clips on a track so they sit end-to-end in order with no gaps.
 * Used after reorder/delete when gapless layout is desired.
 */
export function reflowTrack(clips: TimelineClip[]): TimelineClip[] {
  const sorted = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
  let cursor = 0;
  return sorted.map((c) => {
    const placed = { ...c, timelineStart: cursor };
    cursor += c.timelineDuration;
    return placed;
  });
}

/** Snap a time to nearby clip boundaries within a threshold (seconds). */
export function snapTime(
  time: number,
  boundaries: number[],
  thresholdSeconds: number,
): number {
  let best = time;
  let bestDist = thresholdSeconds;
  for (const b of boundaries) {
    const d = Math.abs(b - time);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

/** Total timeline duration across all clips and text layers. */
export function projectDuration(clips: TimelineClip[], extraEnds: number[] = []): number {
  const ends = clips.map(clipEnd).concat(extraEnds);
  return ends.length ? Math.max(...ends) : 0;
}
