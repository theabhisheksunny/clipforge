import { useEditorStore, type MediaPanelTab } from '../../stores/editorStore';
import { MediaLibrary } from '../media-library/MediaLibrary';
import { TextPanel } from './TextPanel';
import { TransitionsPanel } from './TransitionsPanel';
import { CanvasPanel } from './CanvasPanel';
import {
  VideoIcon,
  MusicIcon,
  TextIcon,
  ImageIcon,
  EffectsIcon,
  TransitionIcon,
  CanvasIcon,
} from '../Icons';

const TABS: { id: MediaPanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'media', label: 'Media', icon: <VideoIcon width={16} height={16} /> },
  { id: 'audio', label: 'Audio', icon: <MusicIcon width={16} height={16} /> },
  { id: 'text', label: 'Text', icon: <TextIcon width={16} height={16} /> },
  { id: 'images', label: 'Images', icon: <ImageIcon width={16} height={16} /> },
  { id: 'canvas', label: 'Canvas', icon: <CanvasIcon width={16} height={16} /> },
  { id: 'effects', label: 'Effects', icon: <EffectsIcon width={16} height={16} /> },
  { id: 'transitions', label: 'Transitions', icon: <TransitionIcon width={16} height={16} /> },
];

export function LeftPanel() {
  const activeTab = useEditorStore((s) => s.activeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-panel-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex flex-col items-center gap-0.5 px-3 py-2 text-[10px] whitespace-nowrap transition-colors
              ${activeTab === t.id ? 'text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-gray-200'}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {(activeTab === 'media' || activeTab === 'audio' || activeTab === 'images') && <MediaLibrary />}
        {activeTab === 'text' && <TextPanel />}
        {activeTab === 'canvas' && <CanvasPanel />}
        {activeTab === 'transitions' && <TransitionsPanel />}
        {activeTab === 'effects' && (
          <div className="p-4 text-sm text-gray-500 text-center mt-8">
            Effects: use the Inspector transform, crop, speed, and opacity controls on a selected clip.
          </div>
        )}
      </div>
    </div>
  );
}
