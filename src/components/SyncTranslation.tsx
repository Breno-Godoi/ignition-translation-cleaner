// src/components/SyncTranslation.tsx
import React, { useMemo, useState } from "react";
import { parseTranslationXML } from "../utils/xmlParser";
import type { TranslationTerm } from "../utils/xmlParser";
import { buildTranslationXML } from "../utils/xmlBuilder";
import { mergeTranslationFiles } from "../utils/mergeTranslations";

interface ConflictValueSource {
  value: string;
  files: string[];
}

interface TranslationConflict {
  key: string;
  values: string[];
  valueSources: ConflictValueSource[];
}

const extractLanguageSuffix = (fileName: string): string | null => {
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const underscoreIndex = baseName.lastIndexOf("_");

  if (underscoreIndex < 0 || underscoreIndex === baseName.length - 1) {
    return null;
  }

  return baseName.slice(underscoreIndex + 1);
};

const SyncTranslation: React.FC = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [mergedTerms, setMergedTerms] = useState<TranslationTerm[]>([]);
  const [conflicts, setConflicts] = useState<TranslationConflict[]>([]);
  const [mergeLog, setMergeLog] = useState<string>("");
  const [expandedConflicts, setExpandedConflicts] = useState<Set<string>>(
    new Set(),
  );
  const [selectedConflictValues, setSelectedConflictValues] = useState<
    Map<string, string>
  >(new Map());

  const resetMergeOutput = () => {
    setMergedTerms([]);
    setConflicts([]);
    setMergeLog("");
    setExpandedConflicts(new Set());
    setSelectedConflictValues(new Map());
  };

  const expandConflict = (conflictKey: string) => {
    setExpandedConflicts((previous) => {
      if (previous.has(conflictKey)) {
        return previous;
      }
      const updated = new Set(previous);
      updated.add(conflictKey);
      return updated;
    });
  };

  const collapseConflict = (conflictKey: string) => {
    setExpandedConflicts((previous) => {
      if (!previous.has(conflictKey)) {
        return previous;
      }
      const updated = new Set(previous);
      updated.delete(conflictKey);
      return updated;
    });
  };

  const collapseAllConflicts = () => {
    setExpandedConflicts(new Set());
  };

  const selectConflictValue = (conflictKey: string, value: string) => {
    setSelectedConflictValues((previous) => {
      if (previous.get(conflictKey) === value) {
        return previous;
      }
      const updated = new Map(previous);
      updated.set(conflictKey, value);
      return updated;
    });
  };

  const clearConflictSelection = (conflictKey: string) => {
    setSelectedConflictValues((previous) => {
      if (!previous.has(conflictKey)) {
        return previous;
      }
      const updated = new Map(previous);
      updated.delete(conflictKey);
      return updated;
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      const uniqueFiles = [...files];

      newFiles.forEach((newFile) => {
        if (
          !uniqueFiles.find(
            (f) => f.name === newFile.name && f.size === newFile.size
          )
        ) {
          uniqueFiles.push(newFile);
        }
      });

      setFiles(uniqueFiles);
      resetMergeOutput();
      e.target.value = ""; // Reset input
    }
  };

  const buildConflictDetails = (
    parsedFiles: TranslationTerm[][],
    fileNames: string[],
    rawConflicts: { key: string; values: string[] }[],
  ): TranslationConflict[] => {
    const keyValueFiles = new Map<string, Map<string, Set<string>>>();

    parsedFiles.forEach((terms, fileIndex) => {
      const fileName = fileNames[fileIndex] ?? `File ${fileIndex + 1}`;

      for (const term of terms) {
        if (!keyValueFiles.has(term.key)) {
          keyValueFiles.set(term.key, new Map());
        }

        const valueMap = keyValueFiles.get(term.key)!;
        if (!valueMap.has(term.text)) {
          valueMap.set(term.text, new Set());
        }
        valueMap.get(term.text)!.add(fileName);
      }
    });

    return rawConflicts.map((conflict) => {
      const valueMap = keyValueFiles.get(conflict.key) ?? new Map();

      const valueSources = conflict.values.map((value) => {
        const filesWithValueSet = valueMap.get(value) ?? new Set<string>();
        const filesWithValue = fileNames.filter((fileName) =>
          filesWithValueSet.has(fileName),
        );

        return {
          value,
          files: filesWithValue,
        };
      });

      return {
        key: conflict.key,
        values: conflict.values,
        valueSources,
      };
    });
  };

  const handleMerge = async () => {
    const parsedFiles: TranslationTerm[][] = [];
    const fileNames = files.map((file) => file.name);

    for (const file of files) {
      const content = await file.text();
      const terms = parseTranslationXML(content);
      console.log(`Parsed ${file.name}:`, terms);
      parsedFiles.push(terms);
    }

    const { merged, conflicts: rawConflicts } = mergeTranslationFiles(parsedFiles);
    const detailedConflicts = buildConflictDetails(
      parsedFiles,
      fileNames,
      rawConflicts,
    );

    setMergedTerms(merged);
    setConflicts(detailedConflicts);
    setExpandedConflicts(new Set());
    setSelectedConflictValues(new Map());

    // Update log
    const logOutput = [
      `Files merged: ${files.length}`,
      `Total unique keys: ${merged.length}`,
      `Conflicts found: ${detailedConflicts.length}`,
    ].join("\n");

    console.log(logOutput);
    setMergeLog(logOutput);
  };

  const resolvedConflictsCount = useMemo(
    () => conflicts.filter((conflict) => selectedConflictValues.has(conflict.key)).length,
    [conflicts, selectedConflictValues],
  );

  const unresolvedConflictsCount = conflicts.length - resolvedConflictsCount;

  const languageValidation = useMemo(() => {
    if (files.length === 0) {
      return {
        languageSuffix: null as string | null,
        downloadError: null as string | null,
      };
    }

    const suffixByFile = files.map((file) => ({
      name: file.name,
      suffix: extractLanguageSuffix(file.name),
    }));

    const missingSuffixFiles = suffixByFile
      .filter((entry) => !entry.suffix)
      .map((entry) => entry.name);

    if (missingSuffixFiles.length > 0) {
      return {
        languageSuffix: null,
        downloadError: `Missing language suffix (_xx) in: ${missingSuffixFiles.join(", ")}`,
      };
    }

    const normalizedToOriginal = new Map<string, string>();

    for (const entry of suffixByFile) {
      const suffix = entry.suffix ?? "";
      const normalized = suffix.toLowerCase();
      if (!normalizedToOriginal.has(normalized)) {
        normalizedToOriginal.set(normalized, suffix);
      }
    }

    if (normalizedToOriginal.size > 1) {
      const foundSuffixes = Array.from(normalizedToOriginal.values())
        .map((suffix) => `_${suffix}`)
        .join(", ");

      return {
        languageSuffix: null,
        downloadError: `All uploaded files must use the same language suffix. Found: ${foundSuffixes}`,
      };
    }

    const [languageSuffix] = Array.from(normalizedToOriginal.values());

    return {
      languageSuffix,
      downloadError: null,
    };
  }, [files]);

  const exportableTerms = useMemo(() => {
    const termsByKey = new Map<string, TranslationTerm>();

    for (const term of mergedTerms) {
      termsByKey.set(term.key, term);
    }

    for (const conflict of conflicts) {
      const selectedValue = selectedConflictValues.get(conflict.key);
      if (selectedValue === undefined) {
        continue;
      }

      termsByKey.set(conflict.key, {
        key: conflict.key,
        text: selectedValue,
      });
    }

    return Array.from(termsByKey.values()).sort((a, b) =>
      a.key.localeCompare(b.key),
    );
  }, [mergedTerms, conflicts, selectedConflictValues]);

  const handleDownload = () => {
    if (!languageValidation.languageSuffix || languageValidation.downloadError) {
      return;
    }

    const xmlContent = buildTranslationXML(exportableTerms);
    const blob = new Blob([xmlContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeLanguageSuffix = languageValidation.languageSuffix.replace(
      /[^a-zA-Z0-9-]/g,
      "_",
    );
    a.href = url;
    a.download = `merged_translations_${safeLanguageSuffix}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-4 text-center">
        <label htmlFor="xmlFiles" className="form-label fw-semibold">
          Upload Translation XML files
        </label>
        <div className="text-center">
          <div className="mb-3">
            <input
              id="multi-file-input"
              type="file"
              className="d-none"
              accept=".xml"
              multiple
              onChange={handleFileChange}
            />
            <label htmlFor="multi-file-input" className="btn btn-primary">
              Upload XML Files
            </label>
          </div>

          {files.length > 0 && (
            <div
              className="mt-3 text-start mx-auto"
              style={{ maxWidth: "500px" }}
            >
              <ul className="list-group">
                {files.map((file, index) => (
                  <li
                    key={index}
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
                        const newFiles = [...files];
                        newFiles.splice(index, 1);
                        setFiles(newFiles);
                        resetMergeOutput();
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
          onClick={handleMerge}
          disabled={files.length === 0}
        >
          Merge Translations
        </button>

        {mergeLog && (
          <pre
            className="text-start bg-body-secondary text-body p-3 border rounded"
            style={{ maxWidth: "600px", width: "100%" }}
          >
            {mergeLog}
          </pre>
        )}
      </div>

      {conflicts.length > 0 && (
        <div className="alert alert-danger">
          <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
            <h5 className="mb-0">Conflicting Keys Detected:</h5>
            {expandedConflicts.size > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-outline-light collapse-all-btn"
                title="Collapse all expanded conflicts"
                aria-label="Collapse all expanded conflicts"
                onClick={collapseAllConflicts}
              >
                Collapse All
              </button>
            )}
          </div>
          <div className="list-group">
            {conflicts.map((conflict) => (
              <div
                key={conflict.key}
                className="list-group-item bg-transparent border-danger-subtle"
              >
                <div
                  className="d-flex justify-content-between align-items-start gap-2"
                  role="button"
                  tabIndex={0}
                  onClick={() => expandConflict(conflict.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      expandConflict(conflict.key);
                    }
                  }}
                >
                  <div className="pe-2">
                    <strong>{conflict.key}</strong>: {conflict.values.join(" | ")}
                    {selectedConflictValues.has(conflict.key) && (
                      <span className="badge text-bg-light ms-2">
                        Selected for merge
                      </span>
                    )}
                  </div>

                  {expandedConflicts.has(conflict.key) && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-light flex-shrink-0 collapse-toggle-btn"
                      title="Collapse this conflict details"
                      aria-label={`Collapse ${conflict.key} details`}
                      onClick={(event) => {
                        event.stopPropagation();
                        collapseConflict(conflict.key);
                      }}
                    >
                      {"\u25B2"}
                    </button>
                  )}
                </div>

                {expandedConflicts.has(conflict.key) && (
                  <div className="mt-2 pt-2 border-top border-danger-subtle">
                    <div className="small mb-2 text-danger-emphasis">
                      Choose one value to include in the merged export:
                    </div>

                    {conflict.valueSources.map((source, sourceIndex) => {
                      const radioId = `conflict-${conflict.key}-${sourceIndex}`;
                      return (
                        <div key={`${conflict.key}-${source.value}`} className="form-check mb-2">
                          <input
                            id={radioId}
                            className="form-check-input"
                            type="radio"
                            name={`conflict-choice-${conflict.key}`}
                            checked={selectedConflictValues.get(conflict.key) === source.value}
                            onChange={() => selectConflictValue(conflict.key, source.value)}
                          />
                          <label className="form-check-label w-100" htmlFor={radioId}>
                            <code>{source.value || "(empty value)"}</code>
                            <div className="small mt-1">
                              Found in: {source.files.join(", ")}
                            </div>
                          </label>
                        </div>
                      );
                    })}

                    {selectedConflictValues.has(conflict.key) && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-light mt-1"
                        style={{ minWidth: "auto" }}
                        onClick={() => clearConflictSelection(conflict.key)}
                      >
                        Clear selection
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {exportableTerms.length > 0 && (
        <div className="alert alert-success">
          <p>
            Merged {exportableTerms.length} translation terms ready for export.
            {conflicts.length > 0 && (
              <>
                <br />
                <strong>Conflict resolution:</strong> {resolvedConflictsCount}{" "}
                selected, {unresolvedConflictsCount} excluded.
              </>
            )}
          </p>
          <div className="d-flex flex-wrap align-items-center gap-2">
            {languageValidation.downloadError && (
              <span className="text-danger fw-semibold">
                {languageValidation.downloadError}
              </span>
            )}
            <button
              className="btn btn-success"
              onClick={handleDownload}
              disabled={Boolean(languageValidation.downloadError)}
            >
              Download Merged XML
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncTranslation;
