import React, { useMemo, useState } from "react";
import {
  buildMergedUdtFile,
  normalizeJsonForDisplay,
  parseUdtFile,
  syncUdtDefinitions,
  type JsonObject,
  type JsonValue,
  type ParsedUdtFile,
  type UdtDifference,
  type UdtSyncResult,
} from "../utils/udtSync";

interface JsonRenderLine {
  text: string;
  path: string;
}

interface RenderedJsonLine extends JsonRenderLine {
  changed: boolean;
}

interface VariantPathDetail {
  path: string;
  otherVariantIndexes: number[];
}

interface VariantDifferenceDetail {
  missingProperties: VariantPathDetail[];
  unequalValues: VariantPathDetail[];
}

interface DifferenceInspection {
  normalizedVariantDefinitions: JsonValue[];
  mismatchPaths: Set<string>;
  variantDifferenceDetails: VariantDifferenceDetail[];
  missingPropertyCount: number;
  unequalValueCount: number;
  isMissingOnlyDefinitionDifference: boolean;
}

const MISSING_JSON_VALUE = Symbol("missing-json-value");
type ComparableJsonValue = JsonValue | typeof MISSING_JSON_VALUE;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const escapeJsonPointerToken = (token: string): string =>
  token.replace(/~/g, "~0").replace(/\//g, "~1");

const comparableToCanonical = (value: ComparableJsonValue): string =>
  value === MISSING_JSON_VALUE ? "__missing__" : JSON.stringify(value);

const addVariantRelation = (
  target: Map<string, Set<number>>,
  path: string,
  variantIndexes: number[],
): void => {
  if (path.length === 0) {
    return;
  }

  if (!target.has(path)) {
    target.set(path, new Set<number>());
  }

  const existing = target.get(path)!;
  for (const variantIndex of variantIndexes) {
    existing.add(variantIndex);
  }
};

const mapToVariantPathDetails = (
  source: Map<string, Set<number>>,
): VariantPathDetail[] =>
  Array.from(source.entries())
    .map(([path, indexes]) => ({
      path,
      otherVariantIndexes: Array.from(indexes).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

const formatPathSegments = (segments: string[]): string => {
  if (segments.length === 0) {
    return "(root)";
  }

  let label = "";
  for (const segment of segments) {
    if (segment.startsWith("[")) {
      label += segment;
      continue;
    }
    label += label.length > 0 ? `.${segment}` : segment;
  }

  return label;
};

const ARRAY_MATCH_KEYS = ["name", "eventid", "eventId", "id", "key"] as const;

const findArrayMatchKey = (arrays: JsonValue[][]): string | null => {
  for (const candidateKey of ARRAY_MATCH_KEYS) {
    let isValid = true;

    for (const arrayValue of arrays) {
      const seenValues = new Set<string>();

      for (const item of arrayValue) {
        if (!isJsonObject(item) || typeof item[candidateKey] !== "string") {
          isValid = false;
          break;
        }

        const keyValue = item[candidateKey];
        if (seenValues.has(keyValue)) {
          isValid = false;
          break;
        }
        seenValues.add(keyValue);
      }

      if (!isValid) {
        break;
      }
    }

    if (isValid) {
      return candidateKey;
    }
  }

  return null;
};

const getArrayItemByKey = (
  arrayValue: JsonValue[],
  keyField: string,
  keyValue: string,
): JsonValue | typeof MISSING_JSON_VALUE => {
  for (const item of arrayValue) {
    if (isJsonObject(item) && item[keyField] === keyValue) {
      return item as JsonValue;
    }
  }
  return MISSING_JSON_VALUE;
};

const analyzeVariantDifferences = (
  values: JsonValue[],
): VariantDifferenceDetail[] => {
  const missingMaps = values.map(() => new Map<string, Set<number>>());
  const unequalMaps = values.map(() => new Map<string, Set<number>>());

  const compareAtPath = (
    pathSegments: string[],
    pathValues: ComparableJsonValue[],
  ): void => {
    const presentVariantIndexes: number[] = [];
    const missingVariantIndexes: number[] = [];

    pathValues.forEach((value, variantIndex) => {
      if (value === MISSING_JSON_VALUE) {
        missingVariantIndexes.push(variantIndex);
      } else {
        presentVariantIndexes.push(variantIndex);
      }
    });

    const pathLabel = formatPathSegments(pathSegments);

    if (
      pathSegments.length > 0 &&
      missingVariantIndexes.length > 0 &&
      presentVariantIndexes.length > 0
    ) {
      for (const missingVariantIndex of missingVariantIndexes) {
        addVariantRelation(
          missingMaps[missingVariantIndex],
          pathLabel,
          presentVariantIndexes,
        );
      }
      return;
    }

    const presentValues = presentVariantIndexes.map(
      (variantIndex) => pathValues[variantIndex] as JsonValue,
    );
    if (presentValues.length === 0) {
      return;
    }

    if (presentValues.every((value) => isJsonObject(value))) {
      const keys = new Set<string>();
      for (const objectValue of presentValues as JsonObject[]) {
        Object.keys(objectValue).forEach((key) => keys.add(key));
      }

      for (const key of Array.from(keys).sort((a, b) => a.localeCompare(b))) {
        const keyValues = pathValues.map((value) => {
          if (!isJsonObject(value) || !(key in value)) {
            return MISSING_JSON_VALUE;
          }
          return value[key] as JsonValue;
        });

        const nextPathSegments =
          key === "tags" ? pathSegments : [...pathSegments, key];
        compareAtPath(nextPathSegments, keyValues);
      }
      return;
    }

    if (presentValues.every((value) => Array.isArray(value))) {
      const presentArrays = presentValues as JsonValue[][];
      const arrayMatchKey = findArrayMatchKey(presentArrays);

      if (arrayMatchKey) {
        const keyValues = new Set<string>();
        for (const arrayValue of presentArrays) {
          for (const item of arrayValue) {
            keyValues.add((item as JsonObject)[arrayMatchKey] as string);
          }
        }

        for (const keyValue of Array.from(keyValues).sort((a, b) => a.localeCompare(b))) {
          const childValues = pathValues.map((value) => {
            if (!Array.isArray(value)) {
              return MISSING_JSON_VALUE;
            }
            return getArrayItemByKey(value, arrayMatchKey, keyValue);
          });

          const nextSegment =
            arrayMatchKey === "name" ? keyValue : `${arrayMatchKey}=${keyValue}`;
          compareAtPath([...pathSegments, nextSegment], childValues);
        }
        return;
      }

      const maxLength = Math.max(...presentArrays.map((arrayValue) => arrayValue.length));
      for (let index = 0; index < maxLength; index += 1) {
        const childValues = pathValues.map((value) => {
          if (!Array.isArray(value) || index >= value.length) {
            return MISSING_JSON_VALUE;
          }
          return value[index] as JsonValue;
        });
        compareAtPath([...pathSegments, `[${index}]`], childValues);
      }
      return;
    }

    if (pathSegments.length === 0) {
      return;
    }

    const canonicalByVariant = pathValues.map((value) =>
      comparableToCanonical(value),
    );

    for (const variantIndex of presentVariantIndexes) {
      const differentFrom = presentVariantIndexes.filter(
        (otherVariantIndex) =>
          otherVariantIndex !== variantIndex &&
          canonicalByVariant[otherVariantIndex] !==
            canonicalByVariant[variantIndex],
      );

      if (differentFrom.length > 0) {
        addVariantRelation(unequalMaps[variantIndex], pathLabel, differentFrom);
      }
    }
  };

  const rootNameCounts = new Map<string, number>();
  for (const value of values) {
    if (isJsonObject(value) && typeof value.name === "string") {
      rootNameCounts.set(value.name, (rootNameCounts.get(value.name) ?? 0) + 1);
    }
  }

  const rootPathSegments =
    rootNameCounts.size > 0
      ? [
          Array.from(rootNameCounts.entries()).sort((a, b) => {
            if (b[1] !== a[1]) {
              return b[1] - a[1];
            }
            return a[0].localeCompare(b[0]);
          })[0][0],
        ]
      : [];

  compareAtPath(rootPathSegments, values);

  return values.map((_, variantIndex) => ({
    missingProperties: mapToVariantPathDetails(missingMaps[variantIndex]),
    unequalValues: mapToVariantPathDetails(unequalMaps[variantIndex]),
  }));
};

const deepCloneJsonObject = (value: JsonObject): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;

const inspectDifference = (difference: UdtDifference): DifferenceInspection => {
  const normalizedVariantDefinitions = difference.variants.map(
    (variant) =>
      normalizeJsonForDisplay(
        (variant.examples[0]?.definition ?? {}) as JsonObject,
      ) as JsonValue,
  );

  const mismatchPaths =
    difference.variants.length > 1
      ? collectMismatchPaths(normalizedVariantDefinitions)
      : new Set<string>();

  const variantDifferenceDetails =
    difference.variants.length > 1
      ? analyzeVariantDifferences(normalizedVariantDefinitions)
      : difference.variants.map(() => ({
          missingProperties: [] as VariantPathDetail[],
          unequalValues: [] as VariantPathDetail[],
        }));

  const missingPropertyCount = variantDifferenceDetails.reduce(
    (total, item) => total + item.missingProperties.length,
    0,
  );
  const unequalValueCount = variantDifferenceDetails.reduce(
    (total, item) => total + item.unequalValues.length,
    0,
  );

  return {
    normalizedVariantDefinitions,
    mismatchPaths,
    variantDifferenceDetails,
    missingPropertyCount,
    unequalValueCount,
    isMissingOnlyDefinitionDifference:
      difference.variants.length > 1 &&
      missingPropertyCount > 0 &&
      unequalValueCount === 0,
  };
};

const mergeJsonValuesByUnion = (values: JsonValue[]): JsonValue => {
  if (values.length === 0) {
    return null;
  }

  if (values.every((value) => isJsonObject(value))) {
    const objectValues = values as JsonObject[];
    const mergedObject: JsonObject = {};
    const keys = new Set<string>();

    for (const objectValue of objectValues) {
      Object.keys(objectValue).forEach((key) => keys.add(key));
    }

    for (const key of Array.from(keys).sort((a, b) => a.localeCompare(b))) {
      const childValues = objectValues
        .filter((objectValue) => key in objectValue)
        .map((objectValue) => objectValue[key] as JsonValue);

      mergedObject[key] = mergeJsonValuesByUnion(childValues);
    }

    return mergedObject;
  }

  if (values.every((value) => Array.isArray(value))) {
    const arrayValues = values as JsonValue[][];
    const arrayMatchKey = findArrayMatchKey(arrayValues);

    if (arrayMatchKey) {
      const keyValues = new Set<string>();

      for (const arrayValue of arrayValues) {
        for (const item of arrayValue) {
          if (isJsonObject(item) && typeof item[arrayMatchKey] === "string") {
            keyValues.add(item[arrayMatchKey] as string);
          }
        }
      }

      return Array.from(keyValues)
        .sort((a, b) => a.localeCompare(b))
        .map((keyValue) => {
          const itemValues = arrayValues
            .map((arrayValue) => getArrayItemByKey(arrayValue, arrayMatchKey, keyValue))
            .filter(
              (value): value is JsonValue => value !== MISSING_JSON_VALUE,
            );

          return mergeJsonValuesByUnion(itemValues);
        });
    }

    const uniqueItems = new Map<string, JsonValue>();

    for (const arrayValue of arrayValues) {
      for (const item of arrayValue) {
        const canonical = JSON.stringify(item);
        if (!uniqueItems.has(canonical)) {
          uniqueItems.set(canonical, item);
        }
      }
    }

    return Array.from(uniqueItems.entries())
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([, item]) => item);
  }

  return values[0];
};

const buildUnionMergedDefinition = (
  difference: UdtDifference,
): JsonObject | null => {
  const definitions = difference.variants.flatMap((variant) =>
    variant.examples.map((example) => example.definition as JsonValue),
  );

  if (definitions.length === 0) {
    return null;
  }

  const merged = mergeJsonValuesByUnion(definitions);
  if (!isJsonObject(merged)) {
    return null;
  }

  return merged as JsonObject;
};

const collectMismatchPaths = (values: JsonValue[]): Set<string> => {
  const mismatchPaths = new Set<string>();

  const compareAtPath = (
    path: string,
    pathValues: ComparableJsonValue[],
  ): void => {
    const canonicalValues = new Set(
      pathValues.map((value) => comparableToCanonical(value)),
    );
    if (canonicalValues.size <= 1) {
      return;
    }

    if (path.length > 0) {
      mismatchPaths.add(path);
    }

    const presentValues = pathValues.filter(
      (value): value is JsonValue => value !== MISSING_JSON_VALUE,
    );
    if (presentValues.length === 0) {
      return;
    }

    if (presentValues.every((value) => isJsonObject(value))) {
      const keys = new Set<string>();
      for (const objectValue of presentValues as JsonObject[]) {
        Object.keys(objectValue).forEach((key) => keys.add(key));
      }

      for (const key of Array.from(keys).sort((a, b) => a.localeCompare(b))) {
        const keyPath = `${path}/${escapeJsonPointerToken(key)}`;
        const keyValues = pathValues.map((value) => {
          if (!isJsonObject(value) || !(key in value)) {
            return MISSING_JSON_VALUE;
          }
          return value[key] as JsonValue;
        });
        compareAtPath(keyPath, keyValues);
      }
      return;
    }

    if (presentValues.every((value) => Array.isArray(value))) {
      const maxLength = Math.max(
        ...(presentValues as JsonValue[][]).map((arrayValue) => arrayValue.length),
      );
      for (let index = 0; index < maxLength; index += 1) {
        const indexPath = `${path}/${index}`;
        const indexValues = pathValues.map((value) => {
          if (!Array.isArray(value) || index >= value.length) {
            return MISSING_JSON_VALUE;
          }
          return value[index] as JsonValue;
        });
        compareAtPath(indexPath, indexValues);
      }
    }
  };

  compareAtPath("", values);
  return mismatchPaths;
};

const pathIsMismatched = (path: string, mismatchPaths: Set<string>): boolean => {
  if (path.length === 0 || mismatchPaths.size === 0) {
    return false;
  }

  for (const mismatchPath of mismatchPaths) {
    if (
      mismatchPath === path ||
      mismatchPath.startsWith(`${path}/`) ||
      path.startsWith(`${mismatchPath}/`)
    ) {
      return true;
    }
  }

  return false;
};

const stringifyJsonLines = (
  value: JsonValue,
  path: string,
  indentLevel: number,
): JsonRenderLine[] => {
  const indent = "  ".repeat(indentLevel);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [{ text: `${indent}[]`, path }];
    }

    const lines: JsonRenderLine[] = [{ text: `${indent}[`, path }];
    const childIndent = "  ".repeat(indentLevel + 1);

    value.forEach((item, index) => {
      const childPath = `${path}/${index}`;
      const childLines = stringifyJsonLines(item, childPath, indentLevel + 1);

      if (childLines.length === 1) {
        lines.push({
          text: `${childIndent}${childLines[0].text.trimStart()}${
            index < value.length - 1 ? "," : ""
          }`,
          path: childLines[0].path,
        });
        return;
      }

      lines.push({
        text: `${childIndent}${childLines[0].text.trimStart()}`,
        path: childLines[0].path,
      });
      lines.push(...childLines.slice(1, childLines.length - 1));

      const childClosingLine = childLines[childLines.length - 1];
      lines.push({
        text: `${childClosingLine.text}${index < value.length - 1 ? "," : ""}`,
        path: childClosingLine.path,
      });
    });

    lines.push({ text: `${indent}]`, path });
    return lines;
  }

  if (isJsonObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [{ text: `${indent}{}`, path }];
    }

    const lines: JsonRenderLine[] = [{ text: `${indent}{`, path }];
    const propertyIndent = "  ".repeat(indentLevel + 1);

    entries.forEach(([key, childValue], index) => {
      const keyPath = `${path}/${escapeJsonPointerToken(key)}`;
      const childLines = stringifyJsonLines(childValue, keyPath, indentLevel + 1);
      const suffix = index < entries.length - 1 ? "," : "";

      if (childLines.length === 1) {
        lines.push({
          text: `${propertyIndent}${JSON.stringify(key)}: ${childLines[0].text.trimStart()}${suffix}`,
          path: keyPath,
        });
        return;
      }

      lines.push({
        text: `${propertyIndent}${JSON.stringify(key)}: ${childLines[0].text.trimStart()}`,
        path: keyPath,
      });
      lines.push(...childLines.slice(1, childLines.length - 1));

      const childClosingLine = childLines[childLines.length - 1];
      lines.push({
        text: `${childClosingLine.text}${suffix}`,
        path: childClosingLine.path,
      });
    });

    lines.push({ text: `${indent}}`, path });
    return lines;
  }

  return [{ text: `${indent}${JSON.stringify(value)}`, path }];
};

