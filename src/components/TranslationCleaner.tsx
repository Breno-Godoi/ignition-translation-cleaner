import React, { useMemo, useState } from "react";
import { buildTranslationXML } from "../utils/xmlBuilder";
import {
  detectUsedKeysInProjectFiles,
  extractProjectTextFilesFromZip,
} from "../utils/zipScanner";
import {
  parseTranslationDocument,
  type TranslationTerm,
} from "../utils/xmlParser";

interface CleanerAnalysisResult {
  usedKeys: Set<string>;
  unusedTerms: TranslationTerm[];
  scannedProjectCount: number;
  scannedFileCount: number;
}

const inferLocaleFromFileName = (fileName: string): string | null => {
  const match = fileName.match(/_([A-Za-z0-9-]+)\.xml$/i);
  return match?.[1] ?? null;
};

const buildCleanedFileName = (fileName: string): string => {
  const localeSuffixMatch = fileName.match(/^(.*?)(_([A-Za-z0-9-]+))\.xml$/i);
  if (localeSuffixMatch) {
    const baseName = localeSuffixMatch[1];
    const localeSuffix = localeSuffixMatch[2];
    return `${baseName}_cleaned${localeSuffix}.xml`;
  }

  if (/\.xml$/i.test(fileName)) {
    return fileName.replace(/\.xml$/i, "_cleaned.xml");
  }

  return `${fileName}_cleaned.xml`;
};

