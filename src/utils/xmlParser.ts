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
    const entries = json.properties?.entry;
  
    if (!entries) return [];
  
    if (Array.isArray(entries)) {
      return entries.map((e: { key: string; '#text': string }) => ({
        key: e.key,
        text: e['#text'] ?? '',
      }));
    }
  
    return [{
      key: entries.key,
      text: entries['#text'] ?? '',
    }];
  }
  
