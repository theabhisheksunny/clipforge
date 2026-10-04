/**
 * IPC contract shared between main and renderer.
 *
 * The renderer only ever talks to the main process through the typed `window.editorApi`
 * bridge exposed by the preload script. Node APIs are never exposed directly.
 */

import type { MediaAsset } from './media';
import type { Project, ProjectFile } from './project';
import type { ExportSettings, RenderProgress, RenderResult } from './render';

/** Channel name constants to avoid typos across main/preload. */
export const IPC = {
  // media
  mediaImport: 'media:import',
  mediaImportPaths: 'media:import-paths',
  mediaProbe: 'media:probe',
  mediaThumbnail: 'media:thumbnail',
  mediaWaveform: 'media:waveform',
  mediaRelink: 'media:relink',
  // project
  projectNew: 'project:new',
  projectOpen: 'project:open',
  projectSave: 'project:save',
  projectSaveAs: 'project:save-as',
  projectAutosave: 'project:autosave',
  projectRecover: 'project:recover',
  // render
  renderExport: 'render:export',
  renderCancel: 'render:cancel',
  renderProgress: 'render:progress',
  // system
  ffmpegStatus: 'system:ffmpeg-status',
  dialogOpenFiles: 'system:open-files',
  dialogSaveFile: 'system:save-file',
  openPath: 'system:open-path',
  showInFolder: 'system:show-in-folder',
  diagnostics: 'system:diagnostics',
  testFfmpeg: 'system:test-ffmpeg',
} as const;

export interface FfmpegStatus {
  available: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
  error?: string;
}

/** Diagnostics snapshot surfaced in Settings → Diagnostics. */
export interface DiagnosticsInfo {
  appVersion: string;
  electronVersion: string;
  ffmpeg: FfmpegStatus;
  tempDir: string;
  outputDir: string;
}

/** Result of running the trivial "Test FFmpeg" command. */
export interface TestFfmpegResult {
  success: boolean;
  version: string | null;
  details?: string;
}

export interface WaveformData {
  assetId: string;
  /** Normalized peak values 0..1, one per bucket. */
  peaks: number[];
  samplesPerPeak: number;
}

export interface OpenFilesResult {
  cancelled: boolean;
  paths: string[];
}

export interface SaveFileResult {
  cancelled: boolean;
  path: string | null;
}

/**
 * The surface exposed on `window.editorApi`. Every method is async and
 * crosses the IPC boundary.
 */
export interface EditorApi {
  // --- system ---
  getFfmpegStatus(): Promise<FfmpegStatus>;
  openFilesDialog(filters?: { name: string; extensions: string[] }[]): Promise<OpenFilesResult>;
  saveFileDialog(defaultName?: string, extensions?: string[]): Promise<SaveFileResult>;
  openPath(path: string): Promise<void>;
  showInFolder(path: string): Promise<void>;
  getDiagnostics(): Promise<DiagnosticsInfo>;
  testFfmpeg(): Promise<TestFfmpegResult>;
  /** Convert an absolute filesystem path to a privileged media:// URL. */
  toMediaUrl(path: string): string;

  // --- media ---
  importMediaPaths(paths: string[]): Promise<MediaAsset[]>;
  probeMedia(path: string): Promise<MediaAsset>;
  getThumbnail(assetId: string, path: string, atSeconds?: number): Promise<string | null>;
  getWaveform(assetId: string, path: string): Promise<WaveformData | null>;
  relinkMedia(assetId: string, newPath: string): Promise<MediaAsset>;

  // --- project ---
  newProject(name?: string): Promise<Project>;
  openProject(path?: string): Promise<ProjectFile | null>;
  saveProject(project: Project, path: string): Promise<SaveFileResult>;
  saveProjectAs(project: Project): Promise<SaveFileResult>;
  autosaveProject(project: Project): Promise<void>;
  recoverProject(): Promise<ProjectFile | null>;

  // --- render ---
  exportProject(project: Project, settings: ExportSettings): Promise<RenderResult>;
  cancelRender(jobId: string): Promise<void>;
  onRenderProgress(cb: (progress: RenderProgress) => void): () => void;

  // --- menu ---
  onMenuAction(cb: (action: string) => void): () => void;
}

export type MenuAction =
  | 'new'
  | 'open'
  | 'save'
  | 'saveas'
  | 'import'
  | 'export'
  | 'undo'
  | 'redo'
  | 'shortcuts';

declare global {
  interface Window {
    editorApi: EditorApi;
  }
}
