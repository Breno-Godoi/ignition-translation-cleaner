// src/components/TermReviewTable.tsx
import React, { useState, useEffect } from 'react';
import type { TranslationTerm } from '../utils/xmlParser';

interface TermReviewTableProps {
  terms: TranslationTerm[];
  usedKeys: Set<string>;
  onSelectionChange: (keptKeys: Set<string>) => void;
}

const TermReviewTable: React.FC<TermReviewTableProps> = ({ terms, usedKeys, onSelectionChange }) => {
  const [checkedTerms, setCheckedTerms] = useState<Set<string>>(new Set());

  useEffect(() => {
    const defaultChecked = new Set(terms.map(t => t.key).filter(k => usedKeys.has(k)));
    setCheckedTerms(defaultChecked);
    onSelectionChange(defaultChecked);
  }, [terms, usedKeys, onSelectionChange]);
 

  const toggleTerm = (key: string) => {
    const updated = new Set(checkedTerms);
    if (updated.has(key)) {
      updated.delete(key);
    } else {
      updated.add(key);
    }
    setCheckedTerms(updated);
    onSelectionChange(updated);
  };

  return (
    <div className="table-responsive mt-4">
      <table className="table table-bordered table-hover">
        <thead className="table-light">
          <tr>
            <th scope="col">Keep</th>
            <th scope="col">Key</th>
            <th scope="col">Text</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {terms.map(term => {
            const isUsed = usedKeys.has(term.key);
            const isChecked = checkedTerms.has(term.key);

            return (
              <tr key={term.key} className={isUsed ? '' : 'table-warning'}>
                <td>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleTerm(term.key)}
                  />
                </td>
                <td>{term.key}</td>
                <td>{term.text}</td>
                <td>{isUsed ? '✅ Used' : '❌ Unused'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default TermReviewTable;
