// src/components/FileUpload.tsx
import React from "react";

interface FileUploadProps {
  label: string;
  accept: string;
  onFileSelect: (file: File) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({
  label,
  accept,
  onFileSelect,
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  return (
    <div className="mb-4 text-center">
      <label className="form-label fw-semibold">{label}</label>
      <div>
        <input
          id="file-input"
          type="file"
          className="d-none"
          accept={accept}
          onChange={handleChange}
        />
        <label htmlFor="file-input" className="btn btn-primary">
          Upload File
        </label>
      </div>
    </div>
  );
};

export default FileUpload;
