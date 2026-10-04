/**
 * Editor UI state: selection, timeline zoom, snapping, clipboard, active panel.
 * This is ephemeral view state and is NOT part of undo/redo history.
 */

import { create } from 'zustand';
import type { TimelineClip } from '@shared/types';
import { DEFAULT_PX_PER_SECOND, MIN_PX_PER_SECOND, MAX_PX_PER_SECOND } from '@shared/constants';

export type MediaPanelTab =
  | 'media'
  | 'audio'
  | 'text'
  | 'images'
  | 'effects'
  | 'transitions'
  | 'canvas';
export type SelectionKind = 'clip' | 'text' | null;

interface EditorState {
  selectedClipId: string | null;
  selectedTextId: string | null;
  selectionKind: SelectionKind;

  pxPerSecond: number;
  snapEnabled: boolean;
  activeTab: MediaPanelTab;
  mediaSearch: string;

  /** Clipboard holds a detached copy of a clip for paste. */
  clipboard: TimelineClip | null;

  selectClip: (id: string | null) => void;
  selectText: (id: string | null) => void;
  clearSelection: () => void;

  setZoom: (pxPerSecond: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  toggleSnap: () => void;
  setActiveTab: (tab: MediaPanelTab) => void;
  setMediaSearch: (q: string) => void;
  setClipboard: (clip: TimelineClip | null) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedClipId: null,
  selectedTextId: null,
  selectionKind: null,

  pxPerSecond: DEFAULT_PX_PER_SECOND,
  snapEnabled: true,
  activeTab: 'media',
  mediaSearch: '',
  clipboard: null,

  selectClip: (id) => set({ selectedClipId: id, selectedTextId: null, selectionKind: id ? 'clip' : null }),
  selectText: (id) => set({ selectedTextId: id, selectedClipId: null, selectionKind: id ? 'text' : null }),
  clearSelection: () => set({ selectedClipId: null, selectedTextId: null, selectionKind: null }),

  setZoom: (pxPerSecond) =>
    set({ pxPerSecond: Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond)) }),
  zoomIn: () => get().setZoom(get().pxPerSecond * 1.3),
  zoomOut: () => get().setZoom(get().pxPerSecond / 1.3),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setMediaSearch: (q) => set({ mediaSearch: q }),
  setClipboard: (clip) => set({ clipboard: clip }),
}));
