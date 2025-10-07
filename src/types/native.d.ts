// src\types\native.d.ts

export {};

declare global {
  interface Window {
    native?: {
      openFiles: (opts?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string[]>;
      saveAs: (opts?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<{ canceled: boolean; filePath: string | null }>;
      writeTextFile: (filePath: string, text: string) => Promise<{ ok: boolean }>;
    };
  }
}
