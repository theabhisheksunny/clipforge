import { useCallback, useMemo, useRef } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { usePlaybackStore } from '../../stores/playbackStore';
import { useAssetMap, useTotalDuration } from '../../hooks/useProjectSelectors';
import { TRACK_HEIGHT, TIMELINE_RULER_HEIGHT } from '@shared/constants';
import { TimelineRuler } from './TimelineRuler';
import { TrackRow } from './TrackRow';
import { Playhead } from './Playhead';
import { snapTime, clipEnd } from '@shared/utils/timeline';
import type { Track } from '@shared/types';

export function Timeline() {
  const project = useProjectStore((s) => s.project);
  const addClipFromAsset = useProjectStore((s) => s.addClipFromAsset);
  const addTrack = useProjectStore((s) => s.addTrack);

  const pxPerSecond = useEditorStore((s) => s.pxPerSecond);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const assetMap = useAssetMap();
  const duration = useTotalDuration();

  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);

  const scrollRef = useRef<HTMLDivElement>(null);

  const timelineWidth = Math.max(600, (duration + 20) * pxPerSecond);

  const tracks = useMemo(() => {
    const video = project.tracks.filter((t) => t.kind === 'video').sort((a, b) => b.order - a.order);
    const audio = project.tracks.filter((t) => t.kind === 'audio').sort((a, b) => a.order - b.order);
    return { video, audio };
  }, [project.tracks]);

  // Boundaries for snapping (all clip edges + playhead 0).
  const boundaries = useMemo(() => {
    const b = [0];
    for (const c of project.clips) {
      b.push(c.timelineStart, clipEnd(c));
    }
    return b;
  }, [project.clips]);

  const timeFromClientX = useCallback(
    (clientX: number): number => {
      const el = scrollRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left + el.scrollLeft;
      return Math.max(0, x / pxPerSecond);
    },
    [pxPerSecond],
  );

  const handleRulerSeek = useCallback(
    (clientX: number) => setCurrentTime(timeFromClientX(clientX)),
    [timeFromClientX, setCurrentTime],
  );

  const handleDropOnTrack = useCallback(
    (trackId: string, clientX: number, assetId: string) => {
      const asset = assetMap.get(assetId);
      if (!asset) return;
      let start = timeFromClientX(clientX);
      if (snapEnabled) start = snapTime(start, boundaries, 10 / pxPerSecond);
      addClipFromAsset(asset, trackId, start);
    },
    [assetMap, timeFromClientX, snapEnabled, boundaries, pxPerSecond, addClipFromAsset],
  );

  return (
    <div className="flex flex-col h-full bg-panel-sunken">
      <div className="flex flex-1 min-h-0">
        {/* Track headers */}
        <div className="w-40 shrink-0 border-r border-panel-border bg-panel">
          <div style={{ height: TIMELINE_RULER_HEIGHT }} className="border-b border-panel-border flex items-center px-2">
            <AddTrackMenu onAdd={addTrack} />
          </div>
          {tracks.video.map((t) => (
            <TrackHeader key={t.id} track={t} />
          ))}
          {tracks.audio.map((t) => (
            <TrackHeader key={t.id} track={t} />
          ))}
        </div>

        {/* Scrollable lane area */}
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-auto"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.lane) {
              clearSelection();
            }
          }}
        >
          <div style={{ width: timelineWidth, minWidth: '100%' }} className="relative">
            <TimelineRuler
              duration={duration}
              pxPerSecond={pxPerSecond}
              onSeek={handleRulerSeek}
              width={timelineWidth}
            />

            {tracks.video.map((t) => (
              <TrackRow
                key={t.id}
                track={t}
                pxPerSecond={pxPerSecond}
                onDropAsset={(clientX, assetId) => handleDropOnTrack(t.id, clientX, assetId)}
                boundaries={boundaries}
              />
            ))}
            {tracks.audio.map((t) => (
              <TrackRow
                key={t.id}
                track={t}
                pxPerSecond={pxPerSecond}
                onDropAsset={(clientX, assetId) => handleDropOnTrack(t.id, clientX, assetId)}
                boundaries={boundaries}
              />
            ))}

            <Playhead pxPerSecond={pxPerSecond} height={(tracks.video.length + tracks.audio.length) * TRACK_HEIGHT + TIMELINE_RULER_HEIGHT} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackHeader({ track }: { track: Track }) {
  const updateTrack = useProjectStore((s) => s.updateTrack);
  return (
    <div
      style={{ height: TRACK_HEIGHT }}
      className="border-b border-panel-border px-2 flex flex-col justify-center gap-1"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-300 truncate">{track.name}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className={`text-[10px] px-1.5 py-0.5 rounded ${track.muted ? 'bg-red-500/30 text-red-300' : 'bg-panel-raised text-gray-400'}`}
          onClick={() => updateTrack(track.id, { muted: !track.muted })}
          title="Mute track"
        >
          M
        </button>
        {track.kind === 'audio' && (
          <button
            className={`text-[10px] px-1.5 py-0.5 rounded ${track.solo ? 'bg-yellow-500/30 text-yellow-300' : 'bg-panel-raised text-gray-400'}`}
            onClick={() => updateTrack(track.id, { solo: !track.solo })}
            title="Solo track"
          >
            S
          </button>
        )}
      </div>
    </div>
  );
}

function AddTrackMenu({ onAdd }: { onAdd: (kind: Track['kind']) => void }) {
  return (
    <div className="flex gap-1">
      <button className="text-[10px] px-1.5 py-0.5 rounded bg-panel-raised text-gray-300 hover:bg-accent-muted" onClick={() => onAdd('video')}>
        +Video
      </button>
      <button className="text-[10px] px-1.5 py-0.5 rounded bg-panel-raised text-gray-300 hover:bg-accent-muted" onClick={() => onAdd('audio')}>
        +Audio
      </button>
    </div>
  );
}
