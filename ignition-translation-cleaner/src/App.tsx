// src/App.tsx
import { useState } from 'react';
import FileUpload from './components/FileUpload';
import TermReviewTable from './components/TermReviewTable';
import { parseTranslationXML } from './utils/xmlParser';
import type { TranslationTerm } from './utils/xmlParser';
import { extractTextFilesFromZip, detectUsedKeys } from './utils/zipScanner';
import ExportButton from './components/ExportButton';
import "bootstrap-icons/font/bootstrap-icons.css";
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

function App() {
  const [terms, setTerms] = useState<TranslationTerm[]>([]);
  const [usedKeys, setUsedKeys] = useState<Set<string>>(new Set());
  const [keptKeys, setKeptKeys] = useState<Set<string>>(new Set());

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
    console.log("Selected ZIP:", file.name);

    if (terms.length === 0) {
      alert("Please upload the Translations XML first.");
      return;
    }

    const files = await extractTextFilesFromZip(file);
    const keys = terms.map(term => term.key);
    const used = detectUsedKeys(files, keys);

    setUsedKeys(used);
    console.log("Used keys:", used);
  };

  return (
    <div className="container py-5">
      <h2 className="mb-4">Ignition Translation Cleaner</h2>

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
          ✅ {terms.length} translation terms parsed from XML.
        </div>
      )}

      {usedKeys.size > 0 && (
        <div className="alert alert-info mt-2">
          🔍 {usedKeys.size} used keys detected in project files.
        </div>
      )}

      {terms.length > 0 && usedKeys.size > 0 && (
        <>
          <TermReviewTable
            terms={terms}
            usedKeys={usedKeys}
            onSelectionChange={setKeptKeys}
          />
          {keptKeys.size > 0 && (
            <ExportButton terms={terms} keptKeys={keptKeys} />
          )}
        </>
      )}

    </div>
  );
}

export default App;
