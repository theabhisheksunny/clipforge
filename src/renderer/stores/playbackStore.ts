/**
 * Playback state: current playhead time, playing flag, volume, speed.
 * The Preview component drives the clock via requestAnimationFrame.
 */

import { create } from 'zustand';

interface PlaybackState {
  currentTime: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
  /** Total project duration, kept in sync by the timeline. */
  duration: number;

  setCurrentTime: (t: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (r: number) => void;
  setDuration: (d: number) => void;
  seekBy: (delta: number) => void;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  currentTime: 0,
  playing: false,
  volume: 1,
  muted: false,
  playbackRate: 1,
  duration: 0,

  setCurrentTime: (t) => set({ currentTime: Math.max(0, t) }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setVolume: (v) => set({ volume: Math.min(1, Math.max(0, v)) }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  setPlaybackRate: (r) => set({ playbackRate: r }),
  setDuration: (d) => set({ duration: Math.max(0, d) }),
  seekBy: (delta) => {
    const { currentTime, duration } = get();
    set({ currentTime: Math.min(duration, Math.max(0, currentTime + delta)) });
  },
}));
