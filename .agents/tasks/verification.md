# Verification — Loop Video to Audio + Root-Cause Fixes

Iteration: FIRST (no `.agents/tasks/review.json` present at start).
Branch: `feat/loop-video-to-audio`
Worktree: `d:\PROJECT-FINAL\video editor\.worktrees\loop-video-to-audio`

Dependencies were installed in the worktree (`npm install`) because it did not have its own
`node_modules`; the bundled binaries are present:
- `node_modules\ffmpeg-static\ffmpeg.exe` → ffmpeg 6.1.1
- `node_modules\ffprobe-static\bin\win32\x64\ffprobe.exe` → ffprobe 4.0.2

## 1. Typecheck

Command:

```
npm run typecheck
# tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json
```

Result: PASS (exit 0). No errors under strict / noUnusedLocals / noUnusedParameters.
No `any` added, `webSecurity` not disabled, strictness unchanged.

## 2. Unit + integration tests

Command:

```
npx vitest run
```

Result: PASS — 4 files, 25 tests.

```
 ✓ src/shared/utils/loop.test.ts (5 tests)
 ✓ src/main/services/renderer/filterGraph.test.ts (7 tests)
 ✓ src/shared/utils/timeline.test.ts (12 tests)
 ✓ tests/integration/loopExport.test.ts (1 test)   ~25.9s (real ffmpeg)
 Test Files  4 passed (4)
      Tests  25 passed (25)
```

Breakdown vs. the baseline 17:
- 12 existing timeline tests — unchanged, green.
- 5 filterGraph tests → now 7 (kept "same file twice = 2 distinct inputs"; added
  `concat=n=3` for three sequential base-track clips, and muted-video audio exclusion +
  48kHz-stereo normalization).
- 5 new `planLoopVideoToAudio` unit tests.
- 1 new real integration test (runs ffmpeg against the real sample files).

The integration test (`tests/integration/loopExport.test.ts`) exercises the REAL path:
real `probeMediaMetadata` on both files → `planLoopVideoToAudio` → clips built as the store
action builds them (3 muted video clips referencing the SAME asset + 1 full audio clip) →
real `exportProject` (real `buildFilterGraph` + `buildEncoderConfig` + real ffmpeg) → real
`probeMediaMetadata` on the output. It asserts codecs/resolution/duration/stream-count and
that the two originals are UNMODIFIED (sha1 + size before/after), then deletes the output.

## 3. Build

Command:

```
npx electron-vite build
```

Result: PASS (exit 0).

```
dist/main/main.js        47.32 kB
dist/preload/preload.cjs  3.84 kB
dist/renderer/index.html  0.65 kB  (+ assets)
```

## ffprobe output of the generated MP4

Produced with the proven command shape (concat of 3 base clips + the mp3 audio, normalized
to 48kHz stereo), probed with the bundled ffprobe:

```
[STREAM]
index=0
codec_name=h264
codec_type=video
width=1920
height=1080
r_frame_rate=30/1
[/STREAM]
[STREAM]
index=1
codec_name=aac
codec_type=audio
sample_rate=48000
channels=2
[/STREAM]
[FORMAT]
duration=138.034000
[/FORMAT]
```

## Measured values

| Metric                | Value                         |
|-----------------------|-------------------------------|
| Video duration        | 60.033333 s                   |
| Audio duration        | 138.024 s                     |
| Repetitions           | 3                             |
| Final video clip dur. | ~17.9573 s (138.024 − 2×60.033333) |
| Final audio clip dur. | 138.024 s (single, not looped)|
| Output resolution     | 1920×1080                     |
| Output fps            | 30                            |
| Output video codec    | h264                          |
| Output audio codec    | aac, 48000 Hz, stereo (1 stream) |
| Output duration       | 138.034 s (within 1.0 s of 138.024) |
| Export status         | success, validation.ok = true |

Originals confirmed UNMODIFIED by the integration test (sha1 + size unchanged). The generated
MP4 is removed in the test's `afterAll`; the ad-hoc verification MP4 was also deleted.

## Forbidden changes — confirmed NOT made

- No strictness weakening; no `any` added to silence errors.
- `webSecurity` left enabled; `contextIsolation:true`, `nodeIntegration:false` unchanged.
- No physical duplication of the video; the audio is placed once (no looping).
- The two original source files are untouched.
