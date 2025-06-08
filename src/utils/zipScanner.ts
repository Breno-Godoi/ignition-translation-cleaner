// src/utils/zipScanner.ts
import JSZip from 'jszip';

export async function extractTextFilesFromZip(
  file: File
): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(file);
  const textFiles: Record<string, string> = {};

  const validExtensions = ['.py', '.json', '.xml'];

  const entries = Object.keys(zip.files);

  for (const path of entries) {
    const zipEntry = zip.file(path);
    const lower = path.toLowerCase();

    if (zipEntry && validExtensions.some(ext => lower.endsWith(ext))) {
      const content = await zipEntry.async('string');
      textFiles[path] = content;
    }
  }

  return textFiles;
}

export function detectUsedKeys(
  files: Record<string, string>,
  keys: string[]
): Set<string> {
  const used = new Set<string>();

  for (const content of Object.values(files)) {
    for (const key of keys) {
      const regex = new RegExp(`\\b${key}\\b`);
      if (regex.test(content)) {
        used.add(key);
      }
    }
  }

  return used;
}
