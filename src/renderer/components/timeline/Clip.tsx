import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { TRACK_HEIGHT } from '@shared/constants';
import { trimStart, trimEnd, snapTime } from '@shared/utils/timeline';
import { MuteIcon } from '../Icons';
import { useClipContextMenu } from './useClipContextMenu';
import type { MediaAsset, TimelineClip, TrackKind } from '@shared/types';

const kindBg: Record<string, string> = {
  video: 'bg-gradient-to-b from-blue-600/70 to-blue-700/70 border-blue-400/50',
  audio: 'bg-gradient-to-b from-emerald-600/70 to-emerald-700/70 border-emerald-400/50',
  image: 'bg-gradient-to-b from-purple-600/70 to-purple-700/70 border-purple-400/50',
};

type DragMode = 'move' | 'trim-start' | 'trim-end' | null;

export function Clip({
  clip,
  asset,
  pxPerSecond,
  trackKind,
  boundaries,
}: {
  clip: TimelineClip;
  asset: MediaAsset;
  pxPerSecond: number;
  trackKind: TrackKind;
  boundaries: number[];
}) {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectClip = useEditorStore((s) => s.selectClip);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const updateClip = useProjectStore((s) => s.updateClip);
  const moveClip = useProjectStore((s) => s.moveClip);

  const openMenu = useClipContextMenu(clip.id);

  const selected = selectedClipId === clip.id;
  const dragRef = useRef<{ mode: DragMode; startX: number; orig: TimelineClip } | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<number[] | null>(null);

  const kindStyle = asset.kind === 'image' ? kindBg.image : trackKind === 'audio' ? kindBg.audio : kindBg.video;
  const left = clip.timelineStart * pxPerSecond;
  const width = Math.max(8, clip.timelineDuration * pxPerSecond);

  // Load thumbnail (video/image) or waveform (audio) lazily.
  useEffect(() => {
    let active = true;
    if (asset.kind === 'audio') {
      window.editorApi.getWaveform(asset.id, asset.path).then((w) => {
        if (active && w) setWaveform(w.peaks);
      });
    } else if (!asset.missing) {
      window.editorApi.getThumbnail(asset.id, asset.path, clip.sourceStart + 0.1).then((t) => {
        if (active && t) setThumb(t);
      });
    }
    return () => {
      active = false;
    };
  }, [asset.id, asset.path, asset.kind, asset.missing, clip.sourceStart]);

  const startDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    selectClip(clip.id);
    dragRef.current = { mode, startX: e.clientX, orig: { ...clip } };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaSeconds = (ev.clientX - d.startX) / pxPerSecond;
      const snap = (t: number) => (snapEnabled ? snapTime(t, boundaries, 10 / pxPerSecond) : t);

      if (d.mode === 'move') {
        let newStart = Math.max(0, d.orig.timelineStart + deltaSeconds);
        newStart = snap(newStart);
        moveClip(clip.id, clip.trackId, newStart);
      } else if (d.mode === 'trim-start') {
        const updated = trimStart(d.orig, deltaSeconds);
        updateClip(clip.id, {
          timelineStart: updated.timelineStart,
          timelineDuration: updated.timelineDuration,
          sourceStart: updated.sourceStart,
        });
      } else if (d.mode === 'trim-end') {
        const sourceLimit = asset.kind === 'image' ? Number.MAX_SAFE_INTEGER : asset.metadata.duration;
        const updated = trimEnd(d.orig, -deltaSeconds, sourceLimit);
        updateClip(clip.id, {
          timelineDuration: updated.timelineDuration,
          sourceEnd: updated.sourceEnd,
        });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={`absolute top-1 rounded-md border overflow-hidden cursor-grab active:cursor-grabbing
        ${kindStyle} ${selected ? 'ring-2 ring-white' : ''}`}
      style={{ left, width, height: TRACK_HEIGHT - 8 }}
      onPointerDown={startDrag('move')}
      onContextMenu={(e) => {
        e.preventDefault();
        selectClip(clip.id);
        openMenu(e.clientX, e.clientY);
      }}
      title={asset.name}
    >
      {/* Thumbnail strip for video/image */}
      {thumb && asset.kind !== 'audio' && (
        <div
          className="absolute inset-0 opacity-40 bg-repeat-x"
          style={{ backgroundImage: `url(${thumb})`, backgroundSize: 'auto 100%' }}
        />
      )}

      {/* Waveform for audio */}
      {waveform && asset.kind === 'audio' && (
        <Waveform peaks={waveform} width={width} height={TRACK_HEIGHT - 8} />
      )}

      <div className="relative px-2 py-1 flex items-center gap-1 h-full pointer-events-none">
        {clip.audio.muted && <MuteIcon width={12} height={12} className="text-red-200 shrink-0" />}
        <span className="text-[11px] font-medium text-white truncate drop-shadow">{asset.name}</span>
      </div>

      {/* Trim handles */}
      <div
        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize hover:bg-white/30"
        onPointerDown={startDrag('trim-start')}
      />
      <div
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize hover:bg-white/30"
        onPointerDown={startDrag('trim-end')}
      />

      {clip.speed !== 1 && (
        <span className="absolute bottom-0.5 right-1 text-[9px] bg-black/50 px-1 rounded text-white pointer-events-none">
          {clip.speed}x
        </span>
      )}
    </div>
  );
}

function Waveform({ peaks, width, height }: { peaks: number[]; width: number; height: number }) {
  const mid = height / 2;
  const step = Math.max(1, Math.floor(peaks.length / Math.max(1, Math.floor(width / 2))));
  const pts: string[] = [];
  for (let i = 0; i < peaks.length; i += step) {
    const x = (i / peaks.length) * width;
    const h = peaks[i] * mid;
    pts.push(`${x.toFixed(1)},${(mid - h).toFixed(1)} ${x.toFixed(1)},${(mid + h).toFixed(1)}`);
  }
  return (
    <svg className="absolute inset-0 opacity-50 pointer-events-none" width={width} height={height}>
      <polyline points={pts.join(' ')} stroke="white" strokeWidth="1" fill="none" />
    </svg>
  );
}
