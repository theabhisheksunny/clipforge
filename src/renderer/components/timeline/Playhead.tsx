import { usePlaybackStore } from '../../stores/playbackStore';

export function Playhead({ pxPerSecond, height }: { pxPerSecond: number; height: number }) {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const left = currentTime * pxPerSecond;
  return (
    <div className="absolute top-0 z-30 pointer-events-none" style={{ left, height }}>
      <div className="w-px h-full bg-accent" />
      <div className="absolute -top-0 -left-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-accent" />
    </div>
  );
}
