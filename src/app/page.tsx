"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { UploadZone } from "@/components/upload/UploadZone";
import { CanvasEditor, type Tool } from "@/components/editor/CanvasEditor";
import { ComparisonView } from "@/components/editor/ComparisonView";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { WatermarkDetector, type DetectionRegion } from "@/lib/detection/auto-detect";
import { processImage, createMaskFromRegions } from "@/lib/processing/image-pipeline";
import { processVideo } from "@/lib/processing/video-pipeline";
import { downloadBlob } from "@/lib/utils/file-utils";
import {
  Paintbrush,
  Square,
  Eraser,
  Wand2,
  Download,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Image,
  Film,
  Settings2,
  Loader2,
  Check,
  X,
  ChevronDown,
  Layers,
} from "lucide-react";

type MediaType = "image" | "video";
type AppState = "upload" | "edit" | "processing" | "done";

export default function WatermarkRemoverApp() {
  // State
  const [state, setState] = useState<AppState>("upload");
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string>("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [processedSrc, setProcessedSrc] = useState<string>("");
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(30);
  const [sensitivity, setSensitivity] = useState(0.5);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [detectedRegions, setDetectedRegions] = useState<DetectionRegion[]>([]);
  const [processingProgress, setProcessingProgress] = useState({ stage: "", progress: 0 });
  const [modelType, setModelType] = useState<"lama" | "migan">("migan");
  const [videoFastMode, setVideoFastMode] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [hasMask, setHasMask] = useState(false);

  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Handle file selection
  const handleFileSelect = useCallback((file: File, type: MediaType) => {
    setMediaType(type);
    const url = URL.createObjectURL(file);

    if (type === "image") {
      setVideoFile(null);
      setVideoSrc("");
      const img = new window.Image();
      img.onload = () => {
        setImage(img);
        setImageSrc(url);
        setState("edit");
      };
      img.src = url;
    } else {
      setVideoFile(file);
      setVideoSrc(url);
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      videoRef.current = video;
      video.onloadeddata = () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(video, 0, 0);
        const img = new window.Image();
        img.onload = () => {
          setImage(img);
          setImageSrc(canvas.toDataURL());
          setState("edit");
        };
        img.src = canvas.toDataURL();
      };
      video.onerror = () => {
        setImage(null);
        setState("upload");
      };
    }
  }, []);

  // Auto-detect watermarks
  const handleAutoDetect = useCallback(async () => {
    if (!image) return;
    setIsAutoDetecting(true);

    try {
      const detector = new WatermarkDetector();
      const regions = await detector.detect(image, {
        sensitivity,
        types: ["text", "logo", "overlay", "tiled"],
        minRegionSize: 20,
        maxRegionSize: 2000,
      });

      setDetectedRegions(regions);

      if (regions.length > 0 && image) {
        const mask = createMaskFromRegions(
          regions,
          image.naturalWidth,
          image.naturalHeight
        );

        // Create a canvas from mask for the editor
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = mask.width;
        maskCanvas.height = mask.height;
        const ctx = maskCanvas.getContext("2d")!;
        ctx.putImageData(mask, 0, 0);
        maskRef.current = maskCanvas;
        setHasMask(true);
      }
    } catch (err) {
      console.error("Auto-detect failed:", err);
    } finally {
      setIsAutoDetecting(false);
    }
  }, [image, sensitivity]);

  // Handle mask changes from editor
  const handleMaskChange = useCallback((maskCanvas: HTMLCanvasElement) => {
    maskRef.current = maskCanvas;
    setHasMask(true);
  }, []);

  // Process image or video
  const handleProcess = useCallback(async () => {
    if (!image || !maskRef.current) return;

    setState("processing");

    try {
      const maskCtx = maskRef.current.getContext("2d")!;
      const maskData = maskCtx.getImageData(
        0,
        0,
        maskRef.current.width,
        maskRef.current.height
      );

      if (mediaType === "video" && videoRef.current && videoSrc) {
        const videoEl = document.createElement("video");
        videoEl.src = videoSrc;
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          videoEl.onloadedmetadata = () => resolve();
          videoEl.onerror = () => reject(new Error("Failed to load video"));
          setTimeout(() => reject(new Error("Video load timeout")), 10000);
        });

        const resultBlob = await processVideo(videoEl, maskData, {
          modelType,
          fastMode: videoFastMode,
          onProgress: (stage, progress) => {
            setProcessingProgress({ stage, progress });
          },
        });

        const resultUrl = URL.createObjectURL(resultBlob);
        setProcessedSrc(resultUrl);
        setProcessedBlob(resultBlob);
        setState("done");
      } else {
        const resultBlob = await processImage(image, maskData, {
          modelType,
          onProgress: (stage, progress) => {
            setProcessingProgress({ stage, progress });
          },
        });

        const resultUrl = URL.createObjectURL(resultBlob);
        setProcessedSrc(resultUrl);
        setProcessedBlob(resultBlob);
        setState("done");
      }
    } catch (err) {
      console.error("Processing failed:", err);
      alert(`Processing failed: ${err instanceof Error ? err.message : String(err)}`);
      setState("edit");
    }
  }, [image, mediaType, videoSrc, modelType, videoFastMode]);

  // Download result
  const handleDownload = useCallback(() => {
    if (processedBlob) {
      const ext = mediaType === "video" ? "webm" : "png";
      downloadBlob(processedBlob, `watermark-removed-${Date.now()}.${ext}`);
      return;
    }
    if (!processedSrc) return;
    fetch(processedSrc)
      .then((r) => r.blob())
      .then((blob) => {
        const ext = mediaType === "video" ? "webm" : "png";
        downloadBlob(blob, `watermark-removed-${Date.now()}.${ext}`);
      });
  }, [processedSrc, processedBlob, mediaType]);

  // Reset
  const handleReset = useCallback(() => {
    setState("upload");
    setImage(null);
    setImageSrc("");
    setVideoFile(null);
    setVideoSrc("");
    setProcessedSrc("");
    setProcessedBlob(null);
    setDetectedRegions([]);
    setHasMask(false);
    maskRef.current = null;
    videoRef.current = null;
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                WatermarkRemover
              </h1>
              <p className="text-xs text-zinc-500">
                Free &middot; Private &middot; Runs in your browser
              </p>
            </div>
          </div>

          {state !== "upload" && (
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              New file
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {state === "upload" && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold mb-3">
                Remove watermarks
                <span className="text-blue-400"> instantly</span>
              </h2>
              <p className="text-zinc-400 max-w-md mx-auto">
                AI-powered watermark removal that runs entirely in your browser.
                No uploads. No sign-ups. Completely free.
              </p>
            </div>
            <UploadZone onFileSelect={handleFileSelect} />
          </div>
        )}

        {(state === "edit" || state === "processing" || state === "done") && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            {/* Canvas Area */}
            <div className="relative bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
              {state === "done" && processedSrc ? (
                mediaType === "video" ? (
                  <div className="p-4 flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-zinc-500 mb-2">Original</p>
                        <video src={videoSrc} controls className="w-full rounded-lg border border-zinc-700" />
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500 mb-2">Processed</p>
                        <video src={processedSrc} controls autoPlay loop className="w-full rounded-lg border border-zinc-700" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4">
                    <ComparisonView
                      originalSrc={imageSrc}
                      processedSrc={processedSrc}
                    />
                  </div>
                )
              ) : (
                <div className="aspect-[4/3] relative">
                  {mediaType === "video" && (
                    <div className="absolute top-2 left-2 z-10 px-2 py-1 bg-blue-600 rounded text-xs font-medium flex items-center gap-1.5">
                      <Film className="w-3 h-3" /> Video mode — mask applies to all frames
                    </div>
                  )}
                  <CanvasEditor
                    image={image}
                    width={image?.naturalWidth || 800}
                    height={image?.naturalHeight || 600}
                    tool={tool}
                    brushSize={brushSize}
                    onMaskChange={handleMaskChange}
                  />

                  {state === "processing" && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-sm w-full mx-4">
                        <Progress
                          stage={processingProgress.stage}
                          progress={processingProgress.progress}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="flex flex-col gap-4">
              {/* Tool Selection */}
              {state === "edit" && (
                <>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-zinc-300 mb-3">
                      Detection Mode
                    </h3>
                    <div className="flex gap-2 mb-4">
                      <button
                        onClick={handleAutoDetect}
                        disabled={isAutoDetecting}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
                      >
                        {isAutoDetecting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Wand2 className="w-4 h-4" />
                        )}
                        Auto Detect
                      </button>
                    </div>

                    <div className="mb-4">
                      <label className="text-xs text-zinc-500 mb-2 block">
                        Detection Sensitivity
                      </label>
                      <Slider
                        value={[sensitivity]}
                        onValueChange={(v) => setSensitivity(v[0])}
                        min={0.1}
                        max={1}
                        step={0.1}
                      />
                      <div className="flex justify-between text-xs text-zinc-600 mt-1">
                        <span>Conservative</span>
                        <span>Aggressive</span>
                      </div>
                    </div>

                    {detectedRegions.length > 0 && (
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        <Check className="w-4 h-4" />
                        Found {detectedRegions.length} watermark region
                        {detectedRegions.length !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>

                  {/* Manual Tools */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-zinc-300 mb-3">
                      Manual Tools
                    </h3>
                    <div className="flex gap-2 mb-4">
                      <button
                        onClick={() => setTool("brush")}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                          tool === "brush"
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                        }`}
                      >
                        <Paintbrush className="w-4 h-4" />
                        Brush
                      </button>
                      <button
                        onClick={() => setTool("rectangle")}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                          tool === "rectangle"
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                        }`}
                      >
                        <Square className="w-4 h-4" />
                        Rectangle
                      </button>
                      <button
                        onClick={() => setTool("eraser")}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                          tool === "eraser"
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                        }`}
                      >
                        <Eraser className="w-4 h-4" />
                        Eraser
                      </button>
                    </div>

                    <div>
                      <label className="text-xs text-zinc-500 mb-2 block">
                        Brush Size: {brushSize}px
                      </label>
                      <Slider
                        value={[brushSize]}
                        onValueChange={(v) => setBrushSize(v[0])}
                        min={5}
                        max={200}
                        step={5}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Settings */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="flex items-center justify-between w-full text-sm font-semibold text-zinc-300"
                >
                  <span className="flex items-center gap-2">
                    <Settings2 className="w-4 h-4" />
                    Settings
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${
                      showSettings ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {showSettings && (
                  <div className="mt-4 space-y-3">
                    {mediaType === "video" && (
                      <div>
                        <label className="text-xs text-zinc-500 mb-2 block">
                          Video Mode
                        </label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setVideoFastMode(true)}
                            className={`flex-1 px-3 py-2 rounded-lg text-xs transition-colors ${
                              videoFastMode
                                ? "bg-green-600 text-white"
                                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                            }`}
                          >
                            Fast
                            <span className="block text-[10px] opacity-60">10-50x realtime</span>
                          </button>
                          <button
                            onClick={() => setVideoFastMode(false)}
                            className={`flex-1 px-3 py-2 rounded-lg text-xs transition-colors ${
                              !videoFastMode
                                ? "bg-blue-600 text-white"
                                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                            }`}
                          >
                            AI Quality
                            <span className="block text-[10px] opacity-60">Slower, better</span>
                          </button>
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-zinc-500 mb-2 block">
                        AI Model
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setModelType("lama")}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs transition-colors ${
                            modelType === "lama"
                              ? "bg-blue-600 text-white"
                              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                          }`}
                        >
                          LaMa
                          <span className="block text-[10px] opacity-60">
                            Higher quality
                          </span>
                        </button>
                        <button
                          onClick={() => setModelType("migan")}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs transition-colors ${
                            modelType === "migan"
                              ? "bg-blue-600 text-white"
                              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                          }`}
                        >
                          MI-GAN
                          <span className="block text-[10px] opacity-60">
                            Faster
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Button */}
              {state === "edit" && (
                <button
                  onClick={handleProcess}
                  disabled={!hasMask}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-500/20"
                >
                  {mediaType === "image" ? (
                    <Image className="w-4 h-4" />
                  ) : (
                    <Film className="w-4 h-4" />
                  )}
                  Remove Watermark
                </button>
              )}

              {/* Download Button */}
              {state === "done" && (
                <>
                  <button
                    onClick={handleDownload}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-green-500/20"
                  >
                    <Download className="w-4 h-4" />
                    Download Result
                  </button>
                  <button
                    onClick={handleReset}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-medium text-zinc-300 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Start Over
                  </button>
                </>
              )}

              {/* Tips */}
              <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4 text-xs text-zinc-500">
                <p className="font-medium text-zinc-400 mb-2">Tips</p>
                <ul className="space-y-1.5">
                  <li>• Use Auto Detect first for quick results</li>
                  <li>• Fine-tune with brush/rectangle tools</li>
                  <li>• Increase sensitivity for faint watermarks</li>
                  <li>• All processing is local — your files stay private</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 px-6 py-6 mt-12">
        <div className="max-w-7xl mx-auto text-center text-xs text-zinc-600">
          <p>
            Powered by LaMa & MI-GAN inpainting models running via ONNX Runtime
            Web.
          </p>
          <p className="mt-1">
            100% client-side processing. No data leaves your browser.
          </p>
        </div>
      </footer>
    </div>
  );
}
