// src/components/ExportButton.tsx
import React from 'react';
import type { TranslationTerm } from '../utils/xmlParser';
import { XMLBuilder } from 'fast-xml-parser';

interface ExportButtonProps {
  terms: TranslationTerm[];
  keptKeys: Set<string>;
}

const ExportButton: React.FC<ExportButtonProps> = ({ terms, keptKeys }) => {
  const handleExport = () => {
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
        📤 Export Cleaned Translation XML
      </button>
    </div>
  );
};

export default ExportButton;
