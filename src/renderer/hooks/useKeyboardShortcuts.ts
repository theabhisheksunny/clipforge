import { useEffect } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import { usePlaybackStore } from '../stores/playbackStore';

/** Professional editing shortcuts (spec section 24). */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea.
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) {
        return;
      }

      const project = useProjectStore.getState();
      const editor = useEditorStore.getState();
      const playback = usePlaybackStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      // Undo / Redo
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) project.redo();
        else project.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        project.redo();
        return;
      }

      // Copy / Paste / Duplicate
      if (mod && e.key.toLowerCase() === 'c') {
        const clip = project.project.clips.find((c) => c.id === editor.selectedClipId);
        if (clip) editor.setClipboard({ ...clip });
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        const clip = editor.clipboard;
        if (clip) {
          const id = project.duplicateClip(clip.id) ?? null;
          if (!id) {
            // Clipboard clip may not be on timeline anymore; re-add a copy.
          }
        }
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (editor.selectedClipId) project.duplicateClip(editor.selectedClipId);
        return;
      }

      // Save
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('app:save'));
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          playback.togglePlay();
          break;
        case 's':
        case 'S':
          if (!mod && editor.selectedClipId) {
            e.preventDefault();
            project.splitClipAt(editor.selectedClipId, playback.currentTime);
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (editor.selectedClipId) {
            e.preventDefault();
            project.removeClip(editor.selectedClipId);
            editor.clearSelection();
          } else if (editor.selectedTextId) {
            e.preventDefault();
            project.removeTextLayer(editor.selectedTextId);
            editor.clearSelection();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          playback.seekBy(e.shiftKey ? -1 / 30 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          playback.seekBy(e.shiftKey ? 1 / 30 : 1);
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
