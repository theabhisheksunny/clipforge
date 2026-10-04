/**
 * Factory functions for creating default domain objects. Pure, no side effects,
 * safe to use from both main and renderer.
 */

import { nanoid } from 'nanoid';
import type {
  AudioProperties,
  Crop,
  Project,
  ProjectSettings,
  TimelineClip,
  Track,
  Transform,
} from '../types/project';
import type { MediaAsset } from '../types/media';
import { DEFAULT_CANVAS } from '../constants';

export const createId = (): string => nanoid(12);

export function defaultTransform(): Transform {
  return {
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    opacity: 1,
  };
}

export function defaultCrop(): Crop {
  return { top: 0, bottom: 0, left: 0, right: 0 };
}

export function defaultAudioProperties(): AudioProperties {
  return { volume: 1, muted: false, fadeInSeconds: 0, fadeOutSeconds: 0 };
}

export function defaultSettings(): ProjectSettings {
  return {
    autosaveEnabled: true,
    autosaveIntervalSeconds: 30,
    snapEnabled: true,
    snapThresholdPixels: 8,
  };
}

export function createTrack(kind: Track['kind'], order: number, name?: string): Track {
  return {
    id: createId(),
    kind,
    name: name ?? `${kind === 'video' ? 'Video' : 'Audio'} ${order + 1}`,
    order,
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    volume: 1,
  };
}

export function createProject(name = 'Untitled Project'): Project {
  const now = Date.now();
  const videoTrack = createTrack('video', 0, 'Video 1');
  const audioTrack = createTrack('audio', 0, 'Audio 1');
  return {
    schemaVersion: 1,
    projectId: createId(),
    projectName: name,
    canvas: { ...DEFAULT_CANVAS },
    mediaAssets: [],
    tracks: [videoTrack, audioTrack],
    clips: [],
    textLayers: [],
    transitions: [],
    settings: defaultSettings(),
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Build a timeline clip for an asset placed at a given start time on a track.
 * Honors the asset's natural duration for video/audio, and a provided default
 * for images (which have no intrinsic duration).
 */
export function createClipFromAsset(params: {
  asset: MediaAsset;
  trackId: string;
  timelineStart: number;
  imageDuration?: number;
}): TimelineClip {
  const { asset, trackId, timelineStart, imageDuration = 5 } = params;
  const sourceDuration = asset.kind === 'image' ? imageDuration : asset.metadata.duration;
  return {
    id: createId(),
    assetId: asset.id,
    trackId,
    timelineStart,
    timelineDuration: sourceDuration,
    sourceStart: 0,
    sourceEnd: sourceDuration,
    speed: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    audio: defaultAudioProperties(),
  };
}
