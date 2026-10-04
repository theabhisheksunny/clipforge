# Loop Video to Audio, media:// protocol, concat graph, diagnostics, export validation

This branch ships the "Loop Video to Audio" feature plus the root-cause fixes it depends on: a privileged `media://` streaming protocol so the renderer can play local files under webSecurity + strict CSP, a rewrite of the base-track video compositing from overlay-enable to `concat`, a diagnostics screen with FFmpeg self-test, and post-export ffprobe validation surfaced in the export dialog. The loop itself is a pure planner (`planLoopVideoToAudio`) wired into a non-destructive store action that rebuilds the target tracks through `commit()` so undo works. Verification evidence (typecheck, 25 vitest tests incl. a real-ffmpeg integration test, electron-vite build, and a probed sample export) is recorded in `.agents/tasks/verification.md` and is consistent with the diff.

Watch for: a PiP-overlay scale regression — the per-clip `transform.scale` that the old graph applied to higher-track video clips is dropped in the new `videoProcessingSteps`, so PiP clips now always fill the canvas (confirmed). This is outside the loop feature but is a behavioral change bundled in the same diff. Everything the spec enumerates is implemented correctly.

**Verdict**: APPROVED

## High-level view

The `media://` scheme is registered privileged (standard/secure/stream/supportFetchAPI, `bypassCSP:false`) before app ready, with the streaming handler registered after ready. It resolves `media://local/<encoded>` back to an absolute path and streams with HTTP byte-range support for `<video>` seeking. The CSP in `index.html` adds `media:` to `img-src`/`media-src`, and `Preview.tsx` plus the image overlay now go through `editorApi.toMediaUrl`. `webSecurity`, `contextIsolation:true`, and `nodeIntegration:false` are untouched.

The filter graph now splits video tracks into a base track and overlay tracks. The base track's clips are each scaled+padded+SAR/fps-normalized and joined with `concat=n=N:v=1:a=0` instead of overlay-enable; overlay is retained for PiP, image, and text layers. Each clip placement is a distinct ffmpeg input, so the same source file placed N times is N inputs. A video clip contributes audio only when not muted and the asset actually has an audio stream; the final audio is normalized to 48kHz stereo before output.

`planLoopVideoToAudio` is a pure, dependency-free function returning per-repetition source/timeline windows with the last clip trimmed to match the audio (no trim on an exact multiple). The store action is non-destructive — it references the same video asset N times and places the audio once, clears and rebuilds only the target tracks inside a single `commit()` for atomic undo. The library control appears only when at least one video and one audio asset exist, and surfaces an auto-detected suggestion when the audio is longer.

Diagnostics (versions, FFmpeg/FFprobe path+status+version, temp/output dirs, Test FFmpeg) run entirely in main over IPC; the renderer carries no `child_process`/`fs`. Post-export validation re-probes the output, extends `RenderResult` with a `validation` block, fails the export if the output is malformed, and the export dialog surfaces the validated summary with raw ffmpeg output behind Show Details.

<details>
<summary>Issues (1)</summary>

1. **PiP overlay scale regression** — `videoProcessingSteps` scales every clip to full canvas and no longer applies `clip.transform.scale`, so higher-track PiP video clips that were previously shrunk now fill the frame. Out of scope for the loop feature but bundled here; restore `transform.scale` for overlay clips (base-track clips should stay full-canvas) in a follow-up.

</details>

<details>
<summary>Details</summary>

### media:// privileged streaming protocol

`registerMediaProtocolSchemes()` runs at module top level in `main.ts`, before `app.whenReady()`, which is the required ordering for `registerSchemesAsPrivileged` (confirmed). The handler is registered inside `whenReady`. Privileges are `standard/secure/supportFetchAPI/stream` with `bypassCSP:false` — the scheme does not bypass CSP; instead `index.html` adds `media:` to `img-src` and `media-src` (confirmed). `webSecurity` is not disabled and `contextIsolation`/`nodeIntegration` are unchanged (confirmed — not touched in the diff).

The encoding contract is shared between preload and main via `mediaUrl.ts`: `toMediaUrl` normalizes `\` to `/`, splits on `/`, `encodeURIComponent`s each segment, and rejoins — so spaces (the sample video filename has them) and reserved characters are escaped while slashes stay structural. `fromMediaUrl` reverses it from the URL pathname. With `standard:true`, `media://local/C%3A/...` parses with host `local` and pathname `/C:/...`; the handler strips leading slashes and decodes, yielding `C:/...`, which Node fs accepts (confirmed). Byte-range handling parses `bytes=start-end`, suffix ranges, and open-ended ranges, clamps to size, and returns `206` with `Content-Range`/`Accept-Ranges`; non-range requests return `200` with `Accept-Ranges: bytes`. Bad URLs → 400, missing/unstattable files → 404.