const renderJsonWithHighlights = (
  definition: JsonObject,
  mismatchPaths: Set<string>,
): { jsonText: string; lines: RenderedJsonLine[] } => {
  const normalizedDefinition = normalizeJsonForDisplay(definition) as JsonValue;
  const jsonText = JSON.stringify(normalizedDefinition, null, 2);
  const lines = stringifyJsonLines(normalizedDefinition, "", 0).map((line) => ({
    ...line,
    changed: pathIsMismatched(line.path, mismatchPaths),
  }));
  return { jsonText, lines };
};

const formatDifferencePathLabel = (path: string): string => path || "(root)";

const splitPathSegments = (path: string): string[] =>
  path.split("/").filter((segment) => segment.length > 0);

const formatUdtPathForDisplay = (path: string): string => {
  const segments = splitPathSegments(path);
  return segments.length > 0 ? segments.join(" / ") : "(root)";
};

const formatParentFolderPathForDisplay = (path: string): string => {
  const segments = splitPathSegments(path);
  if (segments.length <= 1) {
    return "(root)";
  }
  return segments.slice(0, -1).join(" / ");
};

const formatVariantReferenceList = (
  variantIndexes: number[],
  variants: { files: string[] }[],
): string => {
  const labels = variantIndexes
    .map((variantIndex) => variants[variantIndex]?.files.join(", "))
    .filter((label): label is string => Boolean(label));

  if (labels.length > 0) {
    return labels.join(" | ");
  }

  return variantIndexes.map((variantIndex) => `${variantIndex + 1}`).join(", ");
};

