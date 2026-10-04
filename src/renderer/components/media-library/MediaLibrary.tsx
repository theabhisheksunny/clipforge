import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { ImportIcon, SearchIcon, VideoIcon, MusicIcon, ImageIcon, TrashIcon } from '../Icons';
import { ALL_MEDIA_EXTENSIONS, type MediaAsset } from '@shared/types';
import { planLoopVideoToAudio } from '@shared/utils/loop';
import { formatDuration } from '../../utils/format';

type SortKey = 'name' | 'kind' | 'recent';

export function MediaLibrary() {
  const assets = useProjectStore((s) => s.project.mediaAssets);
  const addAssets = useProjectStore((s) => s.addAssets);
  const removeAsset = useProjectStore((s) => s.removeAsset);
  const updateAsset = useProjectStore((s) => s.updateAsset);
  const loopVideoToAudio = useProjectStore((s) => s.loopVideoToAudio);
  const search = useEditorStore((s) => s.mediaSearch);
  const setSearch = useEditorStore((s) => s.setMediaSearch);

  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [importing, setImporting] = useState(false);
  const [failedImports, setFailedImports] = useState<string[]>([]);

  const handleImport = async () => {
    setImporting(true);
    setFailedImports([]);
    try {
      const res = await window.editorApi.openFilesDialog([
        { name: 'Media Files', extensions: [...ALL_MEDIA_EXTENSIONS] },
        { name: 'All Files', extensions: ['*'] },
      ]);
      if (!res.cancelled && res.paths.length) {
        const imported = await window.editorApi.importMediaPaths(res.paths);
        addAssets(imported);
        // Surface any files that could not be read instead of silently
        // adding them as "missing" assets.
        const failed = imported.filter((a) => a.missing).map((a) => a.name);
        setFailedImports(failed);
      }
    } finally {
      setImporting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = assets.filter((a) => (q ? a.name.toLowerCase().includes(q) : true));
    list = [...list].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'kind') return a.kind.localeCompare(b.kind);
      return b.importedAt - a.importedAt;
    });
    return list;
  }, [assets, search, sortKey]);

  // Loop Video to Audio operates on the first video + first audio asset.
  const loopInfo = useMemo(() => {
    const video = assets.find((a) => a.kind === 'video');
    const audio = assets.find((a) => a.kind === 'audio');
    if (!video || !audio) return null;
    const videoDuration = video.metadata.duration;
    const audioDuration = audio.metadata.duration;
    if (videoDuration <= 0 || audioDuration <= 0) return null;
    const { repetitions } = planLoopVideoToAudio(videoDuration, audioDuration);
    return { repetitions, audioLonger: audioDuration > videoDuration };
  }, [assets]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col gap-2 p-2 border-b border-panel-border">
        <button className="btn-primary flex-1" onClick={handleImport} disabled={importing}>
          <ImportIcon width={16} height={16} />
          {importing ? 'Importing…' : 'Import Media'}
        </button>

        {failedImports.length > 0 && (
          <div className="text-[11px] text-red-400 leading-snug">
            Could not import: {failedImports.join(', ')}
          </div>
        )}

        {loopInfo && (
          <button
            className="btn-ghost w-full justify-center text-sm"
            onClick={() => loopVideoToAudio()}
            title="Loop the first video to cover the first audio track"
          >
            Loop Video to Audio
          </button>
        )}

        {loopInfo?.audioLonger && (
          <div className="rounded-md border border-accent/40 bg-accent/10 p-2 text-[12px] text-gray-200 leading-snug">
            <p className="mb-2">
              Audio is longer than video. Loop video {loopInfo.repetitions} times and trim the
              last to match.
            </p>
            <button
              className="btn-primary w-full justify-center"
              onClick={() => loopVideoToAudio()}
            >
              Loop Video to Audio
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="relative flex-1">
          <SearchIcon width={14} height={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="w-full bg-panel-sunken border border-panel-border rounded-md pl-7 pr-2 py-1 text-sm outline-none focus:border-accent"
            placeholder="Search media"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="bg-panel-sunken border border-panel-border rounded-md px-2 py-1 text-xs outline-none"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="recent">Recent</option>
          <option value="name">Name</option>
          <option value="kind">Type</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8 px-4">
            No media yet. Click <span className="text-accent">Import Media</span> or drop files here.
          </div>
        )}
        {filtered.map((asset) => (
          <MediaItem
            key={asset.id}
            asset={asset}
            onRemove={() => removeAsset(asset.id)}
            onRename={(name) => updateAsset(asset.id, { name })}
          />
        ))}
      </div>
    </div>
  );
}

function kindIcon(kind: MediaAsset['kind']) {
  if (kind === 'video') return <VideoIcon width={16} height={16} className="text-blue-400" />;
  if (kind === 'audio') return <MusicIcon width={16} height={16} className="text-green-400" />;
  return <ImageIcon width={16} height={16} className="text-purple-400" />;
}

function MediaItem({
  asset,
  onRemove,
  onRename,
}: {
  asset: MediaAsset;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const [thumb, setThumb] = useState<string | null>(asset.thumbnailPath ?? null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(asset.name);

  useEffect(() => {
    let active = true;
    if (asset.kind !== 'audio' && !asset.missing && !thumb) {
      window.editorApi.getThumbnail(asset.id, asset.path, 1).then((t) => {
        if (active && t) setThumb(t);
      });
    }
    return () => {
      active = false;
    };
  }, [asset.id, asset.path, asset.kind, asset.missing, thumb]);

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-asset-id', asset.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      className={`group flex items-center gap-2 p-1.5 rounded-md cursor-grab active:cursor-grabbing
        bg-panel-raised hover:bg-panel-border/60 border border-transparent hover:border-panel-border transition-colors
        ${asset.missing ? 'opacity-60 border-red-500/40' : ''}`}
      draggable={!asset.missing}
      onDragStart={onDragStart}
      title={asset.missing ? 'Media file not found' : asset.path}
    >
      <div className="h-10 w-14 shrink-0 rounded bg-panel-sunken overflow-hidden flex items-center justify-center">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          kindIcon(asset.kind)
        )}
      </div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            className="w-full bg-panel-sunken border border-accent rounded px-1 text-sm outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (name.trim()) onRename(name.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        ) : (
          <div
            className="text-sm truncate text-gray-200"
            onDoubleClick={() => setEditing(true)}
          >
            {asset.name}
          </div>
        )}
        <div className="text-[11px] text-gray-500 flex gap-2">
          <span className="uppercase">{asset.extension}</span>
          {asset.kind !== 'image' && asset.metadata.duration > 0 && (
            <span>{formatDuration(asset.metadata.duration)}</span>
          )}
          {asset.missing && <span className="text-red-400">missing</span>}
        </div>
      </div>
      <button
        className="icon-btn opacity-0 group-hover:opacity-100 shrink-0 h-7 w-7"
        onClick={onRemove}
        title="Remove from project"
      >
        <TrashIcon width={14} height={14} />
      </button>
    </div>
  );
}
