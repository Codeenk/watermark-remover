import { loadModel, runInference, type ModelType } from "../models/onnx-runtime";
import { downsampleForModel, compositeResult } from "../utils/canvas-utils";
import { fastInpaint } from "./fast-inpaint";

export interface ProcessVideoOptions {
  modelType: ModelType;
  fastMode?: boolean;
  timeRange?: { start: number; end: number };
  onProgress?: (stage: string, progress: number) => void;
  onFrameProgress?: (frame: number, total: number) => void;
  cancelToken?: { cancelled: boolean };
}

export async function processVideo(
  videoElement: HTMLVideoElement,
  mask: ImageData,
  options: ProcessVideoOptions
): Promise<Blob> {
  const {
    modelType,
    fastMode = true,
    timeRange,
    onProgress,
    onFrameProgress,
    cancelToken,
  } = options;

  if (!fastMode) {
    onProgress?.("Loading AI model...", 0);
    await loadModel(modelType);
    onProgress?.("AI model ready", 100);
  }

  const duration = videoElement.duration;
  const startTime = timeRange?.start ?? 0;
  const endTime = timeRange?.end ?? duration;

  // Estimate FPS and frame count
  const fps = 30; // approximate
  const totalFrames = Math.ceil((endTime - startTime) * fps);

  onProgress?.("Extracting frames...", 5);

  // Extract frames using canvas
  const frames: ImageData[] = [];
  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = videoElement.videoWidth;
  frameCanvas.height = videoElement.videoHeight;
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true })!;

  // Seek to start
  videoElement.currentTime = startTime;
  await new Promise((resolve) => {
    videoElement.onseeked = resolve;
  });

  // Extract frames
  for (let t = startTime; t < endTime && !cancelToken?.cancelled; t += 1 / fps) {
    videoElement.currentTime = t;
    await new Promise((resolve) => {
      videoElement.onseeked = resolve;
    });

    frameCtx.drawImage(videoElement, 0, 0);
    frames.push(frameCtx.getImageData(0, 0, frameCanvas.width, frameCanvas.height));

    onFrameProgress?.(frames.length, totalFrames);
  }

  if (cancelToken?.cancelled) {
    throw new Error("Processing cancelled");
  }

  onProgress?.("Processing frames...", 10);

  // Process each frame
  const processedFrames: ImageData[] = [];
  const originalWidth = videoElement.videoWidth;
  const originalHeight = videoElement.videoHeight;

  for (let i = 0; i < frames.length; i++) {
    if (cancelToken?.cancelled) throw new Error("Processing cancelled");

    const frameData = frames[i];

    if (fastMode) {
      try {
        const { inpaintWithOpenCV } = await import("./opencv-inpaint");
        const inpainted = await inpaintWithOpenCV(frameData, mask, "telea", 7);
        processedFrames.push(inpainted);
      } catch {
        const inpainted = fastInpaint(frameData, mask);
        processedFrames.push(inpainted);
      }
    } else {
      const { data: downsampled, scale } = downsampleForModel(frameData, 512);
      const srcCanvas = document.createElement("canvas");
      srcCanvas.width = mask.width;
      srcCanvas.height = mask.height;
      const srcCtx = srcCanvas.getContext("2d")!;
      srcCtx.putImageData(mask, 0, 0);
      const modelSize = 512;
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = modelSize;
      maskCanvas.height = modelSize;
      const maskCtx = maskCanvas.getContext("2d")!;
      maskCtx.imageSmoothingEnabled = false;
      maskCtx.drawImage(srcCanvas, 0, 0, modelSize, modelSize);
      const resizedMask = maskCtx.getImageData(0, 0, modelSize, modelSize);
      const result = await runInference(downsampled, resizedMask, modelType);
      const composited = compositeResult(frameData, result, resizedMask, 0, 0, scale);
      processedFrames.push(composited);
    }

    const progress = 10 + (i / frames.length) * 80;
    onProgress?.(`Processing frame ${i + 1}/${frames.length}`, progress);
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  onProgress?.("Encoding video...", 95);

  // Encode frames back to video using canvas recording
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = originalWidth;
  outputCanvas.height = originalHeight;
  const outputCtx = outputCanvas.getContext("2d")!;

  const stream = outputCanvas.captureStream(fps);
  const chunks: Blob[] = [];

  const mimeTypes = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  let mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  if (!mimeType) throw new Error("No supported video codec found in this browser");

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8000000,
  });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType.split(";")[0] }));
    };
    recorder.onerror = reject;

    recorder.start();

    let frameIdx = 0;
    const playFrame = () => {
      if (frameIdx >= processedFrames.length || cancelToken?.cancelled) {
        recorder.stop();
        return;
      }

      outputCtx.putImageData(processedFrames[frameIdx], 0, 0);
      frameIdx++;
      requestAnimationFrame(playFrame);
    };

    playFrame();
  });
}
