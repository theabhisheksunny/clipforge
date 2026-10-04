# ClipForge

A modern, cross-platform desktop video editor built with **Electron + React + TypeScript**, using **FFmpeg** for all media processing. Editing is fully non-destructive: original files are never modified, and the timeline stores editing instructions that are translated into an FFmpeg filter graph only at export time.

Import → Edit → Preview → Export.

---

## Features

**Media**
- Import video, audio, and images (drag-and-drop or dialog)
- The same source file can be imported and placed multiple times as independent clips
- Media library with search, sort, rename, and remove
- Thumbnails and audio waveforms generated asynchronously and cached

**Timeline (non-destructive)**
- Drag media onto the timeline, reorder, and move clips
- Resize clip edges to trim start/end
- Split clips at the playhead
- Duplicate and delete clips
- Multiple video and audio tracks
- Snapping to clip boundaries, zoom, and scroll
- Visible playhead, time ruler, thumbnails, and waveforms

**Clip editing (Inspector)**
- Transform: position, scale, rotation, flip, opacity
- Crop (top/bottom/left/right)
- Speed (0.25x–4x and presets)
- Audio: volume, mute, fade in/out
- Detach audio from a video clip onto its own track

**Overlays**
- Image overlays with position, scale, rotation, opacity
- Text overlays (titles, captions, watermarks) with font size, weight, color, alignment

**Transitions** between adjacent clips: fade, cross dissolve, slide, zoom, wipe

**Playback preview** of the full timeline with play/pause, frame step, seek, and volume

**Project**
- New / Open / Save / Save As to a `.vedit` JSON project file (media referenced by path, not embedded)
- Autosave every 30 seconds with crash recovery
- Missing-media detection and relinking
- Undo / Redo across all edits

**Export**
- Resolutions: 480p, 720p, 1080p, 1440p, 4K
- Formats: MP4, WebM
- Video codecs: H.264, H.265/HEVC, VP9
- Audio codecs: AAC, Opus, or none
- FPS: source / 24 / 30 / 60
- Quality presets (low/medium/high) or custom CRF
- Live progress with ETA, output size, and cancel
- Friendly errors with a "Show Details" FFmpeg log

---

## Requirements

- **Node.js 18+** (developed on Node 24)
- **FFmpeg + FFprobe** — bundled automatically via `ffmpeg-static` and `ffprobe-static`, so no manual install is required for development or packaged builds.

---

## Development setup

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite renderer dev server and launches Electron against it with hot reload.

Other scripts:

| Script | Purpose |
| --- | --- |
| `npm run typecheck` | Strict type check of renderer and main/preload |
| `npm run build` | Type check + production bundle into `dist/` |
| `npm test` | Run the unit test suite (Vitest) |
| `npm run package:win` | Build and package a Windows installer |
| `npm run package:mac` | Build and package a macOS DMG |
| `npm run package:linux` | Build and package Linux AppImage + deb |

---

## FFmpeg setup and bundling

FFmpeg is the primary media-processing engine. FFprobe extracts metadata (duration, resolution, FPS, codecs, streams, bitrate, sample rate, channels, aspect ratio).

**Resolution order** (see `src/main/services/ffmpeg/ffmpegLocator.ts`):

1. Explicit override via `FFMPEG_PATH` / `FFPROBE_PATH` environment variables
2. Bundled binaries from `ffmpeg-static` / `ffprobe-static`
3. System `PATH`

On startup the app verifies both binaries by running `-version`. If either is unavailable, a friendly in-app banner explains how to fix it rather than crashing.

**Packaging:** the binaries must live on disk (not inside the Electron `asar`) so they can be spawned as child processes. `electron-builder.yml` lists them under `asarUnpack`, and the locator rewrites `app.asar` → `app.asar.unpacked` at runtime. This is verified in the packaged output under `resources/app.asar.unpacked/node_modules`.

