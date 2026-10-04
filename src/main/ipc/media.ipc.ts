import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC } from '@shared/types';
import { importMediaPaths, relinkMedia } from '../services/media/mediaService';
import { probeMediaMetadata } from '../services/media/probe';
import { generateThumbnail, generateWaveform } from '../services/media/thumbnails';
import { basename, extname } from 'node:path';
import { kindForExtension } from '@shared/types';
import { createId } from '@shared/utils/factories';

export function registerMediaIpc(): void {
  ipcMain.handle(IPC.mediaImportPaths, async (_e, paths: string[]) => {
    if (!Array.isArray(paths)) throw new Error('Invalid import payload.');
    return importMediaPaths(paths.filter((p) => typeof p === 'string'));
  });

  ipcMain.handle(IPC.mediaProbe, async (_e, path: string) => {
    if (typeof path !== 'string') throw new Error('Invalid path.');
    const ext = extname(path).toLowerCase().replace(/^\./, '');
    const metadata = await probeMediaMetadata(path);
    return {
      id: createId(),
      path,
      name: basename(path),
      kind: kindForExtension(ext) ?? 'video',
      extension: ext,
      metadata,
      missing: false,
      importedAt: Date.now(),
    };
  });

  ipcMain.handle(IPC.mediaThumbnail, async (_e, _assetId: string, path: string, atSeconds?: number) => {
    if (typeof path !== 'string') return null;
    return generateThumbnail(path, atSeconds ?? 1);
  });

  ipcMain.handle(IPC.mediaWaveform, async (_e, assetId: string, path: string) => {
    if (typeof path !== 'string') return null;
    return generateWaveform(assetId, path);
  });

  ipcMain.handle(IPC.mediaRelink, async (_e, assetId: string, newPath: string) => {
    if (typeof assetId !== 'string' || typeof newPath !== 'string') {
      throw new Error('Invalid relink payload.');
    }
    return relinkMedia(assetId, newPath);
  });

  ipcMain.handle(
    IPC.dialogOpenFiles,
    async (e, filters?: { name: string; extensions: string[] }[]) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openFile', 'multiSelections'],
        filters: filters ?? [{ name: 'Media', extensions: ['*'] }],
      });
      return { cancelled: result.canceled, paths: result.filePaths };
    },
  );
}