const TranslationCleaner: React.FC = () => {
  const [translationFile, setTranslationFile] = useState<File | null>(null);
  const [translationTerms, setTranslationTerms] = useState<TranslationTerm[]>([]);
  const [translationLocale, setTranslationLocale] = useState<string | null>(null);
  const [translationComment, setTranslationComment] = useState<string | null>(null);
  const [projectZipFiles, setProjectZipFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<CleanerAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [showDebugTools, setShowDebugTools] = useState<boolean>(false);

  const resetAnalysis = () => {
    setAnalysis(null);
    setErrorMessage("");
  };

  const handleTranslationFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";

    if (!selectedFile) {
      return;
    }

    try {
      const content = await selectedFile.text();
      const parsed = parseTranslationDocument(content);

      if (parsed.terms.length === 0) {
        setErrorMessage(
          "No translation entries were found in this XML file.",
        );
        return;
      }

      setTranslationFile(selectedFile);
      setTranslationTerms(parsed.terms);
      setTranslationComment(parsed.comment);
      setTranslationLocale(
        parsed.locale ?? inferLocaleFromFileName(selectedFile.name),
      );
      resetAnalysis();
    } catch {
      setErrorMessage(`Could not parse "${selectedFile.name}" as translation XML.`);
    }
  };

  const handleProjectZipFilesChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) {
      return;
    }

    const updated = [...projectZipFiles];
    for (const file of selectedFiles) {
      const alreadyAdded = updated.some(
        (existing) => existing.name === file.name && existing.size === file.size,
      );
      if (!alreadyAdded) {
        updated.push(file);
      }
    }

    setProjectZipFiles(updated);
    resetAnalysis();
  };

  const removeProjectZipFile = (index: number) => {
    const updated = projectZipFiles.filter((_, fileIndex) => fileIndex !== index);
    setProjectZipFiles(updated);
    resetAnalysis();
  };

  const runAnalysis = async () => {
    if (!translationFile || translationTerms.length === 0) {
      setErrorMessage("Upload a valid translation XML file first.");
      return;
    }

    if (projectZipFiles.length === 0) {
      setErrorMessage("Upload at least one Ignition project ZIP file.");
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage("");
    setAnalysis(null);

    try {
      const extractedByProject = await Promise.all(
        projectZipFiles.map((file) => extractProjectTextFilesFromZip(file)),
      );

      const extractedFiles = extractedByProject.flat();
      const usedKeys = detectUsedKeysInProjectFiles(
        extractedFiles,
        translationTerms.map((term) => term.key),
      );
      const unusedTerms = translationTerms.filter(
        (term) => !usedKeys.has(term.key),
      );

      setAnalysis({
        usedKeys,
        unusedTerms,
        scannedProjectCount: projectZipFiles.length,
        scannedFileCount: extractedFiles.length,
      });
    } catch {
      setErrorMessage(
        "Could not read one or more ZIP files. Make sure they are valid Ignition project exports.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExportCleanedXml = async () => {
    if (!analysis || !translationFile) {
      return;
    }

    const cleanedTerms = translationTerms.filter((term) =>
      analysis.usedKeys.has(term.key),
    );

    const xmlContent = buildTranslationXML(cleanedTerms, {
      locale: translationLocale,
      comment: translationComment,
    });

    const defaultName = buildCleanedFileName(translationFile.name);

    if (window.native?.saveAs && window.native?.writeTextFile) {
      const { canceled, filePath } = await window.native.saveAs({
        title: "Save cleaned translation XML",
        defaultPath: defaultName,
        filters: [{ name: "XML", extensions: ["xml"] }],
      });

      if (!canceled && filePath) {
        await window.native.writeTextFile(filePath, xmlContent);
      }
      return;
    }

    const blob = new Blob([xmlContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCleanerDebugData = async () => {
    const debugPayload = {
      generatedAt: new Date().toISOString(),
      translationFile: translationFile
        ? {
            name: translationFile.name,
            size: translationFile.size,
            type: translationFile.type,
          }
        : null,
      translationLocale,
      translationComment,
      translationTermsCount: translationTerms.length,
      translationTerms,
      projectZipFiles: projectZipFiles.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      })),
      analysis: analysis
        ? {
            scannedProjectCount: analysis.scannedProjectCount,
            scannedFileCount: analysis.scannedFileCount,
            usedKeysCount: analysis.usedKeys.size,
            usedKeys: Array.from(analysis.usedKeys.values()).sort((a, b) =>
              a.localeCompare(b),
            ),
            unusedTermsCount: analysis.unusedTerms.length,
            unusedTerms: analysis.unusedTerms,
          }
        : null,
      errorMessage,
    };

    const jsonContent = JSON.stringify(debugPayload, null, 2);
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");
    const defaultFileName = `translation_cleaner_debug_${timestamp}.json`;

    if (window.native?.saveAs && window.native?.writeTextFile) {
      const { canceled, filePath } = await window.native.saveAs({
        title: "Save Translation Cleaner debug data",
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

  const usedCount = analysis?.usedKeys.size ?? 0;
  const unusedCount = analysis?.unusedTerms.length ?? 0;
  const cleanedCount = useMemo(() => usedCount, [usedCount]);

  return (
    <div>
      <div className="mb-4 text-center">
        <label htmlFor="translation-cleaner-xml" className="form-label fw-semibold">
          Upload Translation XML
        </label>
        <div className="mb-3">
          <input
            id="translation-cleaner-xml"
            type="file"
            className="d-none"
            accept=".xml,application/xml,text/xml"
            onChange={handleTranslationFileChange}
          />
          <label htmlFor="translation-cleaner-xml" className="btn btn-primary">
            Upload Translation XML
          </label>
        </div>

        {translationFile && (
          <div className="alert alert-secondary py-2 mb-0 text-start mx-auto" style={{ maxWidth: "600px" }}>
            <div>
              <strong>File:</strong> {translationFile.name}
            </div>
            <div>
              <strong>Terms found:</strong> {translationTerms.length}
            </div>
            {translationLocale && (
              <div>
                <strong>Locale:</strong> {translationLocale}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-4 text-center">
        <label htmlFor="translation-cleaner-project-zips" className="form-label fw-semibold">
          Upload Ignition Project ZIP files
        </label>
        <div className="mb-3">
          <input
            id="translation-cleaner-project-zips"
            type="file"
            className="d-none"
            accept=".zip,application/zip"
            multiple
            onChange={handleProjectZipFilesChange}
          />
          <label htmlFor="translation-cleaner-project-zips" className="btn btn-primary">
            Upload Project ZIPs
          </label>
        </div>

        {projectZipFiles.length > 0 && (
          <div className="mt-3 text-start mx-auto" style={{ maxWidth: "600px" }}>
            <ul className="list-group">
              {projectZipFiles.map((file, index) => (
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
                    onClick={() => removeProjectZipFile(index)}
                  ></button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="d-flex flex-column align-items-center mb-4">
        <button
          className="btn btn-primary"
          onClick={runAnalysis}
          disabled={
            isAnalyzing ||
            !translationFile ||
            translationTerms.length === 0 ||
            projectZipFiles.length === 0
          }
        >
          {isAnalyzing ? "Analyzing..." : "Analyze Translation Usage"}
        </button>
      </div>

      <div className="alert alert-secondary py-2 small">
        <strong>Detection note:</strong> This scan only detects translation keys when
        the full key string is present in project files. Keys assembled dynamically
        at runtime (for example via string concatenation) may not be detected and
        can appear as unused.
      </div>

      <div className="d-flex justify-content-end mb-3">
        <div className="form-check form-switch text-body-secondary opacity-75">
          <input
            className="form-check-input"
            type="checkbox"
            id="cleaner-debug-tools-toggle"
            checked={showDebugTools}
            onChange={(event) => setShowDebugTools(event.target.checked)}
          />
          <label
            className="form-check-label small"
            htmlFor="cleaner-debug-tools-toggle"
            title="Enable temporary debugging actions for troubleshooting"
          >
            Show debug tools
          </label>
        </div>
      </div>

      {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}

      {analysis && (
        <div className="alert alert-info">
          <p className="mb-2">
            <strong>Projects scanned:</strong> {analysis.scannedProjectCount}
            <br />
            <strong>Project files scanned:</strong> {analysis.scannedFileCount}
            <br />
            <strong>Used keys found:</strong> {usedCount}
            <br />
            <strong>Unused keys:</strong> {unusedCount}
          </p>

          {unusedCount > 0 ? (
            <div className="mt-3">
              <h6>Unused Translation Entries</h6>
              <div className="table-responsive">
                <table className="table table-sm table-bordered align-middle mb-0">
                  <thead className="table-secondary">
                    <tr>
                      <th>Key</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.unusedTerms.map((term) => (
                      <tr key={term.key}>
                        <td>
                          <code>{term.key}</code>
                        </td>
                        <td>{term.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="alert alert-success mb-0">
              No unused translation entries were found in the uploaded projects.
            </div>
          )}

          {showDebugTools && (
            <div className="d-flex justify-content-end mt-3 pt-2 border-top border-secondary-subtle">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={handleDownloadCleanerDebugData}
              >
                Download Cleaner Debug Data (Temporary)
              </button>
            </div>
          )}
        </div>
      )}

      {analysis && (
        <div className="alert alert-success">
          <p className="mb-2">
            Export a cleaned translation file with {cleanedCount} kept entries and{" "}
            {unusedCount} removed entries.
          </p>
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <button className="btn btn-success" onClick={handleExportCleanedXml}>
              Export Cleaned Translation XML
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranslationCleaner;
