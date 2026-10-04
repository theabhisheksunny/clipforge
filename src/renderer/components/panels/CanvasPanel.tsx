import { useProjectStore } from '../../stores/projectStore';
import { ASPECT_PRESETS, SOCIAL_PRESETS } from '@shared/constants';
import type { AspectRatioPreset, FitMode } from '@shared/types';

/**
 * Canvas settings: aspect-ratio presets, social-media presets, fit mode, and
 * custom dimensions (spec sections 9, 10, 38, 40). Every control writes to the
 * project canvas, which drives both the preview framing and the export size.
 */
export function CanvasPanel() {
  const canvas = useProjectStore((s) => s.project.canvas);
  const updateCanvas = useProjectStore((s) => s.updateCanvas);

  const setPreset = (ratio: Exclude<AspectRatioPreset, 'custom'>) => {
    const dims = ASPECT_PRESETS[ratio];
    updateCanvas({ aspectRatio: ratio, width: dims.width, height: dims.height });
  };

  const fitModes: { id: FitMode; label: string; hint: string }[] = [
    { id: 'fit', label: 'Fit', hint: 'Whole source visible (letterbox)' },
    { id: 'fill', label: 'Fill', hint: 'Cover canvas (crops overflow)' },
    { id: 'stretch', label: 'Stretch', hint: 'Distort to fill (may look squished)' },
  ];

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4 text-sm">
      <section className="space-y-1.5">
        <div className="text-xs uppercase tracking-wide text-gray-500">Aspect Ratio</div>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(ASPECT_PRESETS) as Exclude<AspectRatioPreset, 'custom'>[]).map((r) => (
            <button
              key={r}
              onClick={() => setPreset(r)}
              className={`py-2 rounded text-xs font-medium ${
                canvas.aspectRatio === r
                  ? 'bg-accent text-white'
                  : 'bg-panel-raised text-gray-300 hover:bg-panel-border'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="text-xs uppercase tracking-wide text-gray-500">Social Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {SOCIAL_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => updateCanvas({ aspectRatio: p.aspectRatio, width: p.width, height: p.height })}
              className={`py-1.5 px-2 rounded text-[11px] text-left ${
                canvas.width === p.width && canvas.height === p.height
                  ? 'bg-accent-muted text-accent-hover'
                  : 'bg-panel-raised text-gray-300 hover:bg-panel-border'
              }`}
            >
              <div className="font-medium">{p.label}</div>
              <div className="text-gray-500">{p.width}×{p.height}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="text-xs uppercase tracking-wide text-gray-500">Fit Mode</div>
        <div className="space-y-1">
          {fitModes.map((m) => (
            <button
              key={m.id}
              onClick={() => updateCanvas({ fitMode: m.id })}
              className={`w-full text-left px-2 py-1.5 rounded ${
                canvas.fitMode === m.id
                  ? 'bg-accent text-white'
                  : 'bg-panel-raised text-gray-300 hover:bg-panel-border'
              }`}
            >
              <div className="text-xs font-medium">{m.label}</div>
              <div className={`text-[10px] ${canvas.fitMode === m.id ? 'text-white/80' : 'text-gray-500'}`}>
                {m.hint}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="text-xs uppercase tracking-wide text-gray-500">Custom Dimensions</div>
        <div className="flex items-center gap-2">
          <label className="flex-1 text-[11px] text-gray-400">
            Width
            <input
              type="number"
              min={16}
              max={7680}
              value={canvas.width}
              onChange={(e) => updateCanvas({ width: Math.max(16, Number(e.target.value) || 16), aspectRatio: 'custom' })}
              className="w-full bg-panel-sunken border border-panel-border rounded px-2 py-1 text-sm mt-0.5"
            />
          </label>
          <label className="flex-1 text-[11px] text-gray-400">
            Height
            <input
              type="number"
              min={16}
              max={7680}
              value={canvas.height}
              onChange={(e) => updateCanvas({ height: Math.max(16, Number(e.target.value) || 16), aspectRatio: 'custom' })}
              className="w-full bg-panel-sunken border border-panel-border rounded px-2 py-1 text-sm mt-0.5"
            />
          </label>
        </div>
        <div className="text-[11px] text-gray-500">
          Current: {canvas.width}×{canvas.height} ({canvas.fps} fps)
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="text-xs uppercase tracking-wide text-gray-500">Frame Rate</div>
        <select
          value={canvas.fps}
          onChange={(e) => updateCanvas({ fps: Number(e.target.value) })}
          className="w-full bg-panel-sunken border border-panel-border rounded px-2 py-1 text-sm"
        >
          {[24, 25, 30, 50, 60].map((f) => (
            <option key={f} value={f}>{f} fps</option>
          ))}
        </select>
      </section>
    </div>
  );
}
