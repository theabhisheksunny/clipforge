/**
 * Embed the ClipForge icon (build/icon.ico) into the packaged Windows exe.
 *
 * Why this exists: electron-builder normally writes the app icon into the exe
 * during its combined "sign + edit executable" step. On a machine that cannot
 * extract electron-builder's winCodeSign package (its archive contains symlinks
 * that require Windows Developer Mode or admin to extract), that step is
 * disabled via `win.signAndEditExecutable: false`. This script performs just
 * the icon edit afterward, using the `rcedit` binary electron-builder already
 * cached — no signing, no winCodeSign extraction required.
 *
 * Usage:  node scripts/apply-win-icon.mjs
 * Run it after `electron-builder --dir --win` (or a full package) completes.
 *
 * On a normal dev/CI machine this script is unnecessary: remove
 * `signAndEditExecutable: false` from electron-builder.yml and electron-builder
 * will embed the icon itself.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const exePath = join(projectRoot, 'release', 'win-unpacked', 'ClipForge.exe');
const icoPath = join(projectRoot, 'build', 'icon.ico');

if (!existsSync(exePath)) {
  console.error(`Packaged exe not found: ${exePath}\nRun electron-builder --dir --win first.`);
  process.exit(1);
}
if (!existsSync(icoPath)) {
  console.error(`Icon not found: ${icoPath}`);
  process.exit(1);
}

/** Find the cached rcedit-x64.exe electron-builder downloaded. */
function findRcedit() {
  const cacheRoot = join(homedir(), 'AppData', 'Local', 'electron-builder', 'Cache');
  if (!existsSync(cacheRoot)) return null;
  const stack = [cacheRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) stack.push(full);
      else if (name.toLowerCase() === 'rcedit-x64.exe') return full;
    }
  }
  return null;
}

const rcedit = process.env.RCEDIT_PATH || findRcedit();
if (!rcedit) {
  console.error(
    'rcedit-x64.exe not found in the electron-builder cache.\n' +
      'Install it or set RCEDIT_PATH to a rcedit binary.',
  );
  process.exit(1);
}

console.log(`Embedding icon:\n  exe:    ${exePath}\n  icon:   ${icoPath}\n  rcedit: ${rcedit}`);
const res = spawnSync(rcedit, [exePath, '--set-icon', icoPath], { stdio: 'inherit' });
if (res.status !== 0) {
  console.error(`rcedit failed with code ${res.status}`);
  process.exit(res.status ?? 1);
}
console.log('Icon embedded into ClipForge.exe successfully.');
