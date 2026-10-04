import { describe, it, expect } from 'vitest';
import { planLoopVideoToAudio } from './loop';

describe('planLoopVideoToAudio', () => {
  it('plans 3 reps for the verified video/audio pair and trims the last clip', () => {
    const videoDuration = 60.033333;
    const audioDuration = 138.024;
    const plan = planLoopVideoToAudio(videoDuration, audioDuration);

    expect(plan.repetitions).toBe(3);
    expect(plan.clips).toHaveLength(3);

    // Timeline starts are k * videoDuration.
    expect(plan.clips[0].timelineStart).toBeCloseTo(0, 6);
    expect(plan.clips[1].timelineStart).toBeCloseTo(60.033333, 6);
    expect(plan.clips[2].timelineStart).toBeCloseTo(120.066666, 6);

    // First two clips are full-length.
    expect(plan.clips[0].timelineDuration).toBeCloseTo(60.033333, 6);
    expect(plan.clips[0].sourceEnd).toBeCloseTo(60.033333, 6);
    expect(plan.clips[1].timelineDuration).toBeCloseTo(60.033333, 6);

    // Last clip trimmed to ~17.9573.
    expect(plan.clips[2].timelineDuration).toBeCloseTo(17.9573, 3);
    expect(plan.clips[2].sourceEnd).toBeCloseTo(17.9573, 3);
    expect(plan.clips[2].sourceStart).toBe(0);

    // Sum equals the audio duration.
    expect(plan.totalDuration).toBeCloseTo(138.024, 6);
  });

  it('plans 9 reps with the second verified pair', () => {
    const plan = planLoopVideoToAudio(17.42, 143.81);
    expect(plan.repetitions).toBe(9);
    expect(plan.clips).toHaveLength(9);
    const last = plan.clips[plan.clips.length - 1];
    expect(last.timelineDuration).toBeCloseTo(4.45, 2);
    expect(plan.totalDuration).toBeCloseTo(143.81, 6);
  });

  it('does not trim when the audio is an exact multiple of the video', () => {
    const plan = planLoopVideoToAudio(30, 120);
    expect(plan.repetitions).toBe(4);
    expect(plan.clips).toHaveLength(4);
    for (const c of plan.clips) {
      expect(c.timelineDuration).toBeCloseTo(30, 6);
      expect(c.sourceEnd).toBeCloseTo(30, 6);
    }
    expect(plan.totalDuration).toBeCloseTo(120, 6);
  });

  it('plans a single full clip when the audio is shorter than or equal to the video', () => {
    const plan = planLoopVideoToAudio(60, 40);
    expect(plan.repetitions).toBe(1);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0].timelineDuration).toBeCloseTo(40, 6);
    expect(plan.totalDuration).toBeCloseTo(40, 6);
  });

  it('throws on invalid inputs', () => {
    expect(() => planLoopVideoToAudio(0, 100)).toThrow();
    expect(() => planLoopVideoToAudio(-5, 100)).toThrow();
    expect(() => planLoopVideoToAudio(60, 0)).toThrow();
    expect(() => planLoopVideoToAudio(60, -1)).toThrow();
    expect(() => planLoopVideoToAudio(Number.NaN, 100)).toThrow();
    expect(() => planLoopVideoToAudio(60, Number.POSITIVE_INFINITY)).toThrow();
  });
});
