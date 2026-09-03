"use client";

import React, { useState, useRef, useCallback } from "react";
import { Slider } from "@/components/ui/slider";

interface ComparisonViewProps {
  originalSrc: string;
  processedSrc: string;
}

export function ComparisonView({ originalSrc, processedSrc }: ComparisonViewProps) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientX =
        "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const x = clientX - rect.left;
      setPosition(Math.max(0, Math.min(100, (x / rect.width) * 100)));
    },
    []
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl border border-zinc-800 cursor-col-resize select-none"
        onMouseMove={(e) => {
          if (e.buttons === 1) handleMove(e);
        }}
        onTouchMove={handleMove}
        onClick={handleMove}
      >
        {/* Original (left side) */}
        <img
          src={originalSrc}
          alt="Original"
          className="w-full h-auto block"
          draggable={false}
        />

        {/* Processed (right side, clipped) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 0 0 ${position}%)` }}
        >
          <img
            src={processedSrc}
            alt="Processed"
            className="w-full h-auto block"
            draggable={false}
          />
        </div>

        {/* Slider line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10"
          style={{ left: `${position}%` }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-xl flex items-center justify-center">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="text-zinc-900"
            >
              <path
                d="M6 10L2 10M2 10L5 7M2 10L5 13M14 10L18 10M18 10L15 7M18 10L15 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Labels */}
        <div className="absolute top-3 left-3 px-2 py-1 bg-black/70 rounded text-xs text-white font-medium z-10">
          Original
        </div>
        <div className="absolute top-3 right-3 px-2 py-1 bg-black/70 rounded text-xs text-white font-medium z-10">
          Processed
        </div>
      </div>

      <div className="px-4">
        <Slider
          value={[position]}
          onValueChange={(v) => setPosition(v[0])}
          min={0}
          max={100}
          step={1}
        />
      </div>
    </div>
  );
}