`Preview.tsx` replaces `file://${asset.path}` with `editorApi.toMediaUrl(asset.path)` and simplifies the src-change guard to a direct equality check; the image overlay guards against an undefined path before converting (confirmed).

### Base-track concat vs overlay

The graph groups video tracks, treating the lowest-order track as the base and the rest as overlays. Base clips are each processed (`scale=W:H:force_original_aspect_ratio=decrease`, `pad`, `setsar=1`, `fps`) and then combined with `[..]concat=n=N:v=1:a=0[vbase]` — matching the proven export command and the spec's requirement to use concat rather than overlay-enable for the sequential base track. When the base track has no clips, the lavfi color canvas is the base. PiP/image clips and text layers still composite via `overlay=...:enable='between(t,start,end)'` and `drawtext` on top. `canvas.fps` flows through `opts.fps` into both the lavfi source and each clip's `fps=` step (confirmed).

Distinct-input semantics are preserved: `registerVideoClip` pushes a fresh `-ss/-to/-i` per clip and records the input index per clip id, so the same source placed three times yields three `-i` entries — asserted by the new `concat=n=3` test (three identical `-i` paths, `concat=n=3:v=1:a=0` present, no `overlay=`).

The PiP scale regression lives here: the previous per-clip chain computed `targetW = round(W * clip.transform.scale)` and scaled to it. `videoProcessingSteps` always does `scale=W:H:decrease` + `pad`, dropping `transform.scale`. For the base track this is correct (full-frame sequence); for overlay/PiP clips it changes rendered size. The loop feature never uses PiP, so the feature and its tests are unaffected, but the bundled change alters existing PiP behavior.

### Audio: muted exclusion and 48kHz stereo normalization

A video clip's audio is emitted only when `!clip.audio.muted && asset.metadata.audioStreams.length > 0`, so a muted loop clip contributes no audio label at all. Dedicated audio-track clips are delayed to their timeline start and placed once (no looping). The final stage applies `aresample=48000,aformat=channel_layouts=stereo` to both the single-stream (`apad,...`) and multi-stream (`amix,...apad,...`) paths before `[aout]`. The new test confirms a lone muted clip yields `audioOutLabel === null` with no `a_<id>` label, and that an audible clip produces `[aout]` with `aresample=48000` and `aformat=channel_layouts=stereo` (confirmed). The muted-exclusion assertion matches the actual label format `a_${clip.id}`.

### planLoopVideoToAudio and the store action

The planner validates both durations are finite and positive (throwing otherwise), computes `repetitions = ceil(audio/video - EPS)`, and emits one clip per repetition with the last trimmed to `audio - (reps-1)*video`. On an exact multiple the trim evaluates to a full `videoDuration`, so no trim occurs. The unit tests cover the two verified pairs (60.033/138.024 → 3 reps, last ~17.9573; 17.42/143.81 → 9 reps, last ~4.45), the exact-multiple case (30/120 → 4 full clips), audio ≤ video → single clip, and the throwing cases (confirmed).

The store action resolves the first video and first audio asset (or the given ids), bails if either is missing or non-positive, then inside one `commit()` ensures a video and audio track exist, clears only those two tracks, pushes the N muted video clips all referencing the same `videoAsset.id`, and pushes one full-length unmuted audio clip. Because it funnels through `commit()`, the whole operation is a single undo step and remains non-destructive — only timeline references change, no file copies. The last video clip carries the trimmed `sourceEnd`/`timelineDuration` from the plan (confirmed).

The library computes `loopInfo` only when both a video and an audio asset exist with positive durations, which gates the "Loop Video to Audio" button on the "≥1 video AND ≥1 audio" rule. When the audio is longer it additionally renders the auto-detected suggestion panel stating the repetition count (confirmed).

### Diagnostics screen + IPC

