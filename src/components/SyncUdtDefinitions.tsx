import React, { useState } from "react";
import {
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

const formatVariantReferenceList = (variantIndexes: number[]): string =>
  variantIndexes.map((variantIndex) => `${variantIndex + 1}`).join(", ");

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

  const resetOutput = () => {
    setSyncResult(null);
    setSyncLog("");
    setErrorMessage("");
    setExpandedDifferences(new Set());
    setCopiedSnippetId(null);
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

  const formatDifferenceSummary = (difference: UdtDifference): string => {
    const sections: string[] = [];

    if (difference.variants.length > 1) {
      sections.push(
        `definition mismatch across ${difference.variants
          .map((variant) => variant.files.join(", "))
          .join(" | ")}`,
      );
    }

    if (difference.missingIn.length > 0) {
      sections.push(`missing in ${difference.missingIn.join(", ")}`);
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
    if (!syncResult) {
      return;
    }

    const jsonContent = JSON.stringify(syncResult.mergedFile, null, 2);

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

      {errorMessage && <div className="alert alert-danger mt-3">{errorMessage}</div>}

      {syncResult && syncResult.differences.length > 0 && (
        <div className="alert alert-warning mt-3">
          <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
            <h5 className="mb-0">UDT Differences Detected</h5>
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
          <div className="list-group">
            {syncResult.differences.map((difference) => {
              const isExpanded = expandedDifferences.has(difference.name);

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
                      {` - ${formatDifferenceSummary(difference)}`}
                    </div>

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

                      {(() => {
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
                            ? analyzeVariantDifferences(
                                normalizedVariantDefinitions,
                              )
                            : difference.variants.map(() => ({
                                missingProperties: [] as VariantPathDetail[],
                                unequalValues: [] as VariantPathDetail[],
                              }));

                        return (
                          <div className="row g-3">
                            {difference.variants.map((variant, index) => (
                              <div
                                key={`${difference.name}-variant-${index}`}
                                className="col-12 col-xl-6"
                              >
                                <div className="card h-100 border-secondary-subtle">
                                  <div className="card-header bg-body-secondary text-body">
                                    <div className="fw-semibold">Variant {index + 1}</div>
                                    <div className="small">
                                      Files: {variant.files.join(", ")}
                                    </div>
                                  </div>
                                  <div className="card-body">
                                    {variant.examples.map((example, exampleIndex) => {
                                      const snippetId = `${difference.name}-${index}-${example.fileName}-${example.path}`;
                                      const renderedSnippet = renderJsonWithHighlights(
                                        example.definition,
                                        mismatchPaths,
                                      );
                                      const variantDetails =
                                        variantDifferenceDetails[index];
                                      const missingRows =
                                        variantDetails.missingProperties.slice(
                                          0,
                                          MAX_VARIANT_DETAIL_ROWS,
                                        );
                                      const unequalRows =
                                        variantDetails.unequalValues.slice(
                                          0,
                                          MAX_VARIANT_DETAIL_ROWS,
                                        );

                                      return (
                                        <div key={snippetId} className="mb-3">
                                          <div className="d-flex justify-content-between align-items-center gap-2 mb-1">
                                            <div className="small text-body-secondary text-break">
                                              {example.fileName}: {example.path}
                                            </div>
                                            <button
                                              type="button"
                                              className="btn btn-sm btn-outline-info flex-shrink-0"
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

                                          {exampleIndex === 0 &&
                                            difference.variants.length > 1 && (
                                              <div className="mt-2 p-2 rounded border border-secondary-subtle small bg-body-tertiary">
                                                <div className="fw-semibold mb-1">
                                                  {variantDetails.missingProperties.length}{" "}
                                                  {pluralize(
                                                    variantDetails
                                                      .missingProperties.length,
                                                    "missing property",
                                                    "missing properties",
                                                  )}
                                                  ,{" "}
                                                  {variantDetails.unequalValues.length}{" "}
                                                  {pluralize(
                                                    variantDetails.unequalValues
                                                      .length,
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
                                                          )}{" "}
                                                          but not this one
                                                        </li>
                                                      ))}
                                                    </ul>
                                                    {variantDetails
                                                      .missingProperties.length >
                                                      MAX_VARIANT_DETAIL_ROWS && (
                                                      <div className="text-body-secondary">
                                                        +
                                                        {variantDetails
                                                          .missingProperties
                                                          .length -
                                                          MAX_VARIANT_DETAIL_ROWS}{" "}
                                                        more missing properties
                                                      </div>
                                                    )}
                                                  </div>
                                                )}

                                                {unequalRows.length > 0 && (
                                                  <div>
                                                    <div className="text-warning-emphasis fw-semibold">
                                                      Unequal values on this
                                                      variant
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
                                                          )}
                                                        </li>
                                                      ))}
                                                    </ul>
                                                    {variantDetails.unequalValues
                                                      .length >
                                                      MAX_VARIANT_DETAIL_ROWS && (
                                                      <div className="text-body-secondary">
                                                        +
                                                        {variantDetails
                                                          .unequalValues.length -
                                                          MAX_VARIANT_DETAIL_ROWS}{" "}
                                                        more unequal values
                                                      </div>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {syncResult && syncResult.mergedUdts.length > 0 && (
        <div className="alert alert-success mt-3">
          <p className="mb-2">
            Merged {syncResult.mergedUdts.length} unique UDT definitions.
          </p>
          {syncResult.udtsWithDefinitionDifferences > 0 && (
            <p className="mb-3">
              For mismatched UDT names, the merged output keeps the reference file
              version ({syncResult.referenceFile}).
            </p>
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
