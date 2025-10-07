// src/utils/xmlBuilder.ts

import type { TranslationTerm } from "./xmlParser";

export function buildTranslationXML(terms: TranslationTerm[]): string {
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">\n<properties>\n  <comment>Locale: en</comment>\n`;
  const entries = terms
    .map((term) => `  <entry key="${term.key}">${escapeXml(term.text)}</entry>`)
    .join("\n");
  const footer = `\n</properties>`;

  return header + entries + footer;
}

// Handles special XML characters
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
