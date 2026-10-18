import type { FirmwareLanguage } from './interpreter';
import type { LibrarySlot, ProjectLibrary } from '../avr/libraries/model';

export interface FirmwareFile {
  readonly name: string;
  readonly content: string;
}
export interface FirmwareProject {
  readonly language: FirmwareLanguage;
  readonly files: readonly FirmwareFile[];
  readonly activeName: string;
  /**
   * Declared Arduino libraries (`provided` ships in the toolchain or fetches
   * once, `custom:<id>` resolves against `slots`). Additive and optional, so
   * every project saved before libraries existed still loads byte-identical.
   */
  readonly libraries?: readonly ProjectLibrary[];
  /**
   * Custom library slot contents, carried with the project so saves, shares,
   * and gallery builds round-trip them. Paths keep their original casing.
   */
  readonly slots?: readonly LibrarySlot[];
}

export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 32 * 1024;
export const ENTRY_BY_LANGUAGE: Record<FirmwareLanguage, string> = {
  'arduino-cpp': 'main.ino',
  python: 'main.py',
};

const NAME_PATTERN = /^[a-z0-9_-]+\.(ino|cpp|h|py)$/;

export function toSingleFileProject(
  source: string,
  language: FirmwareLanguage,
  activeName?: string,
): FirmwareProject {
  const entry = ENTRY_BY_LANGUAGE[language];
  return { language, files: [{ name: entry, content: source }], activeName: activeName ?? entry };
}

export function validateFileName(name: string, language: FirmwareLanguage): string | null {
  if (!NAME_PATTERN.test(name))
    return `${name}: use lowercase letters, digits, - or _ with a valid extension`;
  if (language === 'python' ? !name.endsWith('.py') : name.endsWith('.py')) {
    return `${name}: wrong extension for ${language}`;
  }
  return null;
}

export function validateProject(project: FirmwareProject): string[] {
  const errors: string[] = [];
  if (project.files.length === 0) errors.push('project has no files');
  if (project.files.length > MAX_FILES) errors.push(`project has more than ${MAX_FILES} files`);
  const entry = ENTRY_BY_LANGUAGE[project.language];
  if (!project.files.some((file) => file.name === entry))
    errors.push(`${entry}: entry file is required`);
  if (!project.files.some((file) => file.name === project.activeName)) {
    errors.push(`${project.activeName}: active file is not in the project`);
  }
  const seen = new Set<string>();
  for (const file of project.files) {
    const bad = validateFileName(file.name, project.language);
    if (bad) errors.push(bad);
    if (seen.has(file.name)) errors.push(`${file.name}: duplicate file name`);
    seen.add(file.name);
    if (file.content.length > MAX_FILE_BYTES)
      errors.push(`${file.name}: file is larger than 32 KB`);
  }
  errors.push(...validateLibraryFields(project));
  return errors;
}

/**
 * Slot file paths keep their original casing: slots bypass NAME_PATTERN, so
 * `MyLib.h` is legal here while a tab of that name is not. Null means the
 * path is structurally sound (non-empty, relative, no parent escapes).
 */
export function validateSlotPath(path: string): string | null {
  if (path === '') return 'library file: path must not be empty';
  if (path.startsWith('/')) return `${path}: absolute paths are not allowed`;
  if (path.split('/').some((segment) => segment === '..')) return `${path}: .. is not allowed`;
  return null;
}

/*
 * Structural checks only (shapes a save or share link may carry, not whether
 * the names resolve — that stays in `validateLibraries`, at compile time).
 * Anything malformed reads as corrupt at load, the way a bad tab does today.
 */
