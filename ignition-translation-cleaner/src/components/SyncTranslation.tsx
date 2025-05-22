// src/components/SyncTranslation.tsx
import React, { useState } from "react";
import { parseTranslationXML } from "../utils/xmlParser";
import type { TranslationTerm } from "../utils/xmlParser";
import { buildTranslationXML } from "../utils/xmlBuilder";
import { mergeTranslationFiles } from "../utils/mergeTranslations";

const SyncTranslation: React.FC = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [mergedTerms, setMergedTerms] = useState<TranslationTerm[]>([]);
  const [conflicts, setConflicts] = useState<
    { key: string; values: string[] }[]
  >([]);
  const [mergeLog, setMergeLog] = useState<string>("");

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
      e.target.value = ""; // Reset input
    }
  };

  const handleMerge = async () => {
    const parsedFiles: TranslationTerm[][] = [];

    for (const file of files) {
      const content = await file.text();
      const terms = parseTranslationXML(content);
      console.log(`Parsed ${file.name}:`, terms);
      parsedFiles.push(terms);
    }

    const { merged, conflicts } = mergeTranslationFiles(parsedFiles);
    setMergedTerms(merged);
    setConflicts(conflicts);

    // Update log
    const logOutput = [
      `Files merged: ${files.length}`,
      `Total unique keys: ${merged.length}`,
      `Conflicts found: ${conflicts.length}`,
    ].join("\n");

    console.log(logOutput);
    setMergeLog(logOutput);
  };

  const handleDownload = () => {
    const xmlContent = buildTranslationXML(mergedTerms);
    const blob = new Blob([xmlContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "merged_translations.xml";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-4 text-center">
        <label htmlFor="xmlFiles" className="form-label fw-semibold">
          Upload up to 4 Translation XML files
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
            className="text-start bg-light p-3 border rounded"
            style={{ maxWidth: "600px", width: "100%" }}
          >
            {mergeLog}
          </pre>
        )}
      </div>

      {conflicts.length > 0 && (
        <div className="alert alert-danger">
          <h5>Conflicting Keys Detected:</h5>
          <ul>
            {conflicts.map((conflict) => (
              <li key={conflict.key}>
                <strong>{conflict.key}</strong>: {conflict.values.join(" | ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mergedTerms.length > 0 && (
        <div className="alert alert-success">
          <p>
            Merged {mergedTerms.length} translation terms successfully.
            {conflicts.length > 0 && (
              <>
                <br />
                <strong>Note:</strong> {conflicts.length} conflicting keys were
                excluded.
              </>
            )}
          </p>
          <button className="btn btn-success" onClick={handleDownload}>
            Download Merged XML
          </button>
        </div>
      )}
    </div>
  );
};

export default SyncTranslation;
