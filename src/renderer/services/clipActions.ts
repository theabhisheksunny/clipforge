/**
 * Higher-level clip actions that span multiple store operations
 * (spec section 36 detach audio, section 11 audio editing).
 */

import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import { createClipFromAsset, createTrack } from '@shared/utils/factories';

/**
 * Detach a video clip's audio into a new clip on a dedicated audio track.
 * The video clip is muted; the audio clip references the same asset over the
 * same source window and can be moved/trimmed/deleted independently.
 */
export function detachAudio(clipId: string): void {
  const store = useProjectStore.getState();
  const project = store.project;
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return;
  const asset = project.mediaAssets.find((a) => a.id === clip.assetId);
  if (!asset || asset.kind !== 'video' || asset.metadata.audioStreams.length === 0) return;

  // Find or create an audio track.
  let audioTrack = project.tracks.find((t) => t.kind === 'audio');
  let audioTrackId: string;
  if (!audioTrack) {
    audioTrackId = store.addTrack('audio');
  } else {
    audioTrackId = audioTrack.id;
  }

  // Build the detached audio clip from the same asset/source window.
  const audioClip = createClipFromAsset({
    asset,
    trackId: audioTrackId,
    timelineStart: clip.timelineStart,
  });
  audioClip.sourceStart = clip.sourceStart;
  audioClip.sourceEnd = clip.sourceEnd;
  audioClip.timelineDuration = clip.timelineDuration;
  audioClip.speed = clip.speed;
  audioClip.audio = { ...clip.audio, muted: false };
  audioClip.detachedFromClipId = clip.id;

  // Mute the originating video clip and add the audio clip.
  store.updateClip(clipId, { audio: { ...clip.audio, muted: true } });
  // addClipFromAsset creates a fresh clip; instead push the prepared one.
  useProjectStore.setState((s) => {
    const draft = structuredClone(s.project);
    draft.clips.push(audioClip);
    draft.modifiedAt = Date.now();
    return {
      project: draft,
      past: [...s.past, s.project].slice(-100),
      future: [],
      dirty: true,
      canUndo: true,
      canRedo: false,
    };
  });

  useEditorStore.getState().selectClip(audioClip.id);
}

export { createTrack };