function validateLibraryFields(project: FirmwareProject): string[] {
  const errors: string[] = [];
  if (project.libraries !== undefined) {
    if (!Array.isArray(project.libraries)) {
      errors.push('libraries: declarations must be a list');
    } else {
      for (const entry of project.libraries) {
        if (typeof entry !== 'object' || entry === null) {
          errors.push('libraries: every entry needs a name and a source');
          continue;
        }
        const declaration = entry as { name?: unknown; source?: unknown; version?: unknown };
        if (typeof declaration.name !== 'string' || declaration.name === '') {
          errors.push('libraries: every entry needs a non-empty name');
          continue;
        }
        if (
          declaration.source !== 'provided' &&
          declaration.source !== 'custom' &&
          declaration.source !== 'index'
        ) {
          errors.push(`<${declaration.name}>: unknown library source`);
          continue;
        }
        if (declaration.version !== undefined && typeof declaration.version !== 'string') {
          errors.push(`<${declaration.name}>: version must be text`);
        }
      }
    }
  }
  if (project.slots !== undefined) {
    if (!Array.isArray(project.slots)) {
      errors.push('slots: custom libraries must be a list');
    } else {
      for (const slot of project.slots) {
        if (typeof slot !== 'object' || slot === null) {
          errors.push('slots: every slot needs an id, a name, and files');
          continue;
        }
        const candidate = slot as { id?: unknown; name?: unknown; files?: unknown };
        if (
          typeof candidate.id !== 'string' ||
          candidate.id === '' ||
          typeof candidate.name !== 'string' ||
          candidate.name === ''
        ) {
          errors.push('slots: every slot needs a non-empty id and name');
          continue;
        }
        if (!Array.isArray(candidate.files)) {
          errors.push(`<${candidate.id}>: files must be a list`);
          continue;
        }
        for (const file of candidate.files) {
          if (typeof file !== 'object' || file === null) {
            errors.push(`<${candidate.id}>: every file needs a path and content`);
            continue;
          }
          const slotFile = file as { path?: unknown; content?: unknown };
          if (typeof slotFile.path !== 'string' || slotFile.path === '') {
            errors.push(`<${candidate.id}>: every file needs a non-empty path`);
            continue;
          }
          const badPath = validateSlotPath(slotFile.path);
          if (badPath) {
            errors.push(badPath);
            continue;
          }
          if (typeof slotFile.content !== 'string') {
            errors.push(`${slotFile.path}: content must be text`);
          } else if (slotFile.content.length > MAX_FILE_BYTES) {
            errors.push(`${slotFile.path}: file is larger than 32 KB`);
          }
        }
      }
    }
  }
  return errors;
}

export class FirmwareProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirmwareProjectError';
  }
}

export function addFile(project: FirmwareProject, name: string, content = ''): FirmwareProject {
  const bad = validateFileName(name, project.language);
  if (bad) throw new FirmwareProjectError(bad);
  if (project.files.some((f) => f.name === name))
    throw new FirmwareProjectError(`${name}: file already exists`);
  if (project.files.length >= MAX_FILES)
    throw new FirmwareProjectError(`project has more than ${MAX_FILES} files`);
  return { ...project, files: [...project.files, { name, content }], activeName: name };
}

export function removeFile(project: FirmwareProject, name: string): FirmwareProject {
  if (name === ENTRY_BY_LANGUAGE[project.language])
    throw new FirmwareProjectError(`${name}: entry file cannot be deleted`);
  const files = project.files.filter((f) => f.name !== name);
  return {
    ...project,
    files,
    activeName:
      project.activeName === name ? ENTRY_BY_LANGUAGE[project.language] : project.activeName,
  };
}

export function renameFile(project: FirmwareProject, from: string, to: string): FirmwareProject {
  if (from === ENTRY_BY_LANGUAGE[project.language])
    throw new FirmwareProjectError(`${from}: entry file cannot be renamed`);
  const bad = validateFileName(to, project.language);
  if (bad) throw new FirmwareProjectError(bad);
  if (project.files.some((f) => f.name === to))
    throw new FirmwareProjectError(`${to}: file already exists`);
  return {
    ...project,
    files: project.files.map((f) => (f.name === from ? { ...f, name: to } : f)),
    activeName: project.activeName === from ? to : project.activeName,
  };
}

export function updateFileContent(
  project: FirmwareProject,
  name: string,
  content: string,
): FirmwareProject {
  if (content.length > MAX_FILE_BYTES)
    throw new FirmwareProjectError(`${name}: file is larger than 32 KB`);
  return { ...project, files: project.files.map((f) => (f.name === name ? { ...f, content } : f)) };
}
