/**
 * Export / render types (spec sections 25, 26, 29).
 */

export type ExportResolution = '480p' | '720p' | '1080p' | '1440p' | '4K';
export type ExportFormat = 'mp4' | 'webm';
export type ExportVideoCodec = 'h264' | 'h265' | 'vp9';
export type ExportAudioCodec = 'aac' | 'opus' | 'none';
export type ExportFpsOption = 'source' | '24' | '30' | '60';
export type ExportQuality = 'low' | 'medium' | 'high' | 'custom';

export interface ExportSettings {
  resolution: ExportResolution;
  format: ExportFormat;
  videoCodec: ExportVideoCodec;
  audioCodec: ExportAudioCodec;
  fps: ExportFpsOption;
  quality: ExportQuality;
  /** CRF value when quality is 'custom'. */
  customCrf?: number;
  outputPath: string;
}

export const RESOLUTION_DIMENSIONS: Record<ExportResolution, { width: number; height: number }> = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4K': { width: 3840, height: 2160 },
};

export type RenderStage =
  | 'preparing'
  | 'processing-video'
  | 'processing-audio'
  | 'muxing'
  | 'finalizing'
  | 'done'
  | 'cancelled'
  | 'error';

export interface RenderProgress {
  jobId: string;
  stage: RenderStage;
  /** 0..1 */
  progress: number;
  /** Seconds, if estimable. */
  etaSeconds: number | null;
  outputSizeBytes: number | null;
  message?: string;
}

export interface RenderResult {
  jobId: string;
  success: boolean;
  outputPath?: string;
  outputSizeBytes?: number;
  durationSeconds?: number;
  /** Raw ffmpeg output, surfaced only behind "Show Details". */
  details?: string;
  error?: string;
}
