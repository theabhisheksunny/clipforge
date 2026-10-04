/**
 * Project persistence (spec sections 22, 30, 39).
 *
 * Projects are saved as JSON *.vedit files containing editing metadata only —
 * original media is referenced by absolute path, never embedded. On load,
 * assets are checked for existence and flagged `missing` for relinking.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PROJECT_FILE_VERSION } from '@shared/types';
import type { Project, ProjectFile } from '@shared/types';
import { autosavePath } from '../cache/cachePaths';

export function serializeProject(project: Project): string {
  const file: ProjectFile = {
    version: PROJECT_FILE_VERSION,
    project: { ...project, modifiedAt: Date.now() },
  };
  return JSON.stringify(file, null, 2);
}

function markMissingAssets(project: Project): Project {
  return {
    ...project,
    mediaAssets: project.mediaAssets.map((a) => ({
      ...a,
      missing: !existsSync(a.path),
    })),
  };
}

export function saveProjectToPath(project: Project, path: string): void {
  writeFileSync(path, serializeProject(project), 'utf-8');
}

export function loadProjectFromPath(path: string): ProjectFile {
  const raw = readFileSync(path, 'utf-8');
  let parsed: ProjectFile;
  try {
    parsed = JSON.parse(raw) as ProjectFile;
  } catch {
    throw new Error('The project file is corrupted or not a valid .vedit file.');
  }
  if (!parsed.project || typeof parsed.version !== 'number') {
    throw new Error('The project file is missing required data.');
  }
  // Future migrations keyed on parsed.version would run here.
  const project = markMissingAssets(parsed.project);
  return { version: parsed.version, project, savedPath: path };
}

export function writeAutosave(project: Project): void {
  try {
    writeFileSync(autosavePath(), serializeProject(project), 'utf-8');
  } catch (err) {
    console.error('Autosave failed:', (err as Error).message);
  }
}

export function readAutosave(): ProjectFile | null {
  const path = autosavePath();
  if (!existsSync(path)) return null;
  try {
    return loadProjectFromPath(path);
  } catch {
    return null;
  }
}

export function hasRecovery(): boolean {
  return existsSync(autosavePath());
}
