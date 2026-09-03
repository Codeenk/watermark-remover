"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number[];
  onValueChange: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ className, value, onValueChange, min = 0, max = 100, step = 1, ...props }, ref) => {
    const trackRef = React.useRef<HTMLDivElement>(null);
    const percentage = ((value[0] - min) / (max - min)) * 100;

    const handleInteraction = React.useCallback(
      (clientX: number) => {
        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const newValue = Math.round((percent * (max - min) + min) / step) * step;
        onValueChange([Math.max(min, Math.min(max, newValue))]);
      },
      [min, max, step, onValueChange]
    );

    return (
      <div
        ref={ref}
        className={cn("relative flex w-full touch-none select-none items-center", className)}
        {...props}
      >
        <div
          ref={trackRef}
          className="relative h-2 w-full grow overflow-hidden rounded-full bg-zinc-800 cursor-pointer"
          onMouseDown={(e) => handleInteraction(e.clientX)}
          onTouchStart={(e) => handleInteraction(e.touches[0].clientX)}
        >
          <div
            className="absolute h-full bg-blue-500 rounded-full"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div
          className="absolute h-5 w-5 rounded-full border-2 border-blue-500 bg-white shadow cursor-grab active:cursor-grabbing"
          style={{ left: `calc(${percentage}% - 10px)` }}
          onMouseDown={(e) => {
            const move = (me: MouseEvent) => handleInteraction(me.clientX);
            const up = () => {
              window.removeEventListener("mousemove", move);
              window.removeEventListener("mouseup", up);
            };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
          }}
        />
      </div>
    );
  }
);
Slider.displayName = "Slider";

export { Slider };
