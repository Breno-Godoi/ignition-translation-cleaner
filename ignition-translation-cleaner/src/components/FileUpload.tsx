// src/components/FileUpload.tsx
import React from 'react';

interface FileUploadProps {
  label: string;
  accept: string;
  onFileSelect: (file: File) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ label, accept, onFileSelect }) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  return (
    <div className="mb-3">
      <label className="form-label">{label}</label>
      <input
        type="file"
        className="form-control"
        accept={accept}
        onChange={handleChange}
      />
    </div>
  );
};

export default FileUpload;
