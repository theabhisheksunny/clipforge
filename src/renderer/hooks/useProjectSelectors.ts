/** Derived selectors over the project + playback state. */

import { useMemo } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { usePlaybackStore } from '../stores/playbackStore';
import { projectDuration, clipEnd } from '@shared/utils/timeline';
import type { MediaAsset, TimelineClip } from '@shared/types';

export function useAssetMap(): Map<string, MediaAsset> {
  const assets = useProjectStore((s) => s.project.mediaAssets);
  return useMemo(() => {
    const m = new Map<string, MediaAsset>();
    for (const a of assets) m.set(a.id, a);
    return m;
  }, [assets]);
}

export function useTotalDuration(): number {
  const clips = useProjectStore((s) => s.project.clips);
  const textLayers = useProjectStore((s) => s.project.textLayers);
  return useMemo(
    () => projectDuration(clips, textLayers.map((l) => l.timelineStart + l.timelineDuration)),
    [clips, textLayers],
  );
}

/** Find the top-most video clip active at a given timeline time. */
export function clipAtTime(
  clips: TimelineClip[],
  trackOrder: Map<string, number>,
  time: number,
): TimelineClip | null {
  let best: TimelineClip | null = null;
  let bestOrder = -1;
  for (const c of clips) {
    if (time >= c.timelineStart && time < clipEnd(c)) {
      const order = trackOrder.get(c.trackId) ?? 0;
      if (order >= bestOrder) {
        best = c;
        bestOrder = order;
      }
    }
  }
  return best;
}

export function useCurrentTime(): number {
  return usePlaybackStore((s) => s.currentTime);
}
