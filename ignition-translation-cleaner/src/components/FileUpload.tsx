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
      <div className="d-flex justify-content-center">
        <input
          type="file"
          className="form-control w-auto"
          accept={accept}
          onChange={handleChange}
        />
      </div>
    </div>
  );
};

export default FileUpload;
