/**
 * Preload bridge (spec section 42). Exposes a minimal, typed, validated API on
 * window.editorApi via contextBridge. Node APIs are never exposed to the
 * renderer; every call crosses IPC to the main process.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/types';
import type {
  EditorApi,
  ExportSettings,
  Project,
  RenderProgress,
} from '@shared/types';

const api: EditorApi = {
  // system
  getFfmpegStatus: () => ipcRenderer.invoke(IPC.ffmpegStatus),
  openFilesDialog: (filters) => ipcRenderer.invoke(IPC.dialogOpenFiles, filters),
  saveFileDialog: (defaultName, extensions) =>
    ipcRenderer.invoke(IPC.dialogSaveFile, defaultName, extensions),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  showInFolder: (path) => ipcRenderer.invoke(IPC.showInFolder, path),

  // media
  importMediaPaths: (paths) => ipcRenderer.invoke(IPC.mediaImportPaths, paths),
  probeMedia: (path) => ipcRenderer.invoke(IPC.mediaProbe, path),
  getThumbnail: (assetId, path, atSeconds) =>
    ipcRenderer.invoke(IPC.mediaThumbnail, assetId, path, atSeconds),
  getWaveform: (assetId, path) => ipcRenderer.invoke(IPC.mediaWaveform, assetId, path),
  relinkMedia: (assetId, newPath) => ipcRenderer.invoke(IPC.mediaRelink, assetId, newPath),

  // project
  newProject: (name) => ipcRenderer.invoke(IPC.projectNew, name),
  openProject: (path) => ipcRenderer.invoke(IPC.projectOpen, path),
  saveProject: (project: Project, path: string) =>
    ipcRenderer.invoke(IPC.projectSave, project, path),
  saveProjectAs: (project: Project) => ipcRenderer.invoke(IPC.projectSaveAs, project),
  autosaveProject: (project: Project) => ipcRenderer.invoke(IPC.projectAutosave, project),
  recoverProject: () => ipcRenderer.invoke(IPC.projectRecover),

  // render
  exportProject: (project: Project, settings: ExportSettings) =>
    ipcRenderer.invoke(IPC.renderExport, project, settings),
  cancelRender: (jobId) => ipcRenderer.invoke(IPC.renderCancel, jobId),
  onRenderProgress: (cb: (p: RenderProgress) => void) => {
    const listener = (_e: unknown, progress: RenderProgress) => cb(progress);
    ipcRenderer.on(IPC.renderProgress, listener);
    return () => ipcRenderer.removeListener(IPC.renderProgress, listener);
  },

  onMenuAction: (cb: (action: string) => void) => {
    const channels = [
      'menu:new',
      'menu:open',
      'menu:save',
      'menu:saveas',
      'menu:import',
      'menu:export',
      'menu:undo',
      'menu:redo',
      'menu:shortcuts',
    ];
    const makeListener = (action: string) => () => cb(action);
    const listeners = channels.map((ch) => {
      const l = makeListener(ch.replace('menu:', ''));
      ipcRenderer.on(ch, l);
      return [ch, l] as const;
    });
    return () => listeners.forEach(([ch, l]) => ipcRenderer.removeListener(ch, l));
  },
};

contextBridge.exposeInMainWorld('editorApi', api);
