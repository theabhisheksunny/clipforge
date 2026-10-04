/**
 * Pure planning for the "Loop Video to Audio" feature (spec: non-destructive).
 *
 * Given a video duration and an audio duration, compute how many times the
 * video must repeat to cover the audio, and the per-repetition source/timeline
 * windows. The last repetition is trimmed so the total exactly equals the audio
 * duration (unless the audio is an exact multiple of the video, in which case
 * every repetition is a full-length clip).
 *
 * This function is dependency-free (no ids, no DOM) so it can be unit tested
 * in isolation and reused from both the renderer store and the main process.
 */

const EPS = 1e-6;

export interface LoopClipPlan {
  /** In-point within the source video, in seconds. */
  sourceStart: number;
  /** Out-point within the source video, in seconds. */
  sourceEnd: number;
  /** Position on the timeline, in seconds. */
  timelineStart: number;
  /** How long the clip occupies the timeline, in seconds. */
  timelineDuration: number;
}

export interface LoopPlan {
  /** Number of video repetitions needed to cover the audio. */
  repetitions: number;
  /** One entry per repetition, in timeline order. */
  clips: LoopClipPlan[];
  /** Total covered duration; equals audioDuration (within float epsilon). */
  totalDuration: number;
}

/**
 * Plan the loop. Throws when either duration is not a positive, finite number.
 */
export function planLoopVideoToAudio(
  videoDuration: number,
  audioDuration: number,
): LoopPlan {
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
    throw new Error('videoDuration must be a positive, finite number.');
  }
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
    throw new Error('audioDuration must be a positive, finite number.');
  }

  const repetitions = Math.ceil(audioDuration / videoDuration - EPS);
  const clips: LoopClipPlan[] = [];

  for (let k = 0; k < repetitions; k++) {
    const timelineStart = k * videoDuration;
    const isLast = k === repetitions - 1;
    // The last clip is trimmed so the sum of all clips equals audioDuration.
    // When the audio is an exact multiple of the video this evaluates to a full
    // videoDuration, so no trim occurs.
    const duration = isLast
      ? audioDuration - (repetitions - 1) * videoDuration
      : videoDuration;

    clips.push({
      sourceStart: 0,
      sourceEnd: duration,
      timelineStart,
      timelineDuration: duration,
    });
  }

  const totalDuration = clips.reduce((sum, c) => sum + c.timelineDuration, 0);

  return { repetitions, clips, totalDuration };
}
