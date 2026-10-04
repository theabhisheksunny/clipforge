import { useCallback } from 'react';
import { useContextMenuStore } from '../ContextMenu';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { usePlaybackStore } from '../../stores/playbackStore';
import { detachAudio } from '../../services/clipActions';

/** Builds and shows the right-click context menu for a clip (spec section 34). */
export function useClipContextMenu(clipId: string) {
  const show = useContextMenuStore((s) => s.show);

  return useCallback(
    (x: number, y: number) => {
      const store = useProjectStore.getState();
      const editor = useEditorStore.getState();
      const playback = usePlaybackStore.getState();
      const clip = store.project.clips.find((c) => c.id === clipId);
      if (!clip) return;

      show(x, y, [
        {
          label: 'Copy',
          onClick: () => editor.setClipboard({ ...clip }),
        },
        {
          label: 'Duplicate',
          onClick: () => store.duplicateClip(clipId),
        },
        {
          label: 'Split at Playhead',
          onClick: () => store.splitClipAt(clipId, playback.currentTime),
        },
        { separator: true, label: '' },
        {
          label: clip.audio.muted ? 'Unmute' : 'Mute',
          onClick: () => store.updateClip(clipId, { audio: { ...clip.audio, muted: !clip.audio.muted } }),
        },
        {
          label: 'Detach Audio',
          onClick: () => detachAudio(clipId),
        },
        { separator: true, label: '' },
        {
          label: 'Delete',
          danger: true,
          onClick: () => store.removeClip(clipId),
        },
      ]);
    },
    [clipId, show],
  );
}