`system.ipc.ts` registers `diagnostics` (app/electron versions, `verifyFfmpeg()` status, temp/output dirs from `bucketDir`) and `testFfmpeg` (runs a trivial `testsrc`→`null` lavfi command and reports success + version or stderr). `ffmpegLocator` now also returns `ffprobeVersion`, and `FfmpegStatus` was extended accordingly. The renderer dialog pulls everything over `editorApi.getDiagnostics()` / `testFfmpeg()` and renders path/status/version rows plus the test button; it imports no node modules. A grep of `src/renderer` for `child_process` and `fs` imports returns nothing (confirmed).

### Post-export validation

`validateOutput` re-probes the output and checks for a video stream, exactly one audio stream, duration within 1.0s of the graph's total (which equals the audio length for a loop export), a video-not-shorter-than-audio guard, and codec allowlists. `RenderResult` gains an optional `validation: RenderValidation`. If validation fails, the export returns `success:false` with the messages joined into `details` alongside ffmpeg stderr and reports an `error` stage; on success the validation block rides along. `ExportDialog` renders a "Validated: WxH, vcodec + acodec, N audio stream(s)" line when present, with raw output still behind Show Details (confirmed).

### Test coverage

filterGraph gains the `concat=n=3` + distinct-inputs test and the muted-exclusion + 48kHz-stereo test; the existing "same file twice = 2 inputs" test is retained. `loop.test.ts` adds the five planner cases. `loopExport.test.ts` is a genuine end-to-end test: it probes the two real sample files, runs the pure planner, builds clips exactly as the store action does (3 muted video clips referencing the same asset + 1 audio clip), calls the real `exportProject` (real `buildFilterGraph`/`buildEncoderConfig`/ffmpeg), re-probes the output asserting h264/1920×1080/aac/48000/stereo/single-audio-stream and duration within 1.0s, and asserts both originals are unmodified by sha1 + size before/after, cleaning up the output in `afterAll`. Verification records all 25 tests green including this one (~25.9s).

Not tested: the `media://` protocol handler (byte-range parsing, 206/200/400/404 branches) has no unit test — it's exercised only manually/at runtime. The PiP scale path has no regression test, which is how the scale drop went unflagged by the suite.

</details>

<details>
<summary>Files changed</summary>

- `src/main/main.ts` — register media scheme before ready, handler + system IPC after ready
- `src/main/services/media/mediaProtocol.ts` — privileged media:// scheme + byte-range streaming handler (new)
- `src/shared/utils/mediaUrl.ts` — shared toMediaUrl/fromMediaUrl encoding contract (new)
- `src/renderer/index.html` — CSP adds `media:` to img-src/media-src
- `src/renderer/components/preview/Preview.tsx` — file:// → toMediaUrl for video + image overlay
- `src/preload/preload.ts` — expose getDiagnostics/testFfmpeg/toMediaUrl
- `src/main/services/renderer/filterGraph.ts` — base-track concat, overlay for PiP/image/text, muted-audio exclusion, 48kHz stereo normalization
- `src/main/services/renderer/filterGraph.test.ts` — concat=n=3 + muted-exclusion/48k tests
- `src/shared/utils/loop.ts` — pure planLoopVideoToAudio (new)
- `src/shared/utils/loop.test.ts` — planner unit tests (new)
- `src/renderer/stores/projectStore.ts` — non-destructive loopVideoToAudio action via commit()
- `src/renderer/components/media-library/MediaLibrary.tsx` — loop control + auto-detect suggestion + failed-import surfacing
- `src/renderer/components/toolbar/Toolbar.tsx` — Diagnostics button
- `src/renderer/components/dialogs/DiagnosticsDialog.tsx` — diagnostics UI (new)
- `src/main/ipc/system.ipc.ts` — diagnostics + testFfmpeg IPC (new)
- `src/main/services/ffmpeg/ffmpegLocator.ts` — return ffprobeVersion
- `src/shared/types/ipc.ts` — DiagnosticsInfo/TestFfmpegResult, IPC channels, EditorApi additions
- `src/shared/types/render.ts` — RenderValidation, RenderResult.validation
- `src/main/services/renderer/rendererService.ts` — post-export validateOutput + fail-on-invalid
- `src/renderer/components/dialogs/ExportDialog.tsx` — surface validation summary
- `src/renderer/components/Icons.tsx` — SettingsIcon
- `tests/integration/loopExport.test.ts` — real end-to-end loop export test (new)
- `vitest.config.ts` — include integration tests

Full diff: `git -C "d:\PROJECT-FINAL\video editor\.worktrees\loop-video-to-audio" diff master`

</details>