**Licensing:** `ffmpeg-static` ships an FFmpeg build under its respective license (LGPL/GPL depending on the build). If you distribute the application, review and comply with FFmpeg licensing for your target platforms.

---

## Architecture

Strict separation between the Electron main process (Node, heavy work) and the React renderer (UI only). The renderer never has Node access; it talks to main exclusively through a validated preload bridge (`window.editorApi`).

```
src/
  main/                     Electron main process
    main.ts                 Window, secure webPreferences, menu, startup
    ipc/                    Typed, validated IPC handlers
      media.ipc.ts
      project.ipc.ts
      render.ipc.ts
    services/
      ffmpeg/               Binary detection + process runner (progress, cancel)
      media/                ffprobe metadata, thumbnails, waveforms, import
      project/              .vedit save/load, autosave, recovery
      renderer/             Timeline → FFmpeg filter graph → export
      cache/                Temp/cache directory management
  preload/
    preload.ts              contextBridge exposing window.editorApi
  renderer/                 React app (UI only)
    App.tsx
    components/             media-library, preview, timeline, inspector,
                            toolbar, panels, dialogs
    stores/                 Zustand: projectStore (+undo/redo), editorStore,
                            playbackStore
    hooks/                  selectors, keyboard shortcuts
    services/               higher-level clip actions
  shared/                   Code shared by main + renderer
    types/                  domain model (Project, MediaAsset, TimelineClip, …)
    constants/
    utils/                  pure timeline operations (unit tested) + factories
```

### Non-destructive model

A `TimelineClip` references a `MediaAsset` by id and stores `sourceStart` / `sourceEnd` (the in/out points within the original file) plus `timelineStart` / `timelineDuration` (where it sits on the timeline), along with transform, crop, speed, and audio properties. Trimming, splitting, and duplicating only change these numbers — never the source file. The same asset can back many independent clips.

### Security

- `contextIsolation: true`, `nodeIntegration: false`
- All privileged work behind the preload bridge with payload validation
- Content Security Policy in `index.html`
- New-window and external-navigation blocking in the main process

---

## Rendering pipeline

`RendererService.exportProject` (`src/main/services/renderer/`) builds the FFmpeg command:

1. A canvas-sized base layer (`lavfi` color source) for the full duration.
2. Each clip becomes an input, trimmed with `-ss`/`-to` (images use `-loop 1 -t`), then scaled/cropped/flipped/rotated/opacity-adjusted and overlaid onto the base, timed with `enable='between(t, start, end)'`.
3. Text layers drawn with `drawtext`, timed the same way.
4. Audio from video clips and dedicated audio tracks is delayed to its timeline position, with volume/fade/speed applied, then mixed with `amix`.
5. Encoder settings (resolution, codec, CRF, FPS) are derived from the export dialog.

Each clip is tracked by a distinct FFmpeg input index, so a source file imported multiple times is handled as separate inputs.

Preview does **not** invoke FFmpeg on every scrub: it uses a `<video>` element seeked to the active clip's source time with DOM-composited overlays, keeping the UI responsive.

---

## Testing

```bash
npm test
```

Unit tests cover the pure timeline operations (split, trim, duplicate, speed, reflow, snap) and the filter-graph input indexing. Because the timeline logic is pure, it is tested without launching Electron or FFmpeg.

For full end-to-end verification with real media, run the app (`npm run dev`), import sample clips, build a timeline, and export — then confirm the output has the expected streams and duration.

---

## Known limitations / roadmap

- Export renders the whole project in a single FFmpeg pass. Very large/long projects would benefit from a segmented concat + proxy-media pipeline.
- Transitions are modeled and stored; the export graph applies fades and dissolves — richer transition types can be extended in `filterGraph.ts`.
- Future extensibility: color correction, keyframes, filters, GPU-accelerated encoding, AI editing.

---

## License

MIT. FFmpeg binaries are distributed under their own license — review FFmpeg licensing before redistribution.
