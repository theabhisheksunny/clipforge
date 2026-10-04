import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { createId } from '@shared/utils/factories';
import { DEFAULT_TRANSITION_DURATION } from '@shared/constants';
import { clipEnd } from '@shared/utils/timeline';
import type { Transition, TransitionKind } from '@shared/types';

const KINDS: { kind: TransitionKind; label: string }[] = [
  { kind: 'fade', label: 'Fade' },
  { kind: 'crossdissolve', label: 'Cross Dissolve' },
  { kind: 'slide', label: 'Slide' },
  { kind: 'zoom', label: 'Zoom' },
  { kind: 'wipe', label: 'Wipe' },
];

/**
 * Add transitions between the selected clip and the next clip on its track
 * (spec section 18). Transitions are stored separately and applied at export.
 */
export function TransitionsPanel() {
  const clips = useProjectStore((s) => s.project.clips);
  const transitions = useProjectStore((s) => s.project.transitions);
  const addTransition = useProjectStore((s) => s.addTransition);
  const removeTransition = useProjectStore((s) => s.removeTransition);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);

  const selected = clips.find((c) => c.id === selectedClipId);
  const next = selected
    ? clips
        .filter((c) => c.trackId === selected.trackId && c.timelineStart >= clipEnd(selected) - 0.001)
        .sort((a, b) => a.timelineStart - b.timelineStart)[0]
    : undefined;

  const handleAdd = (kind: TransitionKind) => {
    if (!selected || !next) return;
    const transition: Transition = {
      id: createId(),
      kind,
      fromClipId: selected.id,
      toClipId: next.id,
      durationSeconds: DEFAULT_TRANSITION_DURATION,
    };
    addTransition(transition);
  };

  return (
    <div className="flex flex-col h-full p-2 space-y-3">
      <div className="text-sm text-gray-400">
        {selected && next
          ? 'Add a transition between the selected clip and the next clip.'
          : 'Select a clip that has a following clip on the same track.'}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            disabled={!selected || !next}
            onClick={() => handleAdd(k.kind)}
            className="panel bg-panel-raised p-3 text-sm text-gray-200 hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {k.label}
          </button>
        ))}
      </div>

      {transitions.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-panel-border">
          <div className="text-xs uppercase text-gray-500">Active Transitions</div>
          {transitions.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-xs bg-panel-raised rounded px-2 py-1">
              <span className="text-gray-300 capitalize">{t.kind} · {t.durationSeconds}s</span>
              <button className="text-red-400 hover:underline" onClick={() => removeTransition(t.id)}>
                remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
