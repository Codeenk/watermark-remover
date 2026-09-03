"use client";

import React, { useCallback, useRef, useState } from "react";
import { Upload, Image, Film, X } from "lucide-react";
import { ACCEPTED_TYPES, isImageFile, isVideoFile } from "@/lib/utils/file-utils";

interface UploadZoneProps {
  onFileSelect: (file: File, type: "image" | "video") => void;
}

export function UploadZone({ onFileSelect }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (isImageFile(file)) {
        onFileSelect(file, "image");
      } else if (isVideoFile(file)) {
        onFileSelect(file, "video");
      }
    },
    [onFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => inputRef.current?.click()}
      className={`
        relative flex flex-col items-center justify-center gap-6 p-16
        border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300
        ${
          isDragging
            ? "border-blue-500 bg-blue-500/10 scale-[1.02]"
            : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-500 hover:bg-zinc-800/50"
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
        className="hidden"
      />

      <div
        className={`
          p-6 rounded-full transition-all duration-300
          ${isDragging ? "bg-blue-500/20" : "bg-zinc-800"}
        `}
      >
        <Upload
          className={`w-10 h-10 transition-colors ${
            isDragging ? "text-blue-400" : "text-zinc-400"
          }`}
        />
      </div>

      <div className="text-center">
        <h3 className="text-lg font-semibold text-zinc-100 mb-2">
          Drop your image or video here
        </h3>
        <p className="text-sm text-zinc-400">
          or click to browse files
        </p>
      </div>

      <div className="flex items-center gap-6 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <Image className="w-3.5 h-3.5" />
          PNG, JPEG, WebP, BMP
        </span>
        <span className="flex items-center gap-1.5">
          <Film className="w-3.5 h-3.5" />
          MP4, WebM, MOV, AVI
        </span>
      </div>

      <p className="text-xs text-zinc-600 max-w-md text-center">
        All processing happens in your browser. Your files never leave your device.
      </p>
    </div>
  );
}