const pluralize = (
  count: number,
  singular: string,
  plural: string,
): string => (count === 1 ? singular : plural);

const MAX_VARIANT_DETAIL_ROWS = 8;

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below.
    }
  }

  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textArea);
    return copied;
  } catch {
    return false;
  }
};

const SyncUdtDefinitions: React.FC = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [syncResult, setSyncResult] = useState<UdtSyncResult | null>(null);
  const [syncLog, setSyncLog] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [expandedDifferences, setExpandedDifferences] = useState<Set<string>>(
    new Set(),
  );
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | null>(null);
  const [showDifferenceGlossary, setShowDifferenceGlossary] =
    useState<boolean>(false);
  const [showDebugTools, setShowDebugTools] = useState<boolean>(false);
  const [unionMergeSelections, setUnionMergeSelections] = useState<Set<string>>(
    new Set(),
  );

  const resetOutput = () => {
    setSyncResult(null);
    setSyncLog("");
    setErrorMessage("");
    setExpandedDifferences(new Set());
    setCopiedSnippetId(null);
    setUnionMergeSelections(new Set());
    setShowDifferenceGlossary(false);
  };

  const expandDifference = (differenceName: string) => {
    setExpandedDifferences((previous) => {
      if (previous.has(differenceName)) {
        return previous;
      }
      const updated = new Set(previous);
      updated.add(differenceName);
      return updated;
    });
  };

  const collapseDifference = (differenceName: string) => {
    setExpandedDifferences((previous) => {
      if (!previous.has(differenceName)) {
        return previous;
      }
      const updated = new Set(previous);
      updated.delete(differenceName);
      return updated;
    });
  };

  const collapseAllDifferences = () => {
    setExpandedDifferences(new Set());
  };

  const differenceInspectionByName = useMemo(() => {
    const map = new Map<string, DifferenceInspection>();

    if (!syncResult) {
      return map;
    }

    for (const difference of syncResult.differences) {
      map.set(difference.name, inspectDifference(difference));
    }

    return map;
  }, [syncResult]);

  const toggleUnionMergeSelection = (
    differenceName: string,
    enabled: boolean,
  ) => {
    setUnionMergeSelections((previous) => {
      const updated = new Set(previous);
      if (enabled) {
        updated.add(differenceName);
      } else {
        updated.delete(differenceName);
      }
      return updated;
    });
  };

  const mergedFileForDownload = useMemo(() => {
    if (!syncResult) {
      return null;
    }

    const mergedByName = new Map<string, JsonObject>();

    for (const definition of syncResult.mergedUdts) {
      if (typeof definition.name === "string" && definition.name.length > 0) {
        mergedByName.set(definition.name, deepCloneJsonObject(definition));
      }
    }

    for (const difference of syncResult.differences) {
      if (!unionMergeSelections.has(difference.name)) {
        continue;
      }

      const inspection = differenceInspectionByName.get(difference.name);
      if (!inspection?.isMissingOnlyDefinitionDifference) {
        continue;
      }

      const unionDefinition = buildUnionMergedDefinition(difference);
      if (!unionDefinition || typeof unionDefinition.name !== "string") {
        continue;
      }

      mergedByName.set(unionDefinition.name, deepCloneJsonObject(unionDefinition));
    }

    return buildMergedUdtFile(
      syncResult.mergedRootName,
      mergedByName,
      syncResult.udtParentPathsByName,
    );
  }, [syncResult, unionMergeSelections, differenceInspectionByName]);

  const appliedUnionMergeCount = useMemo(() => {
    if (!syncResult) {
      return 0;
    }

    return syncResult.differences.filter((difference) => {
      if (!unionMergeSelections.has(difference.name)) {
        return false;
      }

      const inspection = differenceInspectionByName.get(difference.name);
      return Boolean(inspection?.isMissingOnlyDefinitionDifference);
    }).length;
  }, [syncResult, unionMergeSelections, differenceInspectionByName]);

  const formatDifferenceSummary = (
    difference: UdtDifference,
    inspection?: DifferenceInspection,
  ): string => {
    const sections: string[] = [];

    if (difference.variants.length > 1) {
      const acrossFiles = difference.variants
        .map((variant) => variant.files.join(", "))
        .join(" | ");

      if (inspection) {
        if (inspection.unequalValueCount > 0 && inspection.missingPropertyCount > 0) {
          sections.push(
            `definition mismatch (missing properties + unequal values) across ${acrossFiles}`,
          );
        } else if (inspection.unequalValueCount > 0) {
          sections.push(`definition mismatch (unequal values) across ${acrossFiles}`);
        } else if (inspection.missingPropertyCount > 0) {
          sections.push(
            `definition mismatch (missing properties only) across ${acrossFiles}`,
          );
        } else {
          sections.push(`definition mismatch across ${acrossFiles}`);
        }
      } else {
        sections.push(`definition mismatch across ${acrossFiles}`);
      }
    }

    if (difference.missingIn.length > 0) {
      sections.push(
        `missing in ${difference.missingIn.join(", ")}`,
      );
    }

    return sections.join(" - ");
  };

  const handleCopySnippet = async (snippetId: string, jsonText: string) => {
    const copied = await copyTextToClipboard(jsonText);
    if (!copied) {
      setErrorMessage("Could not copy JSON to clipboard.");
      return;
    }

    setCopiedSnippetId(snippetId);
    window.setTimeout(() => {
      setCopiedSnippetId((current) => (current === snippetId ? null : current));
    }, 1500);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) {
      return;
    }

    const newFiles = Array.from(event.target.files);
    const uniqueFiles = [...files];

    for (const newFile of newFiles) {
      const alreadyAdded = uniqueFiles.some(
        (file) => file.name === newFile.name && file.size === newFile.size,
      );
      if (!alreadyAdded) {
        uniqueFiles.push(newFile);
      }
    }

    setFiles(uniqueFiles);
    resetOutput();
    event.target.value = "";
  };

  const handleSyncUdts = async () => {
    if (files.length === 0) {
      return;
    }

    setErrorMessage("");
    setSyncResult(null);
    setExpandedDifferences(new Set());
    setCopiedSnippetId(null);
    setUnionMergeSelections(new Set());
    setShowDifferenceGlossary(false);

    const parsedFiles: ParsedUdtFile[] = [];
    for (const file of files) {
      try {
        const content = await file.text();
        parsedFiles.push(parseUdtFile(file.name, content));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : `Failed to parse "${file.name}".`;
        setErrorMessage(message);
        return;
      }
    }

    const foundUdts = parsedFiles.reduce((count, file) => count + file.udts.length, 0);
    if (foundUdts === 0) {
      setErrorMessage(
        "No UDT definitions were found. Make sure the files are Ignition UDT definition exports.",
      );
      return;
    }

    const result = syncUdtDefinitions(parsedFiles);
    setSyncResult(result);

    const logOutput = [
      `Reference file: ${result.referenceFile}`,
      `Files synced: ${result.totalFiles}`,
      `Unique UDT names found: ${result.totalUniqueUdts}`,
      `UDTs with definition differences: ${result.udtsWithDefinitionDifferences}`,
      `UDTs missing in some files: ${result.udtsMissingInSomeFiles}`,
      `Merged UDT definitions: ${result.mergedUdts.length}`,
    ].join("\n");

    setSyncLog(logOutput);
  };

  const handleDownloadMergedUdts = async () => {
    if (!syncResult || !mergedFileForDownload) {
      return;
    }

    const jsonContent = JSON.stringify(mergedFileForDownload, null, 2);

    if (window.native?.saveAs && window.native?.writeTextFile) {
      const { canceled, filePath } = await window.native.saveAs({
        title: "Save merged UDT definitions",
        defaultPath: "merged_udt_definitions.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (!canceled && filePath) {
        await window.native.writeTextFile(filePath, jsonContent);
      }
      return;
    }

    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "merged_udt_definitions.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadUdtDebugData = async () => {
    if (!syncResult) {
      return;
    }

    const differencesDebug = syncResult.differences.map((difference) => {
      const normalizedVariantDefinitions = difference.variants.map(
        (variant) =>
          normalizeJsonForDisplay(
            (variant.examples[0]?.definition ?? {}) as JsonObject,
          ) as JsonValue,
      );

      const mismatchPaths =
        difference.variants.length > 1
          ? Array.from(collectMismatchPaths(normalizedVariantDefinitions)).sort(
              (a, b) => a.localeCompare(b),
            )
          : [];

      const variantDifferenceDetails =
        difference.variants.length > 1
          ? analyzeVariantDifferences(normalizedVariantDefinitions)
          : difference.variants.map(() => ({
              missingProperties: [] as VariantPathDetail[],
              unequalValues: [] as VariantPathDetail[],
            }));

      const variantCards = difference.variants.flatMap((variant, variantIndex) =>
        variant.examples.map((example, exampleIndex) => {
          const renderedSnippet = renderJsonWithHighlights(
            example.definition,
            new Set<string>(mismatchPaths),
          );

          return {
            variantIndex,
            exampleIndex,
            fileName: example.fileName,
            path: example.path,
            variantFiles: variant.files,
            jsonText: renderedSnippet.jsonText,
            renderedLines: renderedSnippet.lines,
          };
        }),
      );

      return {
        name: difference.name,
        summary: formatDifferenceSummary(
          difference,
          differenceInspectionByName.get(difference.name),
        ),
        missingIn: difference.missingIn,
        variants: difference.variants,
        normalizedVariantDefinitions,
        mismatchPaths,
        variantDifferenceDetails,
        variantCards,
      };
    });

    const debugPayload = {
      generatedAt: new Date().toISOString(),
      uploadedFiles: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      })),
      syncLog,
      expandedDifferences: Array.from(expandedDifferences.values()),
      syncResult,
      differencesDebug,
    };

    const jsonContent = JSON.stringify(debugPayload, null, 2);
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");
    const defaultFileName = `udt_sync_debug_${timestamp}.json`;

    if (window.native?.saveAs && window.native?.writeTextFile) {
      const { canceled, filePath } = await window.native.saveAs({
        title: "Save UDT sync debug data",
        defaultPath: defaultFileName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (!canceled && filePath) {
        await window.native.writeTextFile(filePath, jsonContent);
      }
      return;
    }

    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultFileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-4 text-center">
        <label htmlFor="udt-json-files" className="form-label fw-semibold">
          Upload UDT Definition JSON files
        </label>
        <div className="text-center">
          <div className="mb-3">
            <input
              id="udt-json-files"
              type="file"
              className="d-none"
              accept=".json,application/json"
              multiple
              onChange={handleFileChange}
            />
            <label htmlFor="udt-json-files" className="btn btn-primary">
              Upload JSON Files
            </label>
          </div>

          {files.length > 0 && (
            <div className="mt-3 text-start mx-auto" style={{ maxWidth: "500px" }}>
              <ul className="list-group">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="list-group-item d-flex justify-content-between align-items-center"
                  >
                    <span className="text-truncate" style={{ maxWidth: "80%" }}>
                      {file.name}
                    </span>
                    <button
                      className="btn btn-close btn-sm"
                      style={{ padding: "0.5rem" }}
                      aria-label="Remove file"
                      onClick={() => {
                        const updatedFiles = files.filter(
                          (_, fileIndex) => fileIndex !== index,
                        );
                        setFiles(updatedFiles);
                        resetOutput();
                      }}
                    ></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="d-flex flex-column align-items-center">
        <button
          className="btn btn-primary mb-3"
          onClick={handleSyncUdts}
          disabled={files.length === 0}
        >
          Sync UDTs
        </button>

        {syncLog && (
          <pre
            className="text-start bg-body-secondary text-body p-3 border rounded"
            style={{ maxWidth: "600px", width: "100%" }}
          >
            {syncLog}
          </pre>
        )}
      </div>

      <div className="d-flex justify-content-end mb-3">
        <div className="form-check form-switch text-body-secondary opacity-75">
          <input
            className="form-check-input"
            type="checkbox"
            id="udt-debug-tools-toggle"
            checked={showDebugTools}
            onChange={(event) => setShowDebugTools(event.target.checked)}
          />
          <label
            className="form-check-label small"
            htmlFor="udt-debug-tools-toggle"
            title="Enable temporary debugging actions for troubleshooting"
          >
            Show debug tools
          </label>
        </div>
      </div>

      {errorMessage && <div className="alert alert-danger mt-3">{errorMessage}</div>}

      {syncResult && syncResult.differences.length > 0 && (
        <div className="alert alert-warning mt-3">
          <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
            <div className="d-flex align-items-center gap-2">
              <h5 className="mb-0">UDT Differences Detected</h5>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary rounded-circle"
                style={{ width: "1.9rem", height: "1.9rem", padding: 0, minWidth: "1.9rem" }}
                title="Show glossary for difference terms"
                aria-label={
                  showDifferenceGlossary
                    ? "Hide difference glossary"
                    : "Show difference glossary"
                }
                aria-expanded={showDifferenceGlossary}
                onClick={() => setShowDifferenceGlossary((previous) => !previous)}
              >
                i
              </button>
            </div>

            {expandedDifferences.size > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary collapse-all-btn"
                title="Collapse all expanded differences"
                aria-label="Collapse all expanded differences"
                onClick={collapseAllDifferences}
              >
                Collapse All
              </button>
            )}
          </div>

          {showDifferenceGlossary && (
            <div className="alert alert-secondary py-2 mb-3 small">
              <div>
                <strong>Difference:</strong> UDT has at least one issue across files
                (missing in some files and/or definition mismatch).
              </div>
              <div>
                <strong>Mismatch:</strong> same UDT name exists in multiple files,
                but with different final definition content.
              </div>
              <div>
                <strong>Missing:</strong> property/path exists in one or more compared
                definitions but does not exist in another.
              </div>
              <div>
                <strong>Unequal:</strong> same property/path exists in compared
                definitions, but its final value differs.
              </div>
            </div>
          )}

          <div className="list-group">
            {syncResult.differences.map((difference) => {
              const isExpanded = expandedDifferences.has(difference.name);
              const inspection = differenceInspectionByName.get(difference.name);
              const isUnionMergeEligible = Boolean(
                inspection?.isMissingOnlyDefinitionDifference,
              );
              const isUnionMergeSelected = unionMergeSelections.has(difference.name);
              const unionMergeToggleId = `union-merge-${difference.name.replace(
                /[^a-zA-Z0-9_-]/g,
                "_",
              )}`;

              return (
                <div
                  key={difference.name}
                  className="list-group-item bg-transparent border-warning-subtle"
                >
                  <div
                    className="d-flex justify-content-between align-items-start gap-2"
                    role="button"
                    tabIndex={0}
                    onClick={() => expandDifference(difference.name)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        expandDifference(difference.name);
                      }
                    }}
                  >
                    <div className="pe-2">
                      <strong>{difference.name}</strong>
                      {` - ${formatDifferenceSummary(difference, inspection)}`}
                    </div>

                    <div className="d-flex align-items-center gap-2 flex-shrink-0">
                      {isUnionMergeEligible && (
                        <div
                          className="form-check form-switch mb-0 small"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          title="Merge all missing properties from each variant for this UDT"
                        >
                          <input
                            id={unionMergeToggleId}
                            className="form-check-input"
                            type="checkbox"
                            checked={isUnionMergeSelected}
                            onChange={(event) =>
                              toggleUnionMergeSelection(
                                difference.name,
                                event.target.checked,
                              )
                            }
                          />
                          <label
                            className="form-check-label text-body-secondary"
                            htmlFor={unionMergeToggleId}
                          >
                            Union merge
                          </label>
                        </div>
                      )}

                      {isExpanded && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary flex-shrink-0 collapse-toggle-btn"
                          title="Collapse this difference details"
                          aria-label={`Collapse ${difference.name} details`}
                          onClick={(event) => {
                            event.stopPropagation();
                            collapseDifference(difference.name);
                          }}
                        >
                          {"\u25B2"}
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-top border-warning-subtle">
                      {difference.missingIn.length > 0 && (
                        <div className="alert alert-secondary py-2 mb-3">
                          Missing in: {difference.missingIn.join(", ")}
                        </div>
                      )}

                      {difference.variants.length > 1 && (
                        <div className="small text-warning-emphasis mb-3">
                          Highlighted JSON lines show where variants differ.
                        </div>
                      )}

                      {isUnionMergeEligible && (
                        <div className="small text-body-secondary mb-3">
                          {isUnionMergeSelected
                            ? "Union merge enabled for this UDT in final export."
                            : "Enable \"Union merge\" to include all missing properties from these variants in final export."}
                        </div>
                      )}

                      {(() => {
                        const mismatchPaths = inspection?.mismatchPaths ?? new Set<string>();
                        const variantDifferenceDetails =
                          inspection?.variantDifferenceDetails ??
                          difference.variants.map(() => ({
                            missingProperties: [] as VariantPathDetail[],
                            unequalValues: [] as VariantPathDetail[],
                          }));

                        const variantCards = difference.variants.flatMap(
                          (variant, variantIndex) =>
                            variant.examples.map((example) => ({
                              variantIndex,
                              files: variant.files,
                              example,
                            })),
                        );

                        return (
                          <div className="row g-3">
                            {variantCards.map((variantCard, displayIndex) => {
                              const snippetId = `${difference.name}-${variantCard.variantIndex}-${variantCard.example.fileName}-${variantCard.example.path}-${displayIndex}`;
                              const renderedSnippet = renderJsonWithHighlights(
                                variantCard.example.definition,
                                mismatchPaths,
                              );
                              const variantDetails =
                                variantDifferenceDetails[variantCard.variantIndex];
                              const missingRows = variantDetails.missingProperties.slice(
                                0,
                                MAX_VARIANT_DETAIL_ROWS,
                              );
                              const unequalRows = variantDetails.unequalValues.slice(
                                0,
                                MAX_VARIANT_DETAIL_ROWS,
                              );
                              const matchingFiles = variantCard.files.filter(
                                (fileName) =>
                                  fileName !== variantCard.example.fileName,
                              );

                              return (
                                <div
                                  key={`${difference.name}-variant-card-${snippetId}`}
                                  className="col-12 col-xl-6"
                                >
                                  <div className="card h-100 border-secondary-subtle">
                                    <div className="card-header bg-body-secondary text-body">
                                      <div className="fw-semibold">
                                        Variant {displayIndex + 1}
                                      </div>
                                      <div className="small">
                                        File: {variantCard.example.fileName}
                                      </div>
                                      {matchingFiles.length > 0 && (
                                        <div className="small text-body-secondary">
                                          Same definition as:{" "}
                                          {matchingFiles.join(", ")}
                                        </div>
                                      )}
                                    </div>
                                    <div className="card-body">
                                      <div className="d-flex justify-content-between align-items-center gap-2 mb-1">
                                        <div className="small text-body-secondary text-break">
                                          <div>
                                            UDT path:{" "}
                                            <code>
                                              {formatUdtPathForDisplay(
                                                variantCard.example.path,
                                              )}
                                            </code>
                                          </div>
                                          <div>
                                            Parent folder:{" "}
                                            <code>
                                              {formatParentFolderPathForDisplay(
                                                variantCard.example.path,
                                              )}
                                            </code>
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-outline-info flex-shrink-0 compact-action-btn"
                                          onClick={() =>
                                            handleCopySnippet(
                                              snippetId,
                                              renderedSnippet.jsonText,
                                            )
                                          }
                                        >
                                          {copiedSnippetId === snippetId
                                            ? "Copied"
                                            : "Copy"}
                                        </button>
                                      </div>

                                      <pre
                                        className="bg-body-secondary text-body p-2 border rounded mb-0"
                                        style={{
                                          maxHeight: "320px",
                                          overflow: "auto",
                                          fontSize: "0.8rem",
                                        }}
                                      >
                                        {renderedSnippet.lines.map((line, lineIndex) => (
                                          <span
                                            key={`${snippetId}-line-${lineIndex}`}
                                            className="d-block"
                                            style={
                                              line.changed
                                                ? {
                                                    backgroundColor:
                                                      "rgba(255, 193, 7, 0.22)",
                                                    color: "#fff3cd",
                                                  }
                                                : undefined
                                            }
                                          >
                                            {line.text}
                                          </span>
                                        ))}
                                      </pre>

                                      {difference.variants.length > 1 && (
                                        <div className="mt-2 p-2 rounded border border-secondary-subtle small bg-body-tertiary">
                                          <div className="fw-semibold mb-1">
                                            {variantDetails.missingProperties.length}{" "}
                                            {pluralize(
                                              variantDetails.missingProperties
                                                .length,
                                              "missing property",
                                              "missing properties",
                                            )}
                                            , {variantDetails.unequalValues.length}{" "}
                                            {pluralize(
                                              variantDetails.unequalValues.length,
                                              "unequal value",
                                              "unequal values",
                                            )}
                                          </div>

                                          {missingRows.length > 0 && (
                                            <div className="mb-2">
                                              <div className="text-warning-emphasis fw-semibold">
                                                Missing on this variant
                                              </div>
                                              <ul className="mb-1 ps-3">
                                                {missingRows.map((row) => (
                                                  <li
                                                    key={`${snippetId}-missing-${row.path}`}
                                                  >
                                                    <code>
                                                      {formatDifferencePathLabel(
                                                        row.path,
                                                      )}
                                                    </code>{" "}
                                                    exists on{" "}
                                                    {formatVariantReferenceList(
                                                      row.otherVariantIndexes,
                                                      difference.variants,
                                                    )}{" "}
                                                    but not this one
                                                  </li>
                                                ))}
                                              </ul>
                                              {variantDetails.missingProperties
                                                .length >
                                                MAX_VARIANT_DETAIL_ROWS && (
                                                <div className="text-body-secondary">
                                                  +
                                                  {variantDetails
                                                    .missingProperties.length -
                                                    MAX_VARIANT_DETAIL_ROWS}{" "}
                                                  more missing properties
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          {unequalRows.length > 0 && (
                                            <div>
                                              <div className="text-warning-emphasis fw-semibold">
                                                Unequal values on this variant
                                              </div>
                                              <ul className="mb-1 ps-3">
                                                {unequalRows.map((row) => (
                                                  <li
                                                    key={`${snippetId}-unequal-${row.path}`}
                                                  >
                                                    <code>
                                                      {formatDifferencePathLabel(
                                                        row.path,
                                                      )}
                                                    </code>{" "}
                                                    differs from variants{" "}
                                                    {formatVariantReferenceList(
                                                      row.otherVariantIndexes,
                                                      difference.variants,
                                                    )}
                                                  </li>
                                                ))}
                                              </ul>
                                              {variantDetails.unequalValues
                                                .length >
                                                MAX_VARIANT_DETAIL_ROWS && (
                                                <div className="text-body-secondary">
                                                  +
                                                  {variantDetails.unequalValues
                                                    .length -
                                                    MAX_VARIANT_DETAIL_ROWS}{" "}
                                                  more unequal values
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {showDebugTools && (
            <div className="mt-3 d-flex justify-content-end">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={handleDownloadUdtDebugData}
              >
                Download UDT Debug Data (Temporary)
              </button>
            </div>
          )}
        </div>
      )}

      {syncResult && syncResult.mergedUdts.length > 0 && (
        <div className="alert alert-success mt-3">
          <p className="mb-2">
            Merged {syncResult.mergedUdts.length} unique UDT definitions.
          </p>
          {syncResult.udtsWithDefinitionDifferences > 0 && (
            <>
              <p className="mb-2">
                By default, mismatched UDT names keep the reference file version (
                {syncResult.referenceFile}).
              </p>
              <div className="small rounded border border-success-subtle bg-body-tertiary p-2 mb-3">
                <div>
                  <strong>Merge UDTs:</strong> exports the full merged file with all
                  unique UDT names.
                </div>
                <div>
                  <strong>Union merge toggle:</strong> only changes UDTs where the
                  mismatch is <em>missing properties only</em>; when enabled, that UDT
                  includes missing properties from all variants.
                </div>
                <div>
                  <strong>Important:</strong> unequal-value mismatches are not
                  auto-merged by union and still follow the reference file version.
                  {appliedUnionMergeCount > 0 && (
                    <>
                      {" "}
                      Union merge is currently enabled for {appliedUnionMergeCount}{" "}
                      {pluralize(
                        appliedUnionMergeCount,
                        "mismatch",
                        "mismatches",
                      )}
                      .
                    </>
                  )}
                </div>
              </div>
            </>
          )}
          <button className="btn btn-success" onClick={handleDownloadMergedUdts}>
            Merge UDTs
          </button>
        </div>
      )}
    </div>
  );
};

export default SyncUdtDefinitions;
