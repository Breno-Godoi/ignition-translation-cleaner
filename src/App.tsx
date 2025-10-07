// src/App.tsx
import { useState, useEffect } from "react";
import FileUpload from "./components/FileUpload";
import TermReviewTable from "./components/TermReviewTable";
import ExportButton from "./components/ExportButton";
import SyncTranslation from "./components/SyncTranslation";
import { parseTranslationXML } from "./utils/xmlParser";
import type { TranslationTerm } from "./utils/xmlParser";
import { extractTextFilesFromZip, detectUsedKeys } from "./utils/zipScanner";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState<"sync" | "cleaner">("sync");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // States for Translation Cleaner
  const [terms, setTerms] = useState<TranslationTerm[]>([]);
  const [usedKeys, setUsedKeys] = useState<Set<string>>(new Set());
  const [keptKeys, setKeptKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.body.setAttribute("data-bs-theme", theme);
  }, [theme]);

  const handleTranslationSelect = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const parsedTerms = parseTranslationXML(content);
      setTerms(parsedTerms);
      console.log("Parsed Terms:", parsedTerms);
    };
    reader.readAsText(file);
  };

  const handleProjectZipSelect = async (file: File) => {
    if (terms.length === 0) {
      alert("Please upload the Translations XML first.");
      return;
    }

    const files = await extractTextFilesFromZip(file);
    const keys = terms.map((term) => term.key);
    const used = detectUsedKeys(files, keys);

    setUsedKeys(used);
    console.log("Used keys:", used);
  };

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-10 col-md-12">

          <div className="position-relative mb-4">
            <h2 className="m-0 w-100 text-center">Ignition Translation Tool</h2>
            <div className="form-check form-switch position-absolute top-0 end-0">

              <input
                className="form-check-input"
                type="checkbox"
                id="themeSwitch"
                checked={theme === "dark"}
                onChange={() => setTheme(theme === "dark" ? "light" : "dark")}
              />
              <label className="form-check-label" htmlFor="themeSwitch">
                {theme === "dark" ? "Dark" : "Light"} Mode
              </label>
            </div>
          </div>

          <ul className="nav nav-tabs mb-4 d-flex flex-row justify-content-center">
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === "sync" ? "active" : ""}`}
                onClick={() => setActiveTab("sync")}
              >
                Sync Translation
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${
                  activeTab === "cleaner" ? "active" : ""
                }`}
                onClick={() => setActiveTab("cleaner")}
              >
                Translation Cleaner
              </button>
            </li>
          </ul>

          {activeTab === "sync" && <SyncTranslation />}

          {activeTab === "cleaner" && (
            <>
              <FileUpload
                label="Upload Translations XML"
                accept=".xml"
                onFileSelect={handleTranslationSelect}
              />

              <FileUpload
                label="Upload Ignition Project ZIP"
                accept=".zip"
                onFileSelect={handleProjectZipSelect}
              />

              {terms.length > 0 && (
                <div className="alert alert-success mt-4">
                  {terms.length} translation terms parsed from XML.
                </div>
              )}

              {usedKeys.size > 0 && (
                <div className="alert alert-info mt-2">
                  {usedKeys.size} used keys detected in project files.
                </div>
              )}

              {terms.length > 0 && usedKeys.size > 0 && (
                <TermReviewTable
                  terms={terms}
                  usedKeys={usedKeys}
                  onSelectionChange={setKeptKeys}
                />
              )}

              {keptKeys.size > 0 && (
                <ExportButton terms={terms} keptKeys={keptKeys} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
