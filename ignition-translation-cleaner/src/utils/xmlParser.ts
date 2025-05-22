// src/utils/xmlParser.ts
import { XMLParser } from 'fast-xml-parser';

export interface TranslationTerm {
  key: string;
  text: string;
}

export function parseTranslationXML(xmlContent: string): TranslationTerm[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
  });

  const json = parser.parse(xmlContent);

  const termsRaw = json.translation?.term ?? [];

  const terms: TranslationTerm[] = Array.isArray(termsRaw)
    ? termsRaw.map((term: { key: string; text?: string }) => ({
        key: term.key,
        text: term.text || '',
      }))
    : [{
        key: termsRaw.key,
        text: termsRaw.text || '',
      }];

  return terms;
}
