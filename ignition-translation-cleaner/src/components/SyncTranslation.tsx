// src/components/SyncTranslation.tsx
import { useState } from "react";
import { parseTranslationXML } from "../utils/xmlParser";
import type { TranslationTerm } from "../utils/xmlParser";
import { buildTranslationXML } from "../utils/xmlBuilder";

const SyncTranslation = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [mergedTerms, setMergedTerms] = useState<TranslationTerm[]>([]);
  const [conflicts, setConflicts] = useState<
    { key: string; values: string[] }[]
  >([]);

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
      e.target.value = ""; // Reset input so user can re-add same file if needed
    }
  };

  const handleMerge = async () => {
    const allTerms: { [key: string]: Set<string> } = {};

    for (const file of files) {
      const content = await file.text();
      const terms = parseTranslationXML(content);
      terms.forEach((term) => {
        if (!allTerms[term.key]) {
          allTerms[term.key] = new Set();
        }
        allTerms[term.key].add(term.text);
      });
    }

    const merged: TranslationTerm[] = [];
    const conflictList: { key: string; values: string[] }[] = [];

    Object.entries(allTerms).forEach(([key, texts]) => {
      if (texts.size === 1) {
        merged.push({ key, text: Array.from(texts)[0] });
      } else {
        conflictList.push({ key, values: Array.from(texts) });
      }
    });

    setMergedTerms(merged);
    setConflicts(conflictList);
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

      <div className="d-flex justify-content-center">
        <button
          className="btn btn-primary mb-3"
          onClick={handleMerge}
          disabled={files.length === 0}
        >
          Merge Translations
        </button>
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

      {mergedTerms.length > 0 && conflicts.length === 0 && (
        <div className="alert alert-success">
          <p>Merged {mergedTerms.length} translation terms successfully.</p>
          <button className="btn btn-success" onClick={handleDownload}>
            Download Merged XML
          </button>
        </div>
      )}
    </div>
  );
};

export default SyncTranslation;
