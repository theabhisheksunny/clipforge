import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { SPEED_PRESETS } from '@shared/constants';
import type { TimelineClip } from '@shared/types';

/** Clip properties inspector (spec section 35). Updates clip state in real time. */
export function Inspector() {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const clip = useProjectStore((s) => s.project.clips.find((c) => c.id === selectedClipId) ?? null);
  const asset = useProjectStore((s) =>
    clip ? s.project.mediaAssets.find((a) => a.id === clip.assetId) ?? null : null,
  );
  const updateClip = useProjectStore((s) => s.updateClip);
  const setClipSpeed = useProjectStore((s) => s.setClipSpeed);

  if (!clip) {
    return (
      <div className="p-4 text-sm text-gray-500 text-center mt-8">
        Select a clip to edit its properties.
      </div>
    );
  }

  const isAudioOnly = asset?.kind === 'audio';

  const patchTransform = (patch: Partial<TimelineClip['transform']>) =>
    updateClip(clip.id, { transform: { ...clip.transform, ...patch } });
  const patchAudio = (patch: Partial<TimelineClip['audio']>) =>
    updateClip(clip.id, { audio: { ...clip.audio, ...patch } });
  const patchCrop = (patch: Partial<TimelineClip['crop']>) =>
    updateClip(clip.id, { crop: { ...clip.crop, ...patch } });

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Clip</div>
        <div className="text-gray-200 truncate">{asset?.name}</div>
      </div>

      {!isAudioOnly && (
        <>
          <Section title="Transform">
            <Row label="Position X">
              <Slider min={0} max={1} step={0.01} value={clip.transform.x} onChange={(v) => patchTransform({ x: v })} />
            </Row>
            <Row label="Position Y">
              <Slider min={0} max={1} step={0.01} value={clip.transform.y} onChange={(v) => patchTransform({ y: v })} />
            </Row>
            <Row label="Scale">
              <Slider min={0.1} max={3} step={0.01} value={clip.transform.scale} onChange={(v) => patchTransform({ scale: v })} suffix={`${Math.round(clip.transform.scale * 100)}%`} />
            </Row>
            <Row label="Rotation">
              <Slider min={-180} max={180} step={1} value={clip.transform.rotation} onChange={(v) => patchTransform({ rotation: v })} suffix={`${clip.transform.rotation}°`} />
            </Row>
            <Row label="Opacity">
              <Slider min={0} max={1} step={0.01} value={clip.transform.opacity} onChange={(v) => patchTransform({ opacity: v })} suffix={`${Math.round(clip.transform.opacity * 100)}%`} />
            </Row>
            <div className="flex gap-2 mt-1">
              <Toggle label="Flip H" active={clip.transform.flipHorizontal} onClick={() => patchTransform({ flipHorizontal: !clip.transform.flipHorizontal })} />
              <Toggle label="Flip V" active={clip.transform.flipVertical} onClick={() => patchTransform({ flipVertical: !clip.transform.flipVertical })} />
            </div>
          </Section>

          <Section title="Crop">
            <Row label="Top"><Slider min={0} max={0.5} step={0.01} value={clip.crop.top} onChange={(v) => patchCrop({ top: v })} /></Row>
            <Row label="Bottom"><Slider min={0} max={0.5} step={0.01} value={clip.crop.bottom} onChange={(v) => patchCrop({ bottom: v })} /></Row>
            <Row label="Left"><Slider min={0} max={0.5} step={0.01} value={clip.crop.left} onChange={(v) => patchCrop({ left: v })} /></Row>
            <Row label="Right"><Slider min={0} max={0.5} step={0.01} value={clip.crop.right} onChange={(v) => patchCrop({ right: v })} /></Row>
          </Section>
        </>
      )}

      <Section title="Speed">
        <div className="flex flex-wrap gap-1">
          {SPEED_PRESETS.map((s) => (
            <button
              key={s}
              className={`text-xs px-2 py-1 rounded ${clip.speed === s ? 'bg-accent text-white' : 'bg-panel-raised text-gray-300'}`}
              onClick={() => setClipSpeed(clip.id, s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </Section>

      {asset?.kind !== 'image' && (
        <Section title="Audio">
          <Row label="Volume">
            <Slider min={0} max={2} step={0.01} value={clip.audio.volume} onChange={(v) => patchAudio({ volume: v })} suffix={`${Math.round(clip.audio.volume * 100)}%`} />
          </Row>
          <Toggle label={clip.audio.muted ? 'Muted' : 'Mute'} active={clip.audio.muted} onClick={() => patchAudio({ muted: !clip.audio.muted })} />
          <Row label="Fade In">
            <Slider min={0} max={5} step={0.1} value={clip.audio.fadeInSeconds} onChange={(v) => patchAudio({ fadeInSeconds: v })} suffix={`${clip.audio.fadeInSeconds.toFixed(1)}s`} />
          </Row>
          <Row label="Fade Out">
            <Slider min={0} max={5} step={0.1} value={clip.audio.fadeOutSeconds} onChange={(v) => patchAudio({ fadeOutSeconds: v })} suffix={`${clip.audio.fadeOutSeconds.toFixed(1)}s`} />
          </Row>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs uppercase tracking-wide text-gray-500">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-gray-400">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Slider({
  min,
  max,
  step,
  value,
  onChange,
  suffix,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1" />
      {suffix && <span className="w-10 text-right text-[11px] text-gray-400 font-mono">{suffix}</span>}
    </div>
  );
}

function Toggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`text-xs px-2 py-1 rounded ${active ? 'bg-accent text-white' : 'bg-panel-raised text-gray-300'}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
