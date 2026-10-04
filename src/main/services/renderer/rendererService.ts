/**
 * RendererService (spec section 26). Translates the project model into an
 * FFmpeg command, runs the export with progress reporting, and supports
 * cancellation. Heavy work stays in the main process, never the renderer.
 */

import { existsSync, statSync } from 'node:fs';
import { buildFilterGraph } from './filterGraph';
import { buildEncoderConfig } from './exportSettings';
import { runFfmpeg } from '../ffmpeg/ffmpegRunner';
import { probeMediaMetadata } from '../media/probe';
import { createId } from '@shared/utils/factories';
import type {
  ExportSettings,
  Project,
  RenderProgress,
  RenderResult,
  RenderValidation,
  MediaAsset,
} from '@shared/types';

const VALID_VIDEO_CODECS = new Set(['h264', 'hevc', 'h265', 'vp9', 'av1']);
const VALID_AUDIO_CODECS = new Set(['aac', 'opus', 'mp3', 'vorbis']);
const DURATION_TOLERANCE_SECONDS = 1.0;

/**
 * Validate an exported file with ffprobe. `expectedDuration` is the graph's
 * total duration (which, for a loop export, equals the audio length).
 */
async function validateOutput(
  outputPath: string,
  expectedDuration: number,
): Promise<RenderValidation> {
  const messages: string[] = [];

  if (!existsSync(outputPath)) {
    return {
      ok: false,
      hasVideo: false,
      hasAudio: false,
      audioStreamCount: 0,
      durationSeconds: null,
      videoCodec: null,
      audioCodec: null,
      width: null,
      height: null,
      messages: ['The exported file does not exist.'],
    };
  }

  const meta = await probeMediaMetadata(outputPath);
  const video = meta.videoStreams[0] ?? null;
  const audio = meta.audioStreams[0] ?? null;
  const hasVideo = meta.videoStreams.length > 0;
  const audioStreamCount = meta.audioStreams.length;
  const hasAudio = audioStreamCount > 0;
  const durationSeconds = meta.duration > 0 ? meta.duration : null;
  const videoCodec = video?.codec ?? null;
  const audioCodec = audio?.codec ?? null;

  if (!hasVideo) messages.push('The export has no video stream.');
  if (!hasAudio) messages.push('The export has no audio stream.');
  if (audioStreamCount > 1) {
    messages.push(`The export has ${audioStreamCount} audio streams; expected exactly one.`);
  }
  if (durationSeconds == null) {
    messages.push('Could not determine the export duration.');
  } else if (Math.abs(durationSeconds - expectedDuration) > DURATION_TOLERANCE_SECONDS) {
    messages.push(
      `Export duration ${durationSeconds.toFixed(2)}s differs from the expected ${expectedDuration.toFixed(2)}s.`,
    );
  }
  // Video must not be shorter than the audio (both should match the output).
  if (durationSeconds != null && hasAudio && durationSeconds + DURATION_TOLERANCE_SECONDS < expectedDuration) {
    messages.push('The video track is shorter than the audio track.');
  }
  if (videoCodec && !VALID_VIDEO_CODECS.has(videoCodec)) {
    messages.push(`Unexpected video codec: ${videoCodec}.`);
  }
  if (audioCodec && !VALID_AUDIO_CODECS.has(audioCodec)) {
    messages.push(`Unexpected audio codec: ${audioCodec}.`);
  }

  return {
    ok: messages.length === 0,
    hasVideo,
    hasAudio,
    audioStreamCount,
    durationSeconds,
    videoCodec,
    audioCodec,
    width: video?.width ?? null,
    height: video?.height ?? null,
    messages,
  };
}

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

    // Validate the output with ffprobe before declaring success.
    report({ stage: 'finalizing', progress: 0.99, etaSeconds: 0, outputSizeBytes: size });
    let validation: RenderValidation;
    try {
      validation = await validateOutput(settings.outputPath, graph.durationSeconds);
    } catch (err) {
      validation = {
        ok: false,
        hasVideo: false,
        hasAudio: false,
        audioStreamCount: 0,
        durationSeconds: null,
        videoCodec: null,
        audioCodec: null,
        width: null,
        height: null,
        messages: [`Could not validate the export: ${(err as Error).message}`],
      };
    }

    if (!validation.ok) {
      report({
        stage: 'error',
        progress: 1,
        etaSeconds: 0,
        outputSizeBytes: size,
        message: 'The export completed but failed validation.',
      });
      return {
        jobId,
        success: false,
        outputPath: settings.outputPath,
        outputSizeBytes: size,
        durationSeconds: graph.durationSeconds,
        validation,
        error: 'The export completed but failed validation. See details.',
        details: `${validation.messages.join('\n')}\n\n${result.stderr}`,
      };
    }

    report({ stage: 'done', progress: 1, etaSeconds: 0, outputSizeBytes: size });

    return {
      jobId,
      success: true,
      outputPath: settings.outputPath,
      outputSizeBytes: size,
      durationSeconds: graph.durationSeconds,
      validation,
      details: result.stderr,
    };
  } catch (err) {
    activeJobs.delete(jobId);
    const message = (err as Error).message || 'Unknown export error.';
    report({ stage: 'error', progress: 0, etaSeconds: null, outputSizeBytes: null, message });
    return { jobId, success: false, error: message, details: String(err) };
  }
}
