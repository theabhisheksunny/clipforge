import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { usePlaybackStore } from '../../stores/playbackStore';
import { createId } from '@shared/utils/factories';
import { DEFAULT_TEXT_DURATION } from '@shared/constants';
import type { TextLayer } from '@shared/types';
import { PlusIcon, TrashIcon } from '../Icons';

/** Add and manage text overlays (spec section 17). */
export function TextPanel() {
  const textLayers = useProjectStore((s) => s.project.textLayers);
  const tracks = useProjectStore((s) => s.project.tracks);
  const addTextLayer = useProjectStore((s) => s.addTextLayer);
  const updateTextLayer = useProjectStore((s) => s.updateTextLayer);
  const removeTextLayer = useProjectStore((s) => s.removeTextLayer);
  const addTrack = useProjectStore((s) => s.addTrack);
  const selectText = useEditorStore((s) => s.selectText);
  const currentTime = usePlaybackStore((s) => s.currentTime);

  const handleAdd = () => {
    // Text layers live on a video track (they overlay video).
    let track = tracks.find((t) => t.kind === 'video');
    const trackId = track ? track.id : addTrack('video');
    const layer: TextLayer = {
      id: createId(),
      trackId,
      text: 'New Text',
      timelineStart: currentTime,
      timelineDuration: DEFAULT_TEXT_DURATION,
      fontFamily: 'Inter',
      fontSize: 64,
      fontWeight: 700,
      color: '#ffffff',
      alignment: 'center',
      opacity: 1,
      backgroundColor: null,
      x: 0.5,
      y: 0.5,
      rotation: 0,
    };
    addTextLayer(layer);
    selectText(layer.id);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-panel-border">
        <button className="btn-primary w-full" onClick={handleAdd}>
          <PlusIcon width={16} height={16} /> Add Text
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {textLayers.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8 px-4">
            No text layers yet. Click Add Text to create a title or caption.
          </div>
        )}
        {textLayers.map((t) => (
          <div key={t.id} className="panel bg-panel-raised p-2 space-y-2">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 bg-panel-sunken border border-panel-border rounded px-2 py-1 text-sm outline-none focus:border-accent"
                value={t.text}
                onChange={(e) => updateTextLayer(t.id, { text: e.target.value })}
              />
              <button className="icon-btn h-7 w-7" onClick={() => removeTextLayer(t.id)}>
                <TrashIcon width={14} height={14} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-gray-400 flex items-center gap-1">
                Size
                <input
                  type="number"
                  className="w-full bg-panel-sunken border border-panel-border rounded px-1 py-0.5 text-xs"
                  value={t.fontSize}
                  onChange={(e) => updateTextLayer(t.id, { fontSize: Number(e.target.value) })}
                />
              </label>
              <label className="text-[11px] text-gray-400 flex items-center gap-1">
                Color
                <input
                  type="color"
                  className="w-full h-6 bg-transparent"
                  value={t.color}
                  onChange={(e) => updateTextLayer(t.id, { color: e.target.value })}
                />
              </label>
              <label className="text-[11px] text-gray-400 flex items-center gap-1">
                Weight
                <select
                  className="w-full bg-panel-sunken border border-panel-border rounded px-1 py-0.5 text-xs"
                  value={t.fontWeight}
                  onChange={(e) => updateTextLayer(t.id, { fontWeight: Number(e.target.value) })}
                >
                  <option value={400}>Regular</option>
                  <option value={600}>Semibold</option>
                  <option value={700}>Bold</option>
                  <option value={900}>Black</option>
                </select>
              </label>
              <label className="text-[11px] text-gray-400 flex items-center gap-1">
                Align
                <select
                  className="w-full bg-panel-sunken border border-panel-border rounded px-1 py-0.5 text-xs"
                  value={t.alignment}
                  onChange={(e) => updateTextLayer(t.id, { alignment: e.target.value as TextLayer['alignment'] })}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </div>
            <label className="text-[11px] text-gray-400 flex items-center gap-2">
              Duration
              <input
                type="number"
                min={0.5}
                step={0.5}
                className="w-16 bg-panel-sunken border border-panel-border rounded px-1 py-0.5 text-xs"
                value={t.timelineDuration}
                onChange={(e) => updateTextLayer(t.id, { timelineDuration: Number(e.target.value) })}
              />
              s
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
