import { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { CloseIcon } from '../Icons';
import { formatBytes, formatTime } from '../../utils/format';
import type {
  ExportSettings,
  RenderProgress,
  RenderResult,
  ExportResolution,
  ExportFormat,
  ExportVideoCodec,
  ExportAudioCodec,
  ExportFpsOption,
  ExportQuality,
} from '@shared/types';

const RESOLUTIONS: ExportResolution[] = ['480p', '720p', '1080p', '1440p', '4K'];
const FORMATS: ExportFormat[] = ['mp4', 'webm'];
const VIDEO_CODECS: ExportVideoCodec[] = ['h264', 'h265', 'vp9'];
const AUDIO_CODECS: ExportAudioCodec[] = ['aac', 'opus', 'none'];
const FPS: ExportFpsOption[] = ['source', '24', '30', '60'];
const QUALITIES: ExportQuality[] = ['low', 'medium', 'high', 'custom'];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const projectName = project.projectName;

  const [settings, setSettings] = useState<ExportSettings>({
    resolution: '1080p',
    format: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    fps: 'source',
    quality: 'high',
    outputPath: '',
  });

  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const unsub = window.editorApi.onRenderProgress((p) => setProgress(p));
    return unsub;
  }, []);

  const patch = (p: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...p }));

  const chooseOutput = async () => {
    const ext = settings.format;
    const res = await window.editorApi.saveFileDialog(`${projectName}.${ext}`, [ext]);
    if (!res.cancelled && res.path) patch({ outputPath: res.path });
  };

  const startExport = async () => {
    let outputPath = settings.outputPath;
    if (!outputPath) {
      const res = await window.editorApi.saveFileDialog(`${projectName}.${settings.format}`, [settings.format]);
      if (res.cancelled || !res.path) return;
      outputPath = res.path;
      patch({ outputPath });
    }
    setExporting(true);
    setResult(null);
    setProgress({ jobId: '', stage: 'preparing', progress: 0, etaSeconds: null, outputSizeBytes: null });
    const r = await window.editorApi.exportProject(project, { ...settings, outputPath });
    setResult(r);
    setExporting(false);
  };

  const cancel = async () => {
    if (progress?.jobId) await window.editorApi.cancelRender(progress.jobId);
    setExporting(false);
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-6">
      <div className="panel bg-panel w-[560px] max-h-full overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
          <h2 className="font-semibold">Export Video</h2>
          <button className="icon-btn" onClick={onClose} disabled={exporting}>
            <CloseIcon />
          </button>
        </div>

        {!result && !exporting && (
          <div className="p-4 space-y-4">
            <Field label="Resolution">
              <Segmented options={RESOLUTIONS} value={settings.resolution} onChange={(v) => patch({ resolution: v })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Format">
                <Select options={FORMATS} value={settings.format} onChange={(v) => patch({ format: v, videoCodec: v === 'webm' ? 'vp9' : 'h264', audioCodec: v === 'webm' ? 'opus' : 'aac' })} />
              </Field>
              <Field label="Video Codec">
                <Select options={VIDEO_CODECS} value={settings.videoCodec} onChange={(v) => patch({ videoCodec: v })} labels={{ h264: 'H.264', h265: 'H.265/HEVC', vp9: 'VP9' }} />
              </Field>
              <Field label="FPS">
                <Select options={FPS} value={settings.fps} onChange={(v) => patch({ fps: v })} />
              </Field>
              <Field label="Audio">
                <Select options={AUDIO_CODECS} value={settings.audioCodec} onChange={(v) => patch({ audioCodec: v })} labels={{ aac: 'AAC', opus: 'Opus', none: 'No Audio' }} />
              </Field>
            </div>
            <Field label="Quality">
              <Segmented options={QUALITIES} value={settings.quality} onChange={(v) => patch({ quality: v })} />
            </Field>
            {settings.quality === 'custom' && (
              <Field label="CRF (lower = better, 0-51)">
                <input
                  type="number"
                  min={0}
                  max={51}
                  value={settings.customCrf ?? 20}
                  onChange={(e) => patch({ customCrf: Number(e.target.value) })}
                  className="w-24 bg-panel-sunken border border-panel-border rounded px-2 py-1 text-sm"
                />
              </Field>
            )}
            <Field label="Output File">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={settings.outputPath || 'Choose location…'}
                  className="flex-1 bg-panel-sunken border border-panel-border rounded px-2 py-1 text-sm text-gray-400 truncate"
                />
                <button className="btn-ghost" onClick={chooseOutput}>Browse</button>
              </div>
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={startExport} disabled={project.clips.length === 0}>
                Export
              </button>
            </div>
            {project.clips.length === 0 && (
              <p className="text-xs text-red-400">Add clips to the timeline before exporting.</p>
            )}
          </div>
        )}

        {exporting && progress && (
          <div className="p-6 space-y-4">
            <div className="text-sm text-gray-300 capitalize">
              {progress.stage.replace('-', ' ')}…
            </div>
            <div className="h-3 bg-panel-sunken rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>{Math.round(progress.progress * 100)}%</span>
              <span>{progress.etaSeconds != null ? `~${formatTime(progress.etaSeconds, false)} left` : ''}</span>
              <span>{formatBytes(progress.outputSizeBytes)}</span>
            </div>
            <div className="flex justify-end">
              <button className="btn-ghost" onClick={cancel}>Cancel</button>
            </div>
          </div>
        )}

        {result && (
          <div className="p-6 space-y-4">
            {result.success ? (
              <>
                <div className="text-green-400 font-medium">Export completed successfully.</div>
                <div className="text-sm text-gray-400 space-y-1">
                  <div>Duration: {formatTime(result.durationSeconds ?? 0)}</div>
                  <div>Size: {formatBytes(result.outputSizeBytes)}</div>
                  <div className="truncate">File: {result.outputPath}</div>
                  {result.validation && (
                    <div className="text-green-400/80">
                      Validated: {result.validation.width}×{result.validation.height},{' '}
                      {result.validation.videoCodec} + {result.validation.audioCodec},{' '}
                      {result.validation.audioStreamCount} audio stream
                      {result.validation.audioStreamCount === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="btn-ghost" onClick={() => result.outputPath && window.editorApi.openPath(result.outputPath)}>Open File</button>
                  <button className="btn-ghost" onClick={() => result.outputPath && window.editorApi.showInFolder(result.outputPath)}>Open Folder</button>
                  <div className="flex-1" />
                  <button className="btn-primary" onClick={onClose}>Done</button>
                </div>
              </>
            ) : (
              <>
                <div className="text-red-400 font-medium">{result.error ?? 'Export failed.'}</div>
                {result.details && (
                  <div>
                    <button className="text-xs text-accent hover:underline" onClick={() => setShowDetails((v) => !v)}>
                      {showDetails ? 'Hide' : 'Show'} Details
                    </button>
                    {showDetails && (
                      <pre className="mt-2 max-h-40 overflow-auto bg-panel-sunken rounded p-2 text-[10px] text-gray-400 whitespace-pre-wrap">
                        {result.details}
                      </pre>
                    )}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button className="btn-ghost" onClick={() => setResult(null)}>Back</button>
                  <button className="btn-primary" onClick={onClose}>Close</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wide text-gray-500">{label}</label>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-3 py-1 rounded text-sm capitalize ${value === o ? 'bg-accent text-white' : 'bg-panel-raised text-gray-300 hover:bg-panel-border'}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Select<T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T; onChange: (v: T) => void; labels?: Record<string, string> }) {
  return (
    <select
      className="w-full bg-panel-sunken border border-panel-border rounded px-2 py-1 text-sm outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o} value={o}>{labels?.[o] ?? o}</option>
      ))}
    </select>
  );
}
