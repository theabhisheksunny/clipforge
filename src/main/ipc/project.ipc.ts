import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import { IPC, PROJECT_FILE_EXTENSION } from '@shared/types';
import type { Project } from '@shared/types';
import { createProject } from '@shared/utils/factories';
import {
  saveProjectToPath,
  loadProjectFromPath,
  writeAutosave,
  readAutosave,
} from '../services/project/projectService';

export function registerProjectIpc(): void {
  ipcMain.handle(IPC.projectNew, async (_e, name?: string) => createProject(name));

  ipcMain.handle(IPC.projectOpen, async (e, path?: string) => {
    let target = path;
    if (!target) {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openFile'],
        filters: [{ name: 'Video Editor Project', extensions: [PROJECT_FILE_EXTENSION] }],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      target = result.filePaths[0];
    }
    return loadProjectFromPath(target);
  });

  ipcMain.handle(IPC.projectSave, async (_e, project: Project, path: string) => {
    if (!project || typeof path !== 'string') throw new Error('Invalid save payload.');
    saveProjectToPath(project, path);
    return { cancelled: false, path };
  });

  ipcMain.handle(IPC.projectSaveAs, async (e, project: Project) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${project.projectName}.${PROJECT_FILE_EXTENSION}`,
      filters: [{ name: 'Video Editor Project', extensions: [PROJECT_FILE_EXTENSION] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true, path: null };
    saveProjectToPath(project, result.filePath);
    return { cancelled: false, path: result.filePath };
  });

  ipcMain.handle(IPC.projectAutosave, async (_e, project: Project) => {
    if (project) writeAutosave(project);
  });

  ipcMain.handle(IPC.projectRecover, async () => readAutosave());

  // System file helpers.
  ipcMain.handle(IPC.dialogSaveFile, async (e, defaultName?: string, extensions?: string[]) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: extensions ? [{ name: 'Export', extensions }] : undefined,
    });
    return { cancelled: result.canceled, path: result.filePath ?? null };
  });

  ipcMain.handle(IPC.openPath, async (_e, path: string) => {
    if (typeof path === 'string') await shell.openPath(path);
  });

  ipcMain.handle(IPC.showInFolder, async (_e, path: string) => {
    if (typeof path === 'string') shell.showItemInFolder(path);
  });
}
