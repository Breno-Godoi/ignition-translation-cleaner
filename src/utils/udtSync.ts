export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface UdtOccurrence {
  name: string;
  path: string;
  sourceFile: string;
  definition: JsonObject;
  canonical: string;
}

export interface ParsedUdtFile {
  fileName: string;
  udts: UdtOccurrence[];
}

export interface UdtVariant {
  files: string[];
  paths: string[];
  examples: {
    fileName: string;
    path: string;
    definition: JsonObject;
  }[];
}

export interface UdtDifference {
  name: string;
  missingIn: string[];
  variants: UdtVariant[];
}

export interface UdtSyncResult {
  referenceFile: string;
  totalFiles: number;
  totalUniqueUdts: number;
  udtsWithDefinitionDifferences: number;
  udtsMissingInSomeFiles: number;
  differences: UdtDifference[];
  mergedUdts: JsonObject[];
  mergedFile: JsonObject;
}

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cloneJsonObject = (value: JsonObject): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;

export const normalizeJsonForDisplay = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeJsonForDisplay(item))
      .sort((a, b) =>
        canonicalizeJson(a as JsonValue).localeCompare(
          canonicalizeJson(b as JsonValue),
        ),
      );
  }

  if (isJsonObject(value)) {
    const normalizedObject: JsonObject = {};
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      normalizedObject[key] = normalizeJsonForDisplay(value[key]);
    }
    return normalizedObject;
  }

  return value;
};

const canonicalizeJson = (value: JsonValue): string => {
  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => canonicalizeJson(item))
      .sort((a, b) => a.localeCompare(b));
    return `[${normalizedItems.join(",")}]`;
  }

  if (isJsonObject(value)) {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    const serializedEntries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`,
    );
    return `{${serializedEntries.join(",")}}`;
  }

  return JSON.stringify(value);
};

const collectUdtOccurrences = (
  node: unknown,
  parentPath: string[],
  sourceFile: string,
  output: UdtOccurrence[],
): void => {
  if (!isJsonObject(node)) {
    return;
  }

  const nodeName = typeof node.name === "string" ? node.name : null;
  const currentPath = nodeName ? [...parentPath, nodeName] : parentPath;

  if (node.tagType === "UdtType" && nodeName) {
    output.push({
      name: nodeName,
      path: currentPath.join("/"),
      sourceFile,
      definition: cloneJsonObject(node),
      canonical: canonicalizeJson(node),
    });
  }

  const tags = node.tags;
  if (Array.isArray(tags)) {
    for (const child of tags) {
      collectUdtOccurrences(child, currentPath, sourceFile, output);
    }
  }
};

export const parseUdtFile = (
  fileName: string,
  fileContent: string,
): ParsedUdtFile => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw new Error(`Invalid JSON format in "${fileName}".`);
  }

  const udts: UdtOccurrence[] = [];

  if (Array.isArray(parsed)) {
    for (const node of parsed) {
      collectUdtOccurrences(node, [], fileName, udts);
    }
  } else {
    collectUdtOccurrences(parsed, [], fileName, udts);
  }

  return { fileName, udts };
};

export const syncUdtDefinitions = (files: ParsedUdtFile[]): UdtSyncResult => {
  if (files.length === 0) {
    throw new Error("At least one UDT file is required.");
  }

  const fileNames = files.map((file) => file.fileName);
  const referenceFile = files[0].fileName;

  const udtsByName = new Map<string, UdtOccurrence[]>();
  const referenceByName = new Map<string, UdtOccurrence>();

  for (const udt of files[0].udts) {
    if (!referenceByName.has(udt.name)) {
      referenceByName.set(udt.name, udt);
    }
  }

  for (const file of files) {
    for (const udt of file.udts) {
      if (!udtsByName.has(udt.name)) {
        udtsByName.set(udt.name, []);
      }
      udtsByName.get(udt.name)!.push(udt);
    }
  }

  const differences: UdtDifference[] = [];
  const mergedByName = new Map<string, JsonObject>();

  for (const [name, occurrences] of udtsByName.entries()) {
    const presentIn = new Set<string>();
    const variantsByCanonical = new Map<string, UdtOccurrence[]>();

    for (const occurrence of occurrences) {
      presentIn.add(occurrence.sourceFile);
      if (!variantsByCanonical.has(occurrence.canonical)) {
        variantsByCanonical.set(occurrence.canonical, []);
      }
      variantsByCanonical.get(occurrence.canonical)!.push(occurrence);
    }

    const missingIn = fileNames.filter((fileName) => !presentIn.has(fileName));
    const variants: UdtVariant[] = Array.from(variantsByCanonical.values()).map(
      (variantOccurrences) => ({
        files: Array.from(
          new Set(variantOccurrences.map((item) => item.sourceFile)),
        ).sort((a, b) => a.localeCompare(b)),
        paths: Array.from(
          new Set(
            variantOccurrences.map((item) => `${item.sourceFile}: ${item.path}`),
          ),
        ).sort((a, b) => a.localeCompare(b)),
        examples: Array.from(
          variantOccurrences.reduce((map, occurrence) => {
            if (!map.has(occurrence.sourceFile)) {
              map.set(occurrence.sourceFile, occurrence);
            }
            return map;
          }, new Map<string, UdtOccurrence>()).values(),
        )
          .sort((a, b) => a.sourceFile.localeCompare(b.sourceFile))
          .map((occurrence) => ({
            fileName: occurrence.sourceFile,
            path: occurrence.path,
            definition: normalizeJsonForDisplay(
              cloneJsonObject(occurrence.definition),
            ) as JsonObject,
          })),
      }),
    );

    variants.sort((a, b) =>
      a.files.join("|").localeCompare(b.files.join("|")),
    );

    if (missingIn.length > 0 || variants.length > 1) {
      differences.push({
        name,
        missingIn,
        variants,
      });
    }

    const chosenDefinition = referenceByName.get(name) ?? occurrences[0];
    mergedByName.set(name, cloneJsonObject(chosenDefinition.definition));
  }

  const mergedUdts = Array.from(mergedByName.entries())
    .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
    .map(([, definition]) => definition);

  const mergedFile: JsonObject = {
    name: "merged_udt_definitions",
    tagType: "Folder",
    tags: mergedUdts,
  };

  differences.sort((a, b) => a.name.localeCompare(b.name));

  return {
    referenceFile,
    totalFiles: files.length,
    totalUniqueUdts: udtsByName.size,
    udtsWithDefinitionDifferences: differences.filter(
      (difference) => difference.variants.length > 1,
    ).length,
    udtsMissingInSomeFiles: differences.filter(
      (difference) => difference.missingIn.length > 0,
    ).length,
    differences,
    mergedUdts,
    mergedFile,
  };
};
