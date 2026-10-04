import type { AspectRatioPreset, Canvas } from '../types/project';

export const APP_NAME = 'Kiro Video Editor';

export const DEFAULT_CANVAS: Canvas = {
  width: 1920,
  height: 1080,
  fps: 30,
  aspectRatio: '16:9',
  backgroundColor: '#000000',
};

export const ASPECT_PRESETS: Record<
  Exclude<AspectRatioPreset, 'custom'>,
  { width: number; height: number; label: string }
> = {
  '16:9': { width: 1920, height: 1080, label: 'Landscape (YouTube) 1920×1080' },
  '9:16': { width: 1080, height: 1920, label: 'Portrait (Shorts/Reels) 1080×1920' },
  '1:1': { width: 1080, height: 1080, label: 'Square (Instagram) 1080×1080' },
  '4:3': { width: 1440, height: 1080, label: 'Classic 1440×1080' },
  '4:5': { width: 1080, height: 1350, label: 'Portrait (Instagram) 1080×1350' },
};

/** Default duration (seconds) when an image is dropped on the timeline. */
export const DEFAULT_IMAGE_DURATION = 5;

/** Default duration (seconds) for a new text layer. */
export const DEFAULT_TEXT_DURATION = 5;

/** Default transition duration (seconds). */
export const DEFAULT_TRANSITION_DURATION = 1;

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4] as const;

/** Timeline zoom: pixels per second range. */
export const MIN_PX_PER_SECOND = 4;
export const MAX_PX_PER_SECOND = 240;
export const DEFAULT_PX_PER_SECOND = 50;

export const TRACK_HEIGHT = 72;
export const TIMELINE_RULER_HEIGHT = 28;
