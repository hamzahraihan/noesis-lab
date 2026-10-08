import type { FirmwareLanguage } from './interpreter';

export interface FirmwareFile { readonly name: string; readonly content: string }
export interface FirmwareProject {
  readonly language: FirmwareLanguage;
  readonly files: readonly FirmwareFile[];
  readonly activeName: string;
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
  if (!NAME_PATTERN.test(name)) return `${name}: use lowercase letters, digits, - or _ with a valid extension`;
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
  if (!project.files.some((file) => file.name === entry)) errors.push(`${entry}: entry file is required`);
  if (!project.files.some((file) => file.name === project.activeName)) {
    errors.push(`${project.activeName}: active file is not in the project`);
  }
  const seen = new Set<string>();
  for (const file of project.files) {
    const bad = validateFileName(file.name, project.language);
    if (bad) errors.push(bad);
    if (seen.has(file.name)) errors.push(`${file.name}: duplicate file name`);
    seen.add(file.name);
    if (file.content.length > MAX_FILE_BYTES) errors.push(`${file.name}: file is larger than 32 KB`);
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
  if (project.files.some((f) => f.name === name)) throw new FirmwareProjectError(`${name}: file already exists`);
  if (project.files.length >= MAX_FILES) throw new FirmwareProjectError(`project has more than ${MAX_FILES} files`);
  return { ...project, files: [...project.files, { name, content }], activeName: name };
}

export function removeFile(project: FirmwareProject, name: string): FirmwareProject {
  if (name === ENTRY_BY_LANGUAGE[project.language]) throw new FirmwareProjectError(`${name}: entry file cannot be deleted`);
  const files = project.files.filter((f) => f.name !== name);
  return { ...project, files, activeName: project.activeName === name ? ENTRY_BY_LANGUAGE[project.language] : project.activeName };
}

export function renameFile(project: FirmwareProject, from: string, to: string): FirmwareProject {
  if (from === ENTRY_BY_LANGUAGE[project.language]) throw new FirmwareProjectError(`${from}: entry file cannot be renamed`);
  const bad = validateFileName(to, project.language);
  if (bad) throw new FirmwareProjectError(bad);
  if (project.files.some((f) => f.name === to)) throw new FirmwareProjectError(`${to}: file already exists`);
  return {
    ...project,
    files: project.files.map((f) => (f.name === from ? { ...f, name: to } : f)),
    activeName: project.activeName === from ? to : project.activeName,
  };
}

export function updateFileContent(project: FirmwareProject, name: string, content: string): FirmwareProject {
  if (content.length > MAX_FILE_BYTES) throw new FirmwareProjectError(`${name}: file is larger than 32 KB`);
  return { ...project, files: project.files.map((f) => (f.name === name ? { ...f, content } : f)) };
}
