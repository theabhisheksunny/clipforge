import { useEffect, useState } from 'react';
import type { FfmpegStatus } from '@shared/types';

/** Shows a friendly warning if FFmpeg/FFprobe is unavailable (spec section 27). */
export function FfmpegBanner() {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    window.editorApi.getFfmpegStatus().then(setStatus);
  }, []);

  if (!status || status.available || dismissed) return null;

  return (
    <div className="bg-red-900/60 border-b border-red-500/40 px-4 py-2 text-sm text-red-100 flex items-center gap-3">
      <span className="font-medium">FFmpeg unavailable.</span>
      <span className="text-red-200/80">{status.error}</span>
      <button className="ml-auto text-red-200 hover:text-white text-xs underline" onClick={() => setDismissed(true)}>
        dismiss
      </button>
    </div>
  );
}
