import { useEffect, useMemo, useRef } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { usePlaybackStore } from '../../stores/playbackStore';
import { useAssetMap, useTotalDuration, clipAtTime } from '../../hooks/useProjectSelectors';
import { clipEnd } from '@shared/utils/timeline';
import type { TimelineClip, TextLayer } from '@shared/types';

/**
 * Live preview of the timeline. The base video track is rendered with a single
 * <video> element that is pointed at whichever clip is active at the playhead,
 * seeked to the correct source time. Image/text overlays are composited with
 * absolutely-positioned DOM layers over the canvas. This gives a responsive
 * preview without invoking FFmpeg on every scrub (spec section 28).
 */
export function Preview() {
  const project = useProjectStore((s) => s.project);
  const assetMap = useAssetMap();
  const duration = useTotalDuration();

  const currentTime = usePlaybackStore((s) => s.currentTime);
  const playing = usePlaybackStore((s) => s.playing);
  const volume = usePlaybackStore((s) => s.volume);
  const muted = usePlaybackStore((s) => s.muted);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const pause = usePlaybackStore((s) => s.pause);
  const setDuration = usePlaybackStore((s) => s.setDuration);

  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  useEffect(() => setDuration(duration), [duration, setDuration]);

  const trackOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of project.tracks) m.set(t.id, t.order);
    return m;
  }, [project.tracks]);

  // Determine the active base video clip (and whether it's a video or image).
  const videoClips = useMemo(
    () =>
      project.clips.filter((c) => {
        const a = assetMap.get(c.assetId);
        return a && a.kind === 'video';
      }),
    [project.clips, assetMap],
  );

  const activeClip = useMemo(
    () => clipAtTime(videoClips, trackOrder, currentTime),
    [videoClips, trackOrder, currentTime],
  );

  // Active image overlays (top video tracks holding images) + text layers.
  const activeImages = useMemo(
    () =>
      project.clips
        .filter((c) => assetMap.get(c.assetId)?.kind === 'image')
        .filter((c) => currentTime >= c.timelineStart && currentTime < clipEnd(c)),
    [project.clips, assetMap, currentTime],
  );

  const activeTexts = useMemo(
    () =>
      project.textLayers.filter(
        (t) => currentTime >= t.timelineStart && currentTime < t.timelineStart + t.timelineDuration,
      ),
    [project.textLayers, currentTime],
  );

  // Keep the <video> element pointed at the active clip's source time.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    const asset = assetMap.get(activeClip.assetId);
    if (!asset) return;
    const src = window.editorApi.toMediaUrl(asset.path);
    if (video.src !== src) {
      video.src = src;
    }
    const sourceTime =
      activeClip.sourceStart + (currentTime - activeClip.timelineStart) * activeClip.speed;
    if (Math.abs(video.currentTime - sourceTime) > 0.25) {
      try {
        video.currentTime = sourceTime;
      } catch {
        /* seeking before metadata is loaded */
      }
    }
  }, [activeClip, currentTime, assetMap]);

  // Apply volume/mute to the element.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const clipVol = activeClip?.audio.muted ? 0 : activeClip?.audio.volume ?? 1;
    video.volume = Math.min(1, Math.max(0, volume * clipVol));
    video.muted = muted || !!activeClip?.audio.muted;
  }, [volume, muted, activeClip]);

  // Play/pause the clock.
  useEffect(() => {
    const video = videoRef.current;
    if (playing) {
      lastTickRef.current = performance.now();
      if (video && activeClip) video.play().catch(() => undefined);
      const tick = (now: number) => {
        const dt = (now - lastTickRef.current) / 1000;
        lastTickRef.current = now;
        const next = usePlaybackStore.getState().currentTime + dt;
        if (next >= duration) {
          setCurrentTime(duration);
          pause();
          return;
        }
        setCurrentTime(next);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      video?.pause();
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, activeClip]);

  const { canvas } = project;
  const aspect = canvas.width / canvas.height;

  return (
    <div className="flex-1 flex items-center justify-center bg-black/60 p-4 overflow-hidden">
      <div
        className="relative bg-black shadow-2xl rounded-md overflow-hidden"
        style={{
          aspectRatio: `${canvas.width} / ${canvas.height}`,
          maxHeight: '100%',
          maxWidth: '100%',
          width: aspect >= 1 ? '100%' : 'auto',
          height: aspect >= 1 ? 'auto' : '100%',
        }}
      >
        {/* Base video */}
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-contain bg-black"
          style={{ display: activeClip ? 'block' : 'none' }}
          playsInline
        />

        {!activeClip && activeImages.length === 0 && activeTexts.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
            {project.clips.length === 0 ? 'Drag media to the timeline to begin' : 'No clip at playhead'}
          </div>
        )}

        {/* Image overlays */}
        {activeImages.map((clip) => (
          <ImageOverlayView key={clip.id} clip={clip} assetPath={assetMap.get(clip.assetId)?.path ?? ''} />
        ))}

        {/* Text overlays */}
        {activeTexts.map((t) => (
          <TextOverlayView key={t.id} layer={t} />
        ))}
      </div>
    </div>
  );
}

function ImageOverlayView({ clip, assetPath }: { clip: TimelineClip; assetPath: string }) {
  const { transform } = clip;
  return (
    <img
      src={assetPath ? window.editorApi.toMediaUrl(assetPath) : undefined}
      alt=""
      className="absolute pointer-events-none"
      style={{
        left: `${transform.x * 100}%`,
        top: `${transform.y * 100}%`,
        transform: `translate(-50%, -50%) scale(${transform.scale}) rotate(${transform.rotation}deg)
          scaleX(${transform.flipHorizontal ? -1 : 1}) scaleY(${transform.flipVertical ? -1 : 1})`,
        opacity: transform.opacity,
        maxWidth: '60%',
        maxHeight: '60%',
      }}
    />
  );
}

function TextOverlayView({ layer }: { layer: TextLayer }) {
  return (
    <div
      className="absolute pointer-events-none whitespace-pre"
      style={{
        left: `${layer.x * 100}%`,
        top: `${layer.y * 100}%`,
        transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
        color: layer.color,
        fontSize: `clamp(10px, ${layer.fontSize / 10}vw, ${layer.fontSize}px)`,
        fontWeight: layer.fontWeight,
        fontFamily: layer.fontFamily,
        textAlign: layer.alignment,
        opacity: layer.opacity,
        background: layer.backgroundColor ?? 'transparent',
        padding: layer.backgroundColor ? '0.1em 0.3em' : 0,
        borderRadius: 4,
      }}
    >
      {layer.text}
    </div>
  );
}
