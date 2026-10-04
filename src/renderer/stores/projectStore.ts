/**
 * Project store: the single source of truth for the edit. Holds the Project and
 * an undo/redo history. Every mutation goes through `commit`, which snapshots
 * the prior state onto the undo stack (spec section 23).
 *
 * Snapshots are structurally cloned Project objects. For a project of realistic
 * size this is cheap and makes undo/redo trivially correct.
 */

import { create } from 'zustand';
import type {
  Project,
  MediaAsset,
  TimelineClip,
  TextLayer,
  Track,
  Transition,
  Canvas,
} from '@shared/types';
import { createProject, createClipFromAsset, createTrack } from '@shared/utils/factories';
import {
  splitClip as splitClipOp,
  duplicateClip as duplicateClipOp,
  setSpeed as setSpeedOp,
} from '@shared/utils/timeline';
import { DEFAULT_IMAGE_DURATION } from '@shared/constants';

const HISTORY_LIMIT = 100;

function clone<T>(obj: T): T {
  return structuredClone(obj);
}

interface ProjectState {
  project: Project;
  savedPath: string | null;
  dirty: boolean;
  past: Project[];
  future: Project[];

  // history
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // lifecycle
  setProject: (project: Project, savedPath?: string | null) => void;
  newProject: (name?: string) => void;
  markSaved: (path: string) => void;

  // media
  addAssets: (assets: MediaAsset[]) => void;
  removeAsset: (assetId: string) => void;
  renameAsset: (assetId: string, name: string) => void;
  relinkAsset: (asset: MediaAsset) => void;
  updateAsset: (assetId: string, patch: Partial<MediaAsset>) => void;

  // clips
  addClipFromAsset: (asset: MediaAsset, trackId: string, timelineStart: number) => string;
  updateClip: (clipId: string, patch: Partial<TimelineClip>) => void;
  moveClip: (clipId: string, trackId: string, timelineStart: number) => void;
  removeClip: (clipId: string) => void;
  splitClipAt: (clipId: string, timelineTime: number) => string | null;
  duplicateClip: (clipId: string) => string | null;
  setClipSpeed: (clipId: string, speed: number) => void;

  // tracks
  addTrack: (kind: Track['kind']) => string;
  updateTrack: (trackId: string, patch: Partial<Track>) => void;
  removeTrack: (trackId: string) => void;

  // text
  addTextLayer: (layer: TextLayer) => void;
  updateTextLayer: (id: string, patch: Partial<TextLayer>) => void;
  removeTextLayer: (id: string) => void;

  // transitions
  addTransition: (transition: Transition) => void;
  removeTransition: (id: string) => void;

