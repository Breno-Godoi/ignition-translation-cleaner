export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface UdtOccurrence {
  name: string;
  path: string;
  pathSegments: string[];
  parentPathSegments: string[];
  sourceFile: string;
  definition: JsonObject;
  canonical: string;
}

export interface ParsedUdtFile {
  fileName: string;
  rootName: string | null;
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
  mergedRootName: string;
  udtParentPathsByName: Record<string, string[]>;
  differences: UdtDifference[];
  mergedUdts: JsonObject[];
  mergedFile: JsonObject;
}

const DEFAULT_MERGED_ROOT_NAME = "merged_udt_definitions";
const SYNTHETIC_ROOT_SEGMENTS = new Set(["_types_"]);

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cloneJsonObject = (value: JsonObject): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;

const isSyntheticRootSegment = (segment: string): boolean =>
  SYNTHETIC_ROOT_SEGMENTS.has(segment.toLowerCase());

const normalizePathSegments = (segments: string[]): string[] => {
  const filtered = segments.filter((segment) => segment.trim().length > 0);
  let firstRealIndex = 0;

  while (
    firstRealIndex < filtered.length &&
    isSyntheticRootSegment(filtered[firstRealIndex])
  ) {
    firstRealIndex += 1;
  }

  return filtered.slice(firstRealIndex);
};

