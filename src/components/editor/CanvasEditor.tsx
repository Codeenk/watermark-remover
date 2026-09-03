"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";

export type Tool = "brush" | "rectangle" | "eraser";

interface CanvasEditorProps {
  image: HTMLImageElement | HTMLCanvasElement | null;
  width: number;
  height: number;
  tool: Tool;
  brushSize: number;
  onMaskChange: (mask: HTMLCanvasElement) => void;
}

export function CanvasEditor({
  image,
  width,
  height,
  tool,
  brushSize,
  onMaskChange,
}: CanvasEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(1);

  // Initialize canvases
  useEffect(() => {
    if (!image || !containerRef.current) return;

    const container = containerRef.current;
    const maxW = container.clientWidth - 32;
    const maxH = container.clientHeight - 32;

    const s = Math.min(maxW / width, maxH / height, 1);
    setScale(s);

    const canvasW = Math.round(width * s);
    const canvasH = Math.round(height * s);

    // Image canvas
    const imgCanvas = imageCanvasRef.current!;
    imgCanvas.width = canvasW;
    imgCanvas.height = canvasH;
    const imgCtx = imgCanvas.getContext("2d")!;
    imgCtx.imageSmoothingEnabled = true;
    imgCtx.imageSmoothingQuality = "high";
    imgCtx.drawImage(image, 0, 0, canvasW, canvasH);

    // Mask canvas (full resolution)
    const maskCanvas = maskCanvasRef.current!;
    maskCanvas.width = width;
    maskCanvas.height = height;

    // Overlay canvas (scaled)
    const overlayCanvas = overlayCanvasRef.current!;
    overlayCanvas.width = canvasW;
    overlayCanvas.height = canvasH;
  }, [image, width, height]);

  const getPos = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = overlayCanvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const clientX =
        "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY =
        "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    },
    []
  );

  const drawBrush = useCallback(
    (x: number, y: number, isEraser = false) => {
      const maskCanvas = maskCanvasRef.current!;
      const overlayCanvas = overlayCanvasRef.current!;
      const maskCtx = maskCanvas.getContext("2d")!;
      const overlayCtx = overlayCanvas.getContext("2d")!;

      // Draw on mask (full res)
      maskCtx.beginPath();
      maskCtx.arc(
        x / scale,
        y / scale,
        brushSize / 2,
        0,
        Math.PI * 2
      );
      maskCtx.fillStyle = isEraser ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)";
      maskCtx.fill();

      // Draw on overlay (scaled)
      overlayCtx.beginPath();
      overlayCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      overlayCtx.fillStyle = isEraser
        ? "rgba(0,0,0,0.5)"
        : "rgba(255,100,100,0.4)";
      overlayCtx.fill();

      // Draw stroke between points for smooth lines
      if (lastPos.current) {
        maskCtx.beginPath();
        maskCtx.moveTo(lastPos.current.x / scale, lastPos.current.y / scale);
        maskCtx.lineTo(x / scale, y / scale);
        maskCtx.lineWidth = brushSize;
        maskCtx.lineCap = "round";
        maskCtx.strokeStyle = isEraser
          ? "rgba(0,0,0,1)"
          : "rgba(255,255,255,1)";
        maskCtx.stroke();

        overlayCtx.beginPath();
        overlayCtx.moveTo(lastPos.current.x, lastPos.current.y);
        overlayCtx.lineTo(x, y);
        overlayCtx.lineWidth = brushSize;
        overlayCtx.lineCap = "round";
        overlayCtx.strokeStyle = isEraser
          ? "rgba(0,0,0,0.5)"
          : "rgba(255,100,100,0.4)";
        overlayCtx.stroke();
      }

      lastPos.current = { x, y };
    },
    [brushSize, scale]
  );

  const handleStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      setIsDrawing(true);
      const pos = getPos(e);
      lastPos.current = null;

      if (tool === "rectangle") {
        setRectStart(pos);
      } else {
        drawBrush(pos.x, pos.y, tool === "eraser");
      }
    },
    [tool, getPos, drawBrush]
  );

  const handleMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);

      if (tool === "brush" || tool === "eraser") {
        drawBrush(pos.x, pos.y, tool === "eraser");
      } else if (tool === "rectangle" && rectStart) {
        // Draw rectangle preview on overlay
        const overlayCanvas = overlayCanvasRef.current!;
        const overlayCtx = overlayCanvas.getContext("2d")!;
        overlayCtx.clearRect(
          0,
          0,
          overlayCanvas.width,
          overlayCanvas.height
        );
        overlayCtx.strokeStyle = "rgba(255,100,100,0.8)";
        overlayCtx.lineWidth = 2;
        overlayCtx.setLineDash([5, 5]);
        overlayCtx.strokeRect(
          rectStart.x,
          rectStart.y,
          pos.x - rectStart.x,
          pos.y - rectStart.y
        );
        overlayCtx.fillStyle = "rgba(255,100,100,0.2)";
        overlayCtx.fillRect(
          rectStart.x,
          rectStart.y,
          pos.x - rectStart.x,
          pos.y - rectStart.y
        );
      }
    },
    [isDrawing, tool, rectStart, getPos, drawBrush]
  );

  const handleEnd = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing) return;
      setIsDrawing(false);
      lastPos.current = null;

      if (tool === "rectangle" && rectStart) {
        const pos = getPos(e as React.MouseEvent);
        const maskCanvas = maskCanvasRef.current!;
        const maskCtx = maskCanvas.getContext("2d")!;

        const x1 = Math.min(rectStart.x, pos.x) / scale;
        const y1 = Math.min(rectStart.y, pos.y) / scale;
        const x2 = Math.max(rectStart.x, pos.x) / scale;
        const y2 = Math.max(rectStart.y, pos.y) / scale;

        maskCtx.fillStyle = "rgba(255,255,255,1)";
        maskCtx.fillRect(x1, y1, x2 - x1, y2 - y1);

        setRectStart(null);
      }

      onMaskChange(maskCanvasRef.current!);
    },
    [isDrawing, tool, rectStart, scale, getPos, onMaskChange]
  );

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center w-full h-full overflow-hidden"
    >
      <canvas
        ref={imageCanvasRef}
        className="absolute"
        style={{ imageRendering: "auto" }}
      />
      <canvas
        ref={overlayCanvasRef}
        className="absolute cursor-crosshair"
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
      />
      <canvas ref={maskCanvasRef} className="hidden" />
    </div>
  );
}
