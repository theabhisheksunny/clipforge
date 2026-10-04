import { useMemo } from 'react';
import { TIMELINE_RULER_HEIGHT } from '@shared/constants';
import { formatTime } from '../../utils/format';

/** Time ruler with adaptive tick spacing. Click/drag to seek. */
export function TimelineRuler({
  duration,
  pxPerSecond,
  onSeek,
  width,
}: {
  duration: number;
  pxPerSecond: number;
  onSeek: (clientX: number) => void;
  width: number;
}) {
  const step = useMemo(() => niceStep(pxPerSecond), [pxPerSecond]);
  const ticks = useMemo(() => {
    const total = Math.max(duration + 20, 30);
    const arr: number[] = [];
    for (let t = 0; t <= total; t += step) arr.push(t);
    return arr;
  }, [duration, step]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    onSeek(e.clientX);
    const move = (ev: PointerEvent) => onSeek(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className="sticky top-0 z-20 bg-panel border-b border-panel-border cursor-pointer select-none"
      style={{ height: TIMELINE_RULER_HEIGHT, width }}
      onPointerDown={onPointerDown}
      data-lane="ruler"
    >
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 h-full" style={{ left: t * pxPerSecond }}>
          <div className="w-px h-2 bg-gray-600 absolute bottom-0" />
          <span className="absolute bottom-2.5 left-1 text-[10px] text-gray-500 font-mono">
            {formatTime(t, false)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Choose a tick step (seconds) so labels stay ~60px apart. */
function niceStep(pxPerSecond: number): number {
  const targetPx = 70;
  const rawSeconds = targetPx / pxPerSecond;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const s of steps) if (s >= rawSeconds) return s;
  return 900;
}
