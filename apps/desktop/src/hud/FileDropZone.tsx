import { FilePlus, X } from "lucide-react";
import { useCallback, useState, type Ref } from "react";
import clsx from "clsx";
import { formatBytes } from "../lib/format";
import type { AttachedFile } from "../state/types";

type FileDropZoneProps = {
  files: AttachedFile[];
  inputId?: string;
  inputRef?: Ref<HTMLInputElement>;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  disabled?: boolean;
};

export function FileDropZone({ files, inputId, inputRef, onAddFiles, onRemoveFile, disabled }: FileDropZoneProps) {
  const [dragActive, setDragActive] = useState(false);

  const ingestFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || disabled) return;
      onAddFiles(Array.from(fileList));
    },
    [disabled, onAddFiles],
  );

  return (
    <div
      className={clsx("file-drop", dragActive && "is-dragging", disabled && "is-disabled")}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => {
        if (disabled) return;
        setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (disabled) return;
        setDragActive(false);
        ingestFiles(event.dataTransfer.files);
      }}
    >
      <label className="file-drop__label" htmlFor={inputId}>
        <FilePlus size={18} />
        <span>Attach assets</span>
        <input
          id={inputId}
          ref={inputRef}
          data-testid="file-input"
          className="file-drop__input"
          type="file"
          multiple
          disabled={disabled}
          onChange={(event) => {
            ingestFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </label>

      {files.length > 0 && (
        <div className="file-list">
          {files.map((file) => (
            <div className="file-pill" key={file.id}>
              <span>{file.name}</span>
              <small>{formatBytes(file.size)}</small>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemoveFile(file.id)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
