/**
 * RendererService (spec section 26). Translates the project model into an
 * FFmpeg command, runs the export with progress reporting, and supports
 * cancellation. Heavy work stays in the main process, never the renderer.
 */

import { existsSync, statSync } from 'node:fs';
import { buildFilterGraph } from './filterGraph';
import { buildEncoderConfig } from './exportSettings';
import { runFfmpeg } from '../ffmpeg/ffmpegRunner';
import { createId } from '@shared/utils/factories';
import type {
  ExportSettings,
  Project,
  RenderProgress,
  RenderResult,
  MediaAsset,
} from '@shared/types';

type ProgressCallback = (p: RenderProgress) => void;

const activeJobs = new Map<string, AbortController>();

function friendlyError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('no space left')) return 'Not enough disk space to complete the export.';
  if (s.includes('permission denied')) return 'Permission denied writing the output file.';
  if (s.includes('invalid data') || s.includes('could not find codec'))
    return 'A media file appears to be corrupted or uses an unsupported codec.';
  if (s.includes('no such file')) return 'A source media file could not be found.';
  return 'The export failed. See details for the full FFmpeg output.';
}

export function cancelRender(jobId: string): void {
  const controller = activeJobs.get(jobId);
  if (controller) controller.abort();
}

export async function exportProject(
  project: Project,
  settings: ExportSettings,
  onProgress: ProgressCallback,
): Promise<RenderResult> {
  const jobId = createId();
  const controller = new AbortController();
  activeJobs.set(jobId, controller);

  const report = (p: Omit<RenderProgress, 'jobId'>) => onProgress({ jobId, ...p });

  try {
    report({ stage: 'preparing', progress: 0, etaSeconds: null, outputSizeBytes: null });

    // Validate all referenced media exists.
    const assetById = new Map<string, MediaAsset>();
    for (const a of project.mediaAssets) assetById.set(a.id, a);
    const usedAssetIds = new Set(project.clips.map((c) => c.assetId));
    for (const id of usedAssetIds) {
      const asset = assetById.get(id);
      if (!asset || !existsSync(asset.path)) {
        activeJobs.delete(jobId);
        return {
          jobId,
          success: false,
          error: `Missing media: ${asset?.name ?? id}. Relink it before exporting.`,
        };
      }
    }

    if (project.clips.length === 0) {
      activeJobs.delete(jobId);
      return { jobId, success: false, error: 'The timeline is empty. Add clips before exporting.' };
    }

    const sourceFps =
      assetById.get(project.clips[0].assetId)?.metadata.videoStreams[0]?.fps ||
      project.canvas.fps;
    const encoder = buildEncoderConfig(settings, sourceFps);

    const graph = buildFilterGraph(project, {
      canvasWidth: encoder.width,
      canvasHeight: encoder.height,
      fps: encoder.fps ?? project.canvas.fps,
      assetById,
    });

    const args: string[] = [...graph.inputArgs];
    args.push('-filter_complex', graph.filterComplex);
    args.push('-map', graph.videoOutLabel);
    if (graph.audioOutLabel && encoder.hasAudio) {
      args.push('-map', graph.audioOutLabel);
    }
    args.push(...encoder.videoArgs);
    if (encoder.hasAudio && graph.audioOutLabel) {
      args.push(...encoder.audioArgs);
    } else {
      args.push('-an');
    }
    if (encoder.fps) args.push('-r', String(encoder.fps));
    args.push('-t', String(graph.durationSeconds));
    args.push('-movflags', '+faststart');
    args.push('-progress', 'pipe:1');
    args.push('-y', settings.outputPath);

    report({ stage: 'processing-video', progress: 0.02, etaSeconds: null, outputSizeBytes: null });

    const startTime = Date.now();
    const result = await runFfmpeg({
      args,
      totalDurationSeconds: graph.durationSeconds,
      signal: controller.signal,
      onProgress: ({ progress }) => {
        const elapsed = (Date.now() - startTime) / 1000;
        const eta = progress > 0.02 ? (elapsed / progress) * (1 - progress) : null;
        let size: number | null = null;
        try {
          if (existsSync(settings.outputPath)) size = statSync(settings.outputPath).size;
        } catch {
          /* ignore */
        }
        report({
          stage: 'processing-video',
          progress: Math.max(0.02, progress),
          etaSeconds: eta ? Math.round(eta) : null,
          outputSizeBytes: size,
        });
      },
    });

    activeJobs.delete(jobId);

    if (result.cancelled) {
      report({ stage: 'cancelled', progress: 0, etaSeconds: null, outputSizeBytes: null });
      return { jobId, success: false, error: 'Export cancelled.' };
    }

    if (result.code !== 0 || !existsSync(settings.outputPath)) {
      report({
        stage: 'error',
        progress: 0,
        etaSeconds: null,
        outputSizeBytes: null,
        message: friendlyError(result.stderr),
      });
      return {
        jobId,
        success: false,
        error: friendlyError(result.stderr),
        details: result.stderr,
      };
    }

    const size = statSync(settings.outputPath).size;
    report({ stage: 'done', progress: 1, etaSeconds: 0, outputSizeBytes: size });

    return {
      jobId,
      success: true,
      outputPath: settings.outputPath,
      outputSizeBytes: size,
      durationSeconds: graph.durationSeconds,
      details: result.stderr,
    };
  } catch (err) {
    activeJobs.delete(jobId);
    const message = (err as Error).message || 'Unknown export error.';
    report({ stage: 'error', progress: 0, etaSeconds: null, outputSizeBytes: null, message });
    return { jobId, success: false, error: message, details: String(err) };
  }
}
