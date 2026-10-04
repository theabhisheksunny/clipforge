import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '@shared/types';
import type { ExportSettings, Project } from '@shared/types';
import { exportProject, cancelRender } from '../services/renderer/rendererService';
import { verifyFfmpeg } from '../services/ffmpeg/ffmpegLocator';

export function registerRenderIpc(): void {
  ipcMain.handle(IPC.ffmpegStatus, async () => verifyFfmpeg());

  ipcMain.handle(IPC.renderExport, async (e, project: Project, settings: ExportSettings) => {
    if (!project || !settings?.outputPath) throw new Error('Invalid export payload.');
    const sender = e.sender;
    return exportProject(project, settings, (progress) => {
      if (!sender.isDestroyed()) sender.send(IPC.renderProgress, progress);
    });
  });

  ipcMain.handle(IPC.renderCancel, async (_e, jobId: string) => {
    if (typeof jobId === 'string') cancelRender(jobId);
  });
}

export function broadcastToAll(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
