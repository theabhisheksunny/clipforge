import { usePlaybackStore } from '../../stores/playbackStore';
import { useEditorStore } from '../../stores/editorStore';
import { useTotalDuration } from '../../hooks/useProjectSelectors';
import {
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipFwdIcon,
  ZoomInIcon,
  ZoomOutIcon,
  VolumeIcon,
  MuteIcon,
} from '../Icons';
import { formatTime } from '../../utils/format';

export function TransportBar() {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const playing = usePlaybackStore((s) => s.playing);
  const togglePlay = usePlaybackStore((s) => s.togglePlay);
  const seekBy = usePlaybackStore((s) => s.seekBy);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const volume = usePlaybackStore((s) => s.volume);
  const muted = usePlaybackStore((s) => s.muted);
  const setVolume = usePlaybackStore((s) => s.setVolume);
  const toggleMute = usePlaybackStore((s) => s.toggleMute);

  const zoomIn = useEditorStore((s) => s.zoomIn);
  const zoomOut = useEditorStore((s) => s.zoomOut);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);

  const duration = useTotalDuration();
  const frame = 1 / 30;

  return (
    <div className="h-11 shrink-0 flex items-center gap-3 px-3 border-t border-panel-border bg-panel">
      <div className="flex items-center gap-1">
        <button className="icon-btn" onClick={() => setCurrentTime(0)} title="Go to start">
          <SkipBackIcon />
        </button>
        <button className="icon-btn" onClick={() => seekBy(-frame)} title="Previous frame (←)">
          <span className="text-xs">◂</span>
        </button>
        <button className="btn-primary h-8 w-8 p-0" onClick={togglePlay} title="Play/Pause (Space)">
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="icon-btn" onClick={() => seekBy(frame)} title="Next frame (→)">
          <span className="text-xs">▸</span>
        </button>
        <button className="icon-btn" onClick={() => setCurrentTime(duration)} title="Go to end">
          <SkipFwdIcon />
        </button>
      </div>

      <div className="font-mono text-sm text-gray-200">
        {formatTime(currentTime)}
        <span className="text-gray-500"> / {formatTime(duration)}</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <button className="icon-btn" onClick={toggleMute} title="Mute">
          {muted ? <MuteIcon width={16} height={16} /> : <VolumeIcon width={16} height={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="w-20"
        />
      </div>

      <div className="h-5 w-px bg-panel-border" />

      <button
        className={`text-xs px-2 py-1 rounded ${snapEnabled ? 'bg-accent-muted text-accent-hover' : 'text-gray-400 hover:bg-panel-raised'}`}
        onClick={toggleSnap}
        title="Toggle snapping"
      >
        Snap
      </button>
      <button className="icon-btn" onClick={zoomOut} title="Zoom out">
        <ZoomOutIcon />
      </button>
      <button className="icon-btn" onClick={zoomIn} title="Zoom in">
        <ZoomInIcon />
      </button>
    </div>
  );
}
