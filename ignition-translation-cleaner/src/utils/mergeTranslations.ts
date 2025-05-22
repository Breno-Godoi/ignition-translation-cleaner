// src/utils/mergeTranslations.ts

import type { TranslationTerm } from './xmlParser';

// export interface Conflict {
//   key: string;
//   values: string[];
// }

// interface MergeResult {
//   merged: TranslationTerm[];
//   conflicts: Conflict[];
// }

export function mergeTranslationFiles(
    files: TranslationTerm[][]
  ): {
    merged: TranslationTerm[];
    conflicts: { key: string; values: string[] }[];
  } {
    const keyMap: Map<string, Set<string>> = new Map();
  
    for (const fileTerms of files) {
      for (const term of fileTerms) {
        if (!keyMap.has(term.key)) {
          keyMap.set(term.key, new Set());
        }
        keyMap.get(term.key)!.add(term.text);
      }
    }
  
    const merged: TranslationTerm[] = [];
    const conflicts: { key: string; values: string[] }[] = [];
  
    for (const [key, texts] of keyMap.entries()) {
      const values = Array.from(texts);
      if (values.length === 1) {
        merged.push({ key, text: values[0] });
      } else {
        conflicts.push({ key, values });
      }
    }
  
    return { merged, conflicts };
  }