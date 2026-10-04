import { describe, it, expect } from 'vitest';
import type { TimelineClip } from '../types/project';
import {
  clipEnd,
  splitClip,
  duplicateClip,
  trimStart,
  trimEnd,
  setSpeed,
  reflowTrack,
  snapTime,
  projectDuration,
} from './timeline';

function makeClip(partial: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'c1',
    assetId: 'a1',
    trackId: 't1',
    timelineStart: 0,
    timelineDuration: 10,
    sourceStart: 0,
    sourceEnd: 10,
    speed: 1,
    transform: {
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      opacity: 1,
    },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    audio: { volume: 1, muted: false, fadeInSeconds: 0, fadeOutSeconds: 0 },
    ...partial,
  };
}

describe('splitClip', () => {
  it('splits a clip at an interior time into two independent halves', () => {
    const clip = makeClip({ timelineStart: 0, timelineDuration: 60, sourceEnd: 60 });
    const result = splitClip(clip, 25);
    expect(result).not.toBeNull();
    const [left, right] = result!;
    expect(left.timelineStart).toBe(0);
    expect(left.timelineDuration).toBe(25);
    expect(left.sourceEnd).toBe(25);
    expect(right.timelineStart).toBe(25);
    expect(right.timelineDuration).toBe(35);
    expect(right.sourceStart).toBe(25);
    expect(right.sourceEnd).toBe(60);
    // Independent ids
    expect(right.id).not.toBe(left.id);
  });

  it('accounts for a trimmed source window', () => {
    const clip = makeClip({ timelineStart: 10, timelineDuration: 40, sourceStart: 15, sourceEnd: 55 });
    const [left, right] = splitClip(clip, 30)!;
    // 20s into the clip => source 15 + 20 = 35
    expect(left.sourceEnd).toBe(35);
    expect(right.sourceStart).toBe(35);
    expect(right.sourceEnd).toBe(55);
  });

  it('respects speed when computing the split source point', () => {
    const clip = makeClip({ timelineDuration: 5, sourceStart: 0, sourceEnd: 10, speed: 2 });
    const [left, right] = splitClip(clip, 2)!;
    // 2 timeline seconds * speed 2 = 4 source seconds
    expect(left.sourceEnd).toBe(4);
    expect(right.sourceStart).toBe(4);
  });

  it('returns null when the time is outside the clip', () => {
    const clip = makeClip({ timelineStart: 0, timelineDuration: 10 });
    expect(splitClip(clip, 0)).toBeNull();
    expect(splitClip(clip, 10)).toBeNull();
    expect(splitClip(clip, 15)).toBeNull();
  });
});

describe('duplicateClip', () => {
  it('places the copy immediately after and keeps source edits independent', () => {
    const clip = makeClip({ timelineStart: 5, timelineDuration: 10, sourceStart: 2, sourceEnd: 12 });
    const dup = duplicateClip(clip);
    expect(dup.id).not.toBe(clip.id);
    expect(dup.timelineStart).toBe(clipEnd(clip));
    expect(dup.sourceStart).toBe(2);
    expect(dup.sourceEnd).toBe(12);
    // Mutating the copy must not affect the original
    dup.audio.volume = 0.3;
    expect(clip.audio.volume).toBe(1);
  });
});

describe('trimStart / trimEnd', () => {
  it('trims the start edge non-destructively', () => {
    const clip = makeClip({ timelineStart: 0, timelineDuration: 10, sourceStart: 0, sourceEnd: 10 });
    const trimmed = trimStart(clip, 3);
    expect(trimmed.timelineStart).toBeCloseTo(3);
    expect(trimmed.timelineDuration).toBeCloseTo(7);
    expect(trimmed.sourceStart).toBeCloseTo(3);
    expect(trimmed.sourceEnd).toBe(10);
  });

  it('clamps start trim so source never goes negative', () => {
    const clip = makeClip({ sourceStart: 1, sourceEnd: 10, timelineStart: 0, timelineDuration: 9 });
    const trimmed = trimStart(clip, 5, 0.1);
    expect(trimmed.sourceStart).toBeGreaterThanOrEqual(0);
  });

  it('trims the end edge and clamps to the source limit', () => {
    const clip = makeClip({ timelineDuration: 10, sourceStart: 0, sourceEnd: 10 });
    const trimmed = trimEnd(clip, -5, 12); // extend by 5, limit 12
    expect(trimmed.sourceEnd).toBeLessThanOrEqual(12);
  });
});

describe('setSpeed', () => {
  it('recomputes timeline duration from source span', () => {
    const clip = makeClip({ sourceStart: 0, sourceEnd: 10, timelineDuration: 10, speed: 1 });
    const fast = setSpeed(clip, 2);
    expect(fast.speed).toBe(2);
    expect(fast.timelineDuration).toBe(5);
    const slow = setSpeed(clip, 0.5);
    expect(slow.timelineDuration).toBe(20);
  });
});

describe('reflowTrack', () => {
  it('lays clips end-to-end with no gaps in start order', () => {
    const a = makeClip({ id: 'a', timelineStart: 0, timelineDuration: 5 });
    const b = makeClip({ id: 'b', timelineStart: 20, timelineDuration: 3 });
    const c = makeClip({ id: 'c', timelineStart: 8, timelineDuration: 4 });
    const flowed = reflowTrack([a, b, c]);
    expect(flowed.map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(flowed[0].timelineStart).toBe(0);
    expect(flowed[1].timelineStart).toBe(5);
    expect(flowed[2].timelineStart).toBe(9);
  });
});

describe('snapTime', () => {
  it('snaps to the nearest boundary within threshold', () => {
    expect(snapTime(10.3, [5, 10, 15], 0.5)).toBe(10);
    expect(snapTime(10.3, [5, 10, 15], 0.1)).toBe(10.3);
  });
});

describe('projectDuration', () => {
  it('returns the furthest clip end', () => {
    const a = makeClip({ timelineStart: 0, timelineDuration: 5 });
    const b = makeClip({ timelineStart: 10, timelineDuration: 7 });
    expect(projectDuration([a, b])).toBe(17);
    expect(projectDuration([], [])).toBe(0);
  });
});
