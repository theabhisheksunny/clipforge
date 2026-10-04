/**
 * System / diagnostics IPC (Settings → Diagnostics).
 *
 * Exposes app + Electron versions, FFmpeg/FFprobe status and versions, the temp
 * and output directories, and a "Test FFmpeg" action that runs a trivial
 * lavfi command. All heavy work stays in main — the renderer never touches
 * child_process or fs.
 */

import { app, ipcMain } from 'electron';
import { IPC } from '@shared/types';
import type { DiagnosticsInfo, TestFfmpegResult } from '@shared/types';
import { verifyFfmpeg } from '../services/ffmpeg/ffmpegLocator';
import { runFfmpeg } from '../services/ffmpeg/ffmpegRunner';
import { bucketDir } from '../services/cache/cachePaths';

export function registerSystemIpc(): void {
  ipcMain.handle(IPC.diagnostics, async (): Promise<DiagnosticsInfo> => {
    const ffmpeg = await verifyFfmpeg();
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      ffmpeg,
      tempDir: bucketDir('temp'),
      outputDir: bucketDir('renders'),
    };
  });

  ipcMain.handle(IPC.testFfmpeg, async (): Promise<TestFfmpegResult> => {
    const status = await verifyFfmpeg();
    const result = await runFfmpeg({
      args: ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x128:rate=30', '-f', 'null', '-'],
    });
    const success = result.code === 0;
    return {
      success,
      version: status.ffmpegVersion,
      details: success ? undefined : result.stderr || `FFmpeg exited with code ${result.code}`,
    };
  });
}
