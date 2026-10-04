import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useAssetMap } from '../../hooks/useProjectSelectors';
import { TRACK_HEIGHT } from '@shared/constants';
import { Clip } from './Clip';
import type { Track } from '@shared/types';

const laneClass: Record<string, string> = {
  video: 'bg-track-video/20',
  audio: 'bg-track-audio/20',
};

export function TrackRow({
  track,
  pxPerSecond,
  onDropAsset,
  boundaries,
}: {
  track: Track;
  pxPerSecond: number;
  onDropAsset: (clientX: number, assetId: string) => void;
  boundaries: number[];
}) {
  const clips = useProjectStore((s) => s.project.clips.filter((c) => c.trackId === track.id));
  const assetMap = useAssetMap();
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      data-lane="track"
      style={{ height: TRACK_HEIGHT }}
      className={`relative border-b border-panel-border ${laneClass[track.kind]} ${
        dragOver ? 'ring-1 ring-accent ring-inset' : ''
      }`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-asset-id')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const assetId = e.dataTransfer.getData('application/x-asset-id');
        if (assetId) onDropAsset(e.clientX, assetId);
      }}
    >
      {clips.map((clip) => {
        const asset = assetMap.get(clip.assetId);
        if (!asset) return null;
        return (
          <Clip
            key={clip.id}
            clip={clip}
            asset={asset}
            pxPerSecond={pxPerSecond}
            trackKind={track.kind}
            boundaries={boundaries}
          />
        );
      })}
    </div>
  );
}
