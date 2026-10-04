import { useEffect, useState } from 'react';
import { Toolbar } from './components/toolbar/Toolbar';
import { TransportBar } from './components/toolbar/TransportBar';
import { LeftPanel } from './components/panels/LeftPanel';
import { Preview } from './components/preview/Preview';
import { Timeline } from './components/timeline/Timeline';
import { Inspector } from './components/inspector/Inspector';
import { ExportDialog } from './components/dialogs/ExportDialog';
import { DiagnosticsDialog } from './components/dialogs/DiagnosticsDialog';
import { ContextMenuRoot } from './components/ContextMenu';
import { FfmpegBanner } from './components/FfmpegBanner';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useProjectStore } from './stores/projectStore';
import { PROJECT_FILE_EXTENSION } from '@shared/types';

export function App() {
  const [showExport, setShowExport] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  useKeyboardShortcuts();

  const project = useProjectStore((s) => s.project);
  const savedPath = useProjectStore((s) => s.savedPath);
  const dirty = useProjectStore((s) => s.dirty);
  const markSaved = useProjectStore((s) => s.markSaved);
  const setProject = useProjectStore((s) => s.setProject);
  const newProject = useProjectStore((s) => s.newProject);

  // Save handling (menu + Ctrl+S).
  useEffect(() => {
    const save = async () => {
      if (savedPath) {
        await window.editorApi.saveProject(project, savedPath);
        markSaved(savedPath);
      } else {
        const res = await window.editorApi.saveProjectAs(project);
        if (!res.cancelled && res.path) markSaved(res.path);
      }
    };
    const saveAs = async () => {
      const res = await window.editorApi.saveProjectAs(project);
      if (!res.cancelled && res.path) markSaved(res.path);
    };
    const open = async () => {
      const file = await window.editorApi.openProject();
      if (file) setProject(file.project, file.savedPath ?? null);
    };
    const onSave = () => void save();
    const onSaveAs = () => void saveAs();
    const onOpen = () => void open();
    const onNew = () => newProject();
    const onExport = () => setShowExport(true);
    const onImport = async () => {
      const res = await window.editorApi.openFilesDialog();
      if (!res.cancelled && res.paths.length) {
        const imported = await window.editorApi.importMediaPaths(res.paths);
        useProjectStore.getState().addAssets(imported);
      }
    };

    window.addEventListener('app:save', onSave);
    window.addEventListener('app:saveas', onSaveAs);
    window.addEventListener('app:open', onOpen);
    window.addEventListener('app:new', onNew);
    window.addEventListener('app:export', onExport);
    window.addEventListener('app:import', onImport);

    // Native menu actions from the main process.
    const unsubMenu = window.editorApi.onMenuAction((action) => {
      switch (action) {
        case 'new': onNew(); break;
        case 'open': onOpen(); break;
        case 'save': onSave(); break;
        case 'saveas': onSaveAs(); break;
        case 'import': onImport(); break;
        case 'export': onExport(); break;
        case 'undo': useProjectStore.getState().undo(); break;
        case 'redo': useProjectStore.getState().redo(); break;
        case 'shortcuts': setShowShortcuts(true); break;
      }
    });

    return () => {
      window.removeEventListener('app:save', onSave);
      window.removeEventListener('app:saveas', onSaveAs);
      window.removeEventListener('app:open', onOpen);
      window.removeEventListener('app:new', onNew);
      window.removeEventListener('app:export', onExport);
      window.removeEventListener('app:import', onImport);
      unsubMenu();
    };
  }, [project, savedPath, markSaved, setProject, newProject]);

  // Autosave every 30s when dirty (spec section 30).
  useEffect(() => {
    const interval = setInterval(() => {
      if (useProjectStore.getState().dirty) {
        window.editorApi.autosaveProject(useProjectStore.getState().project);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Recovery prompt on first load.
  useEffect(() => {
    (async () => {
      const recovered = await window.editorApi.recoverProject();
      if (recovered && recovered.project.clips.length > 0) {
        const ok = window.confirm('Recovered an unsaved project from your last session. Recover it?');
        if (ok) setProject(recovered.project, recovered.savedPath ?? null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warn on unsaved close.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  return (
    <div className="flex flex-col h-screen bg-panel-sunken text-gray-200">
      <Toolbar onExport={() => setShowExport(true)} onOpenDiagnostics={() => setShowDiagnostics(true)} />
      <FfmpegBanner />

      {/* Upper area: left panel | preview | inspector */}
      <div className="flex min-h-0" style={{ height: '52%' }}>
        <aside className="w-72 shrink-0 border-r border-panel-border bg-panel overflow-hidden">
          <LeftPanel />
        </aside>
        <main className="flex-1 flex flex-col min-w-0">
          <Preview />
        </main>
        <aside className="w-72 shrink-0 border-l border-panel-border bg-panel overflow-hidden">
          <Inspector />
        </aside>
      </div>

      {/* Lower area: timeline */}
      <div className="flex-1 min-h-0 border-t border-panel-border">
        <Timeline />
      </div>

      <TransportBar />

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showDiagnostics && <DiagnosticsDialog onClose={() => setShowDiagnostics(false)} />}
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
      <ContextMenuRoot />
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / Pause'],
  ['S', 'Split selected clip at playhead'],
  ['Delete / Backspace', 'Delete selected clip'],
  ['Ctrl + Z', 'Undo'],
  ['Ctrl + Shift + Z', 'Redo'],
  ['Ctrl + C', 'Copy clip'],
  ['Ctrl + V', 'Paste clip'],
  ['Ctrl + D', 'Duplicate clip'],
  ['Ctrl + S', 'Save project'],
  ['Ctrl + I', 'Import media'],
  ['Ctrl + E', 'Export'],
  ['← / →', 'Move playhead 1 second'],
  ['Shift + ← / →', 'Move playhead one frame'],
];

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="panel bg-panel w-[420px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-panel-border font-semibold">Keyboard Shortcuts</div>
        <div className="p-4 space-y-1.5 max-h-[60vh] overflow-y-auto">
          {SHORTCUTS.map(([keys, desc]) => (
            <div key={keys} className="flex items-center justify-between text-sm">
              <span className="text-gray-400">{desc}</span>
              <kbd className="font-mono text-xs bg-panel-sunken border border-panel-border rounded px-2 py-0.5 text-gray-300">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-panel-border flex justify-end">
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export { PROJECT_FILE_EXTENSION };