const normalizeRootName = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || isSyntheticRootSegment(trimmed)) {
    return null;
  }

  return trimmed;
};

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
    const pathSegments = normalizePathSegments(currentPath);

    if (pathSegments.length === 0) {
      return;
    }

    output.push({
      name: nodeName,
      path: pathSegments.join("/"),
      pathSegments,
      parentPathSegments: pathSegments.slice(0, -1),
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
  const rootName = normalizeRootName(
    isJsonObject(parsed) && typeof parsed.name === "string"
      ? parsed.name
      : null,
  );

  if (Array.isArray(parsed)) {
    for (const node of parsed) {
      collectUdtOccurrences(node, [], fileName, udts);
    }
  } else {
    collectUdtOccurrences(parsed, [], fileName, udts);
  }

  return { fileName, rootName, udts };
};

const getTagsArray = (node: JsonObject): JsonValue[] => {
  if (Array.isArray(node.tags)) {
    return node.tags as JsonValue[];
  }
  node.tags = [];
  return node.tags as JsonValue[];
};

const ensureFolderChild = (
  parentNode: JsonObject,
  folderName: string,
): JsonObject => {
  const tags = getTagsArray(parentNode);

  for (const child of tags) {
    if (
      isJsonObject(child) &&
      child.tagType === "Folder" &&
      child.name === folderName
    ) {
      return child;
    }
  }

  const folder: JsonObject = {
    name: folderName,
    tagType: "Folder",
    tags: [],
  };

  tags.push(folder);
  return folder;
};

const nodeNameForSort = (node: JsonValue): string =>
  isJsonObject(node) && typeof node.name === "string" ? node.name : "";

const nodeIsFolder = (node: JsonValue): boolean =>
  isJsonObject(node) && node.tagType === "Folder";

const sortFolderTree = (node: JsonObject): void => {
  const tags = getTagsArray(node);

  for (const child of tags) {
    if (nodeIsFolder(child)) {
      sortFolderTree(child as JsonObject);
    }
  }

  tags.sort((left, right) => {
    const leftIsFolder = nodeIsFolder(left);
    const rightIsFolder = nodeIsFolder(right);

    if (leftIsFolder !== rightIsFolder) {
      return leftIsFolder ? -1 : 1;
    }

    return nodeNameForSort(left).localeCompare(nodeNameForSort(right));
  });
};

const relativeParentPathForRoot = (
  parentPathSegments: string[],
  mergedRootName: string,
): string[] => {
  const normalizedParentPathSegments = normalizePathSegments(parentPathSegments);
  if (normalizedParentPathSegments.length === 0) {
    return [];
  }

  if (normalizedParentPathSegments[0] === mergedRootName) {
    return normalizedParentPathSegments.slice(1);
  }

  return normalizedParentPathSegments;
};

const chooseMergedRootName = (files: ParsedUdtFile[]): string => {
  const candidateRoot = normalizeRootName(files[0].rootName);
  if (!candidateRoot) {
    return DEFAULT_MERGED_ROOT_NAME;
  }

  const referenceUdts = files[0].udts;
  if (referenceUdts.length === 0) {
    return candidateRoot;
  }

  const allReferenceUdtsShareCandidateRoot = referenceUdts.every(
    (udt) => udt.pathSegments[0] === candidateRoot,
  );

  if (!allReferenceUdtsShareCandidateRoot) {
    return DEFAULT_MERGED_ROOT_NAME;
  }

  return candidateRoot;
};

const chooseMergedParentPath = (
  occurrences: UdtOccurrence[],
  referenceFile: string,
  mergedRootName: string,
): string[] => {
  const byPath = new Map<
    string,
    {
      pathSegments: string[];
      count: number;
      hasReferenceOccurrence: boolean;
    }
  >();

  for (const occurrence of occurrences) {
    const normalizedParentPath = relativeParentPathForRoot(
      occurrence.parentPathSegments,
      mergedRootName,
    );
    const key = normalizedParentPath.join("/");

    if (!byPath.has(key)) {
      byPath.set(key, {
        pathSegments: normalizedParentPath,
        count: 0,
        hasReferenceOccurrence: false,
      });
    }

    const entry = byPath.get(key)!;
    entry.count += 1;
    if (occurrence.sourceFile === referenceFile) {
      entry.hasReferenceOccurrence = true;
    }
  }

  if (byPath.size === 0) {
    return [];
  }

  return Array.from(byPath.values())
    .sort((left, right) => {
      if (right.pathSegments.length !== left.pathSegments.length) {
        return right.pathSegments.length - left.pathSegments.length;
      }

      if (right.count !== left.count) {
        return right.count - left.count;
      }

      if (left.hasReferenceOccurrence !== right.hasReferenceOccurrence) {
        return left.hasReferenceOccurrence ? -1 : 1;
      }

      return left.pathSegments.join("/").localeCompare(right.pathSegments.join("/"));
    })[0].pathSegments;
};

export const buildMergedUdtFile = (
  mergedRootName: string,
  mergedByName: Map<string, JsonObject>,
  udtParentPathsByName: Record<string, string[]>,
): JsonObject => {
  const root: JsonObject = {
    name: mergedRootName.trim() || DEFAULT_MERGED_ROOT_NAME,
    tagType: "Folder",
    tags: [],
  };

  const sortedUdtNames = Array.from(mergedByName.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const udtName of sortedUdtNames) {
    const definition = mergedByName.get(udtName);
    if (!definition) {
      continue;
    }

    const parentPathSegments = udtParentPathsByName[udtName] ?? [];
    let containerNode = root;

    for (const pathSegment of parentPathSegments) {
      if (pathSegment.trim().length === 0) {
        continue;
      }

      containerNode = ensureFolderChild(containerNode, pathSegment);
    }

    getTagsArray(containerNode).push(cloneJsonObject(definition));
  }

  sortFolderTree(root);
  return root;
};

export const syncUdtDefinitions = (files: ParsedUdtFile[]): UdtSyncResult => {
  if (files.length === 0) {
    throw new Error("At least one UDT file is required.");
  }

  const fileNames = files.map((file) => file.fileName);
  const referenceFile = files[0].fileName;
  const mergedRootName = chooseMergedRootName(files);

  const udtsByName = new Map<string, UdtOccurrence[]>();
  const referenceByName = new Map<string, UdtOccurrence>();
  const udtParentPathsByName: Record<string, string[]> = {};

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
    udtParentPathsByName[name] = chooseMergedParentPath(
      occurrences,
      referenceFile,
      mergedRootName,
    );
  }

  const mergedUdts = Array.from(mergedByName.entries())
    .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
    .map(([, definition]) => cloneJsonObject(definition));

  const mergedFile = buildMergedUdtFile(
    mergedRootName,
    mergedByName,
    udtParentPathsByName,
  );

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
    mergedRootName,
    udtParentPathsByName,
    differences,
    mergedUdts,
    mergedFile,
  };
};
