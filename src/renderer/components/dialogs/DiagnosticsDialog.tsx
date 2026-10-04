import { useEffect, useState } from 'react';
import { CloseIcon } from '../Icons';
import type { DiagnosticsInfo, TestFfmpegResult } from '@shared/types';

/**
 * Settings → Diagnostics. Shows environment + FFmpeg/FFprobe status pulled from
 * the main process over IPC, and lets the user run a trivial FFmpeg command to
 * confirm the binary works. The renderer never touches child_process/fs.
 */
export function DiagnosticsDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestFfmpegResult | null>(null);

  useEffect(() => {
    let active = true;
    window.editorApi
      .getDiagnostics()
      .then((d) => {
        if (active) setInfo(d);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await window.editorApi.testFfmpeg();
      setTestResult(r);
    } finally {
      setTesting(false);
    }
  };

  const ff = info?.ffmpeg;

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-6">
      <div className="panel bg-panel w-[560px] max-h-full overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
          <h2 className="font-semibold">Diagnostics</h2>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          {loading && <div className="text-gray-400">Gathering diagnostics…</div>}

          {info && (
            <>
              <Row label="App version" value={info.appVersion} />
              <Row label="Electron version" value={info.electronVersion} />

              <div className="h-px bg-panel-border my-2" />

              <Row
                label="FFmpeg"
                value={ff?.available ? 'Available' : 'Not available'}
                tone={ff?.available ? 'ok' : 'error'}
              />
              <Row label="FFmpeg path" value={ff?.ffmpegPath ?? '—'} mono />
              <Row label="FFmpeg version" value={ff?.ffmpegVersion ?? '—'} mono />

              <div className="h-px bg-panel-border my-2" />

              <Row
                label="FFprobe"
                value={ff?.ffprobePath ? 'Available' : 'Not available'}
                tone={ff?.ffprobePath ? 'ok' : 'error'}
              />
              <Row label="FFprobe path" value={ff?.ffprobePath ?? '—'} mono />
              <Row label="FFprobe version" value={ff?.ffprobeVersion ?? '—'} mono />

              {ff?.error && <div className="text-red-400 text-xs">{ff.error}</div>}

              <div className="h-px bg-panel-border my-2" />

              <Row label="Temp directory" value={info.tempDir} mono />
              <Row label="Output directory" value={info.outputDir} mono />

              <div className="h-px bg-panel-border my-2" />

              <div className="flex items-center gap-3">
                <button className="btn-primary" onClick={runTest} disabled={testing}>
                  {testing ? 'Testing…' : 'Test FFmpeg'}
                </button>
                {testResult && (
                  <span className={testResult.success ? 'text-green-400' : 'text-red-400'}>
                    {testResult.success
                      ? `Success${testResult.version ? ` (v${testResult.version})` : ''}`
                      : 'Failed'}
                  </span>
                )}
              </div>
              {testResult && !testResult.success && testResult.details && (
                <pre className="max-h-32 overflow-auto bg-panel-sunken rounded p-2 text-[10px] text-gray-400 whitespace-pre-wrap">
                  {testResult.details}
                </pre>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-panel-border flex justify-end">
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'ok' | 'error';
}) {
  const toneClass = tone === 'ok' ? 'text-green-400' : tone === 'error' ? 'text-red-400' : 'text-gray-200';
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`text-right break-all ${mono ? 'font-mono text-xs' : ''} ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}
