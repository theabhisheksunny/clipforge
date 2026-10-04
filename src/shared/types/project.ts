/**
 * Project domain model (spec section 21).
 *
 * The project is a pure data description of an edit. It stores *instructions*,
 * not rendered media. The RendererService translates this model into an FFmpeg
 * filter graph at export time. Editing never touches original files.
 */

import type { MediaAsset } from './media';

export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXTENSION = 'vedit';

export type AspectRatioPreset = '16:9' | '9:16' | '1:1' | '4:3' | '4:5' | 'custom';

export interface Canvas {
  width: number;
  height: number;
  fps: number;
  aspectRatio: AspectRatioPreset;
  /** Background color behind clips, hex (#rrggbb). */
  backgroundColor: string;
}

export interface Crop {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Transform {
  /** Normalized position of clip center within canvas (0..1). */
  x: number;
  y: number;
  /** Uniform scale multiplier. 1 = fit. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  /** 0..1 */
  opacity: number;
}

export interface AudioProperties {
  /** 0..N, 1 = 100%. */
  volume: number;
  muted: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export type TrackKind = 'video' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** Rendering order; higher index draws on top for video. */
  order: number;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  hidden: boolean;
  /** Per-track volume for audio tracks (1 = 100%). */
  volume: number;
}

/**
 * A single placement of a media asset on the timeline. The core
 * non-destructive unit (spec sections 3, 7, 21).
 */
export interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;

  /** Position on the timeline, in seconds. */
  timelineStart: number;
  /** How long the clip occupies the timeline, in seconds (after speed). */
  timelineDuration: number;

  /** In/out points within the source asset, in seconds. */
  sourceStart: number;
  sourceEnd: number;

  /** Playback speed multiplier (1 = normal). */
  speed: number;

  transform: Transform;
  crop: Crop;
  audio: AudioProperties;

  /** For audio detached from a video clip, links back to the originating clip. */
  detachedFromClipId?: string;
}

export type TextAlignment = 'left' | 'center' | 'right';

export interface TextLayer {
  id: string;
  trackId: string;
  text: string;
  timelineStart: number;
  timelineDuration: number;

  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  alignment: TextAlignment;
  opacity: number;
  backgroundColor: string | null;
  /** Normalized position of text box center (0..1). */
  x: number;
  y: number;
  rotation: number;
}

export type TransitionKind =
  | 'cut'
  | 'fade'
  | 'crossdissolve'
  | 'slide'
  | 'zoom'
  | 'wipe';

export interface Transition {
  id: string;
  kind: TransitionKind;
  /** Clips the transition sits between (both on the same video track). */
  fromClipId: string;
  toClipId: string;
  durationSeconds: number;
}

export interface ProjectSettings {
  autosaveEnabled: boolean;
  autosaveIntervalSeconds: number;
  snapEnabled: boolean;
  snapThresholdPixels: number;
}

export interface Project {
  schemaVersion: number;
  projectId: string;
  projectName: string;
  canvas: Canvas;

  /** Imported media references. */
  mediaAssets: MediaAsset[];

  tracks: Track[];
  clips: TimelineClip[];
  textLayers: TextLayer[];
  transitions: Transition[];

  settings: ProjectSettings;

  createdAt: number;
  modifiedAt: number;
}

/** Serialized project file written to disk as *.vedit (JSON). */
export interface ProjectFile {
  version: number;
  project: Project;
  /** Absolute path the file was loaded from, when known. */
  savedPath?: string;
}
