// src/components/ExportButton.tsx
import React from 'react';
import type { TranslationTerm } from '../utils/xmlParser';
import { XMLBuilder } from 'fast-xml-parser';

interface ExportButtonProps {
  terms: TranslationTerm[];
  keptKeys: Set<string>;
}

const ExportButton: React.FC<ExportButtonProps> = ({ terms, keptKeys }) => {
  const handleExport = async () => {
    const filteredTerms = terms.filter(term => keptKeys.has(term.key));

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      format: true,
    });

    const xmlContent = builder.build({
      translation: {
        term: filteredTerms,
      },
    });

    // If running under Electron, use native Save As + write
    if (window.native?.saveAs && window.native?.writeTextFile) {
      const { canceled, filePath } = await window.native.saveAs({
        title: 'Save cleaned translations',
        defaultPath: 'translation.cleaned.xml',
        filters: [{ name: 'XML', extensions: ['xml'] }],
      });
      if (!canceled && filePath) {
        await window.native.writeTextFile(filePath, xmlContent);
        return;
      }
      // if canceled, just return silently
      return;
    }

    // Browser fallback (existing behavior)
    const blob = new Blob([xmlContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'translation.cleaned.xml';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-4">
      <button className="btn btn-primary" onClick={handleExport}>
        Export Cleaned Translation XML
      </button>
    </div>
  );
};

export default ExportButton;
