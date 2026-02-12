// src/utils/xmlParser.ts
import { XMLParser } from 'fast-xml-parser';

export interface TranslationTerm {
  key: string;
  text: string;
}

export interface ParsedTranslationDocument {
  terms: TranslationTerm[];
  locale: string | null;
  comment: string | null;
}

const LOCALE_COMMENT_PATTERN = /Locale:\s*([A-Za-z0-9_-]+)/i;

export function parseTranslationDocument(
  xmlContent: string,
): ParsedTranslationDocument {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
  });

  const json = parser.parse(xmlContent);
  const entries = json.properties?.entry;
  const commentRaw = json.properties?.comment;
  const comment = typeof commentRaw === 'string' ? commentRaw : null;
  const localeMatch = comment?.match(LOCALE_COMMENT_PATTERN);
  const locale = localeMatch?.[1] ?? null;

  if (!entries) {
    return {
      terms: [],
      locale,
      comment,
    };
  }

  const normalizedEntries = Array.isArray(entries) ? entries : [entries];
  const terms = normalizedEntries.map((entry: { key: string; '#text': string }) => ({
    key: entry.key,
    text: entry['#text'] ?? '',
  }));

  return {
    terms,
    locale,
    comment,
  };
}

export function parseTranslationXML(xmlContent: string): TranslationTerm[] {
  return parseTranslationDocument(xmlContent).terms;
}
  