  // canvas
  updateCanvas: (patch: Partial<Canvas>) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => {
  /** Apply a pure transform to the project, pushing history. */
  const commit = (fn: (draft: Project) => Project | void): void => {
    const state = get();
    const prev = state.project;
    const draft = clone(prev);
    const result = fn(draft) ?? draft;
    result.modifiedAt = Date.now();
    const past = [...state.past, prev].slice(-HISTORY_LIMIT);
    set({
      project: result,
      past,
      future: [],
      dirty: true,
      canUndo: true,
      canRedo: false,
    });
  };

  const initial = createProject();

  return {
    project: initial,
    savedPath: null,
    dirty: false,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,

    undo: () => {
      const { past, future, project } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      const newPast = past.slice(0, -1);
      set({
        project: previous,
        past: newPast,
        future: [project, ...future].slice(0, HISTORY_LIMIT),
        dirty: true,
        canUndo: newPast.length > 0,
        canRedo: true,
      });
    },

    redo: () => {
      const { past, future, project } = get();
      if (future.length === 0) return;
      const next = future[0];
      const newFuture = future.slice(1);
      set({
        project: next,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: newFuture,
        dirty: true,
        canUndo: true,
        canRedo: newFuture.length > 0,
      });
    },

    setProject: (project, savedPath = null) =>
      set({
        project,
        savedPath,
        dirty: false,
        past: [],
        future: [],
        canUndo: false,
        canRedo: false,
      }),

    newProject: (name) =>
      set({
        project: createProject(name),
        savedPath: null,
        dirty: false,
        past: [],
        future: [],
        canUndo: false,
        canRedo: false,
      }),

    markSaved: (path) => set({ savedPath: path, dirty: false }),

    addAssets: (assets) =>
      commit((d) => {
        d.mediaAssets.push(...assets);
      }),

    removeAsset: (assetId) =>
      commit((d) => {
        d.mediaAssets = d.mediaAssets.filter((a) => a.id !== assetId);
        d.clips = d.clips.filter((c) => c.assetId !== assetId);
      }),

    renameAsset: (assetId, name) =>
      commit((d) => {
        const a = d.mediaAssets.find((x) => x.id === assetId);
        if (a) a.name = name;
      }),

    relinkAsset: (asset) =>
      commit((d) => {
        const idx = d.mediaAssets.findIndex((a) => a.id === asset.id);
        if (idx >= 0) d.mediaAssets[idx] = asset;
      }),

    updateAsset: (assetId, patch) =>
      commit((d) => {
        const a = d.mediaAssets.find((x) => x.id === assetId);
        if (a) Object.assign(a, patch);
      }),

    addClipFromAsset: (asset, trackId, timelineStart) => {
      const clip = createClipFromAsset({
        asset,
        trackId,
        timelineStart,
        imageDuration: DEFAULT_IMAGE_DURATION,
      });
      commit((d) => {
        d.clips.push(clip);
      });
      return clip.id;
    },

    updateClip: (clipId, patch) =>
      commit((d) => {
        const c = d.clips.find((x) => x.id === clipId);
        if (c) Object.assign(c, patch);
      }),

    moveClip: (clipId, trackId, timelineStart) =>
      commit((d) => {
        const c = d.clips.find((x) => x.id === clipId);
        if (c) {
          c.trackId = trackId;
          c.timelineStart = Math.max(0, timelineStart);
        }
      }),

    removeClip: (clipId) =>
      commit((d) => {
        d.clips = d.clips.filter((c) => c.id !== clipId);
        d.transitions = d.transitions.filter(
          (t) => t.fromClipId !== clipId && t.toClipId !== clipId,
        );
      }),

    splitClipAt: (clipId, timelineTime) => {
      const { project } = get();
      const clip = project.clips.find((c) => c.id === clipId);
      if (!clip) return null;
      const result = splitClipOp(clip, timelineTime);
      if (!result) return null;
      const [left, right] = result;
      commit((d) => {
        const idx = d.clips.findIndex((c) => c.id === clipId);
        if (idx >= 0) d.clips.splice(idx, 1, left, right);
      });
      return right.id;
    },

    duplicateClip: (clipId) => {
      const { project } = get();
      const clip = project.clips.find((c) => c.id === clipId);
      if (!clip) return null;
      const dup = duplicateClipOp(clip);
      commit((d) => {
        d.clips.push(dup);
      });
      return dup.id;
    },

    setClipSpeed: (clipId, speed) =>
      commit((d) => {
        const idx = d.clips.findIndex((c) => c.id === clipId);
        if (idx >= 0) d.clips[idx] = setSpeedOp(d.clips[idx], speed);
      }),

    addTrack: (kind) => {
      const order = get().project.tracks.filter((t) => t.kind === kind).length;
      const track = createTrack(kind, order);
      commit((d) => {
        d.tracks.push(track);
      });
      return track.id;
    },

    updateTrack: (trackId, patch) =>
      commit((d) => {
        const t = d.tracks.find((x) => x.id === trackId);
        if (t) Object.assign(t, patch);
      }),

    removeTrack: (trackId) =>
      commit((d) => {
        d.tracks = d.tracks.filter((t) => t.id !== trackId);
        d.clips = d.clips.filter((c) => c.trackId !== trackId);
        d.textLayers = d.textLayers.filter((l) => l.trackId !== trackId);
      }),

    addTextLayer: (layer) =>
      commit((d) => {
        d.textLayers.push(layer);
      }),

    updateTextLayer: (id, patch) =>
      commit((d) => {
        const l = d.textLayers.find((x) => x.id === id);
        if (l) Object.assign(l, patch);
      }),

    removeTextLayer: (id) =>
      commit((d) => {
        d.textLayers = d.textLayers.filter((l) => l.id !== id);
      }),

    addTransition: (transition) =>
      commit((d) => {
        d.transitions.push(transition);
      }),

    removeTransition: (id) =>
      commit((d) => {
        d.transitions = d.transitions.filter((t) => t.id !== id);
      }),

    updateCanvas: (patch) =>
      commit((d) => {
        Object.assign(d.canvas, patch);
      }),
  };
});
