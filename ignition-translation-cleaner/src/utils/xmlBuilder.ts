// src/utils/xmlBuilder.ts
import type { TranslationTerm } from './xmlParser';

export const buildTranslationXML = (terms: TranslationTerm[]): string => {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n<translations>\n';
  const xmlFooter = '</translations>';
  const xmlBody = terms
    .map(term => `  <term key="${term.key}">${term.text}</term>`)
    .join('\n');
  return `${xmlHeader}${xmlBody}\n${xmlFooter}`;
};
