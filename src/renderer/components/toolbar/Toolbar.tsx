import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { usePlaybackStore } from '../../stores/playbackStore';
import {
  ImportIcon,
  ExportIcon,
  UndoIcon,
  RedoIcon,
  SplitIcon,
  TrashIcon,
  DuplicateIcon,
  SettingsIcon,
} from '../Icons';
import { ALL_MEDIA_EXTENSIONS } from '@shared/types';
import { APP_NAME } from '@shared/constants';

export function Toolbar({
  onExport,
  onOpenDiagnostics,
}: {
  onExport: () => void;
  onOpenDiagnostics: () => void;
}) {
  const projectName = useProjectStore((s) => s.project.projectName);
  const dirty = useProjectStore((s) => s.dirty);
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const addAssets = useProjectStore((s) => s.addAssets);
  const splitClipAt = useProjectStore((s) => s.splitClipAt);
  const duplicateClip = useProjectStore((s) => s.duplicateClip);
  const removeClip = useProjectStore((s) => s.removeClip);

  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const currentTime = usePlaybackStore((s) => s.currentTime);

  const handleImport = async () => {
    const res = await window.editorApi.openFilesDialog([
      { name: 'Media Files', extensions: [...ALL_MEDIA_EXTENSIONS] },
    ]);
    if (!res.cancelled && res.paths.length) {
      const imported = await window.editorApi.importMediaPaths(res.paths);
      addAssets(imported);
    }
  };

  return (
    <div className="h-12 shrink-0 flex items-center gap-1 px-3 border-b border-panel-border bg-panel">
      <div className="flex items-center gap-2 mr-3">
        <span className="font-semibold text-sm text-gray-100">{APP_NAME}</span>
        <span className="text-xs text-gray-500">
          {projectName}
          {dirty ? ' •' : ''}
        </span>
      </div>

      <div className="h-5 w-px bg-panel-border mx-1" />

      <button className="btn-ghost" onClick={handleImport} title="Import media (Ctrl+I)">
        <ImportIcon width={16} height={16} /> Import
      </button>

      <div className="h-5 w-px bg-panel-border mx-1" />

      <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
        <UndoIcon />
      </button>
      <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
        <RedoIcon />
      </button>

      <div className="h-5 w-px bg-panel-border mx-1" />

      <button
        className="icon-btn"
        disabled={!selectedClipId}
        onClick={() => selectedClipId && splitClipAt(selectedClipId, currentTime)}
        title="Split at playhead (S)"
      >
        <SplitIcon />
      </button>
      <button
        className="icon-btn"
        disabled={!selectedClipId}
        onClick={() => selectedClipId && duplicateClip(selectedClipId)}
        title="Duplicate (Ctrl+D)"
      >
        <DuplicateIcon />
      </button>
      <button
        className="icon-btn"
        disabled={!selectedClipId}
        onClick={() => selectedClipId && removeClip(selectedClipId)}
        title="Delete (Del)"
      >
        <TrashIcon />
      </button>

      <div className="flex-1" />

      <button className="icon-btn" onClick={onOpenDiagnostics} title="Diagnostics">
        <SettingsIcon width={16} height={16} />
      </button>

      <button className="btn-primary" onClick={onExport} title="Export (Ctrl+E)">
        <ExportIcon width={16} height={16} /> Export
      </button>
    </div>
  );
}
