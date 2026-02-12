// src/utils/zipScanner.ts
import JSZip from 'jszip';

export interface ExtractedProjectTextFile {
  projectFileName: string;
  path: string;
  content: string;
}

const SEARCHABLE_TEXT_EXTENSIONS = [
  '.json',
  '.xml',
  '.py',
  '.sql',
  '.txt',
  '.yaml',
  '.yml',
  '.csv',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
];

export async function extractTextFilesFromZip(
  file: File,
): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(file);
  const textFiles: Record<string, string> = {};

  const entries = Object.keys(zip.files);

  for (const path of entries) {
    const zipEntry = zip.file(path);
    const lower = path.toLowerCase();

    if (zipEntry && SEARCHABLE_TEXT_EXTENSIONS.some(ext => lower.endsWith(ext))) {
      const content = await zipEntry.async('string');
      textFiles[path] = content;
    }
  }

  return textFiles;
}

export async function extractProjectTextFilesFromZip(
  file: File,
): Promise<ExtractedProjectTextFile[]> {
  const extractedByPath = await extractTextFilesFromZip(file);
  return Object.entries(extractedByPath).map(([path, content]) => ({
    projectFileName: file.name,
    path,
    content,
  }));
}

export function detectUsedKeys(
  files: Record<string, string>,
  keys: string[],
): Set<string> {
  const searchableKeys = Array.from(
    new Set(keys.filter((key) => key.trim().length > 0)),
  );
  const used = new Set<string>();

  for (const key of searchableKeys) {
    if (used.has(key)) {
      continue;
    }

    for (const content of Object.values(files)) {
      if (content.includes(key)) {
        used.add(key);
        break;
      }
    }
  }

  return used;
}

export function detectUsedKeysInProjectFiles(
  files: ExtractedProjectTextFile[],
  keys: string[],
): Set<string> {
  const byPath: Record<string, string> = {};

  for (const file of files) {
    const uniqueKey = `${file.projectFileName}:${file.path}`;
    byPath[uniqueKey] = file.content;
  }

  return detectUsedKeys(byPath, keys);
}
