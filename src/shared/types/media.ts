/**
 * Media domain types.
 *
 * A MediaAsset is a *reference* to an original file on disk plus the metadata
 * extracted by ffprobe. Original files are never modified. Multiple timeline
 * clips may reference the same asset independently.
 */

export type MediaKind = 'video' | 'audio' | 'image';

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'avi', 'webm'] as const;
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'm4a', 'flac'] as const;
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

export interface VideoStreamInfo {
  index: number;
  codec: string;
  width: number;
  height: number;
  /** Frames per second as a decimal (e.g. 29.97). */
  fps: number;
  /** Display aspect ratio string, e.g. "16:9". */
  aspectRatio: string;
  bitRate: number | null;
  pixelFormat: string | null;
}

export interface AudioStreamInfo {
  index: number;
  codec: string;
  sampleRate: number;
  channels: number;
  channelLayout: string | null;
  bitRate: number | null;
}

/**
 * Raw technical metadata produced by ffprobe. Mirrors spec section 2/27.
 */
export interface MediaMetadata {
  /** Container duration in seconds. 0 for still images. */
  duration: number;
  format: string | null;
  sizeBytes: number;
  bitRate: number | null;
  videoStreams: VideoStreamInfo[];
  audioStreams: AudioStreamInfo[];
  /** For still images only. */
  imageWidth?: number;
  imageHeight?: number;
}

export interface MediaAsset {
  id: string;
  /** Absolute path to the original file. Never mutated. */
  path: string;
  /** User-facing name; defaults to the file name, can be renamed. */
  name: string;
  kind: MediaKind;
  /** Lowercased file extension without the dot. */
  extension: string;
  metadata: MediaMetadata;
  /** Path to a cached thumbnail image, if generated. */
  thumbnailPath?: string;
  /** Whether the original file is currently reachable on disk. */
  missing: boolean;
  importedAt: number;
}

export function kindForExtension(ext: string): MediaKind | null {
  const e = ext.toLowerCase().replace(/^\./, '');
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(e)) return 'video';
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(e)) return 'audio';
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(e)) return 'image';
  return null;
}

export const ALL_MEDIA_EXTENSIONS = [
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
] as const;
