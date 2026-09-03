"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface ProgressProps {
  stage: string;
  progress: number;
  className?: string;
}

export function Progress({ stage, progress, className }: ProgressProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2 text-sm text-zinc-300">
        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
        <span>{stage}</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="absolute h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="text-xs text-zinc-500 text-right">{Math.round(progress)}%</div>
    </div>
  );
}
