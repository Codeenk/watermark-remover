import { loadModel, runInference, type ModelType } from "../models/onnx-runtime";
import { downsampleForModel, compositeResult } from "../utils/canvas-utils";

export interface ProcessVideoOptions {
  modelType: ModelType;
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
  const { modelType, timeRange, onProgress, onFrameProgress, cancelToken } =
    options;

  onProgress?.("Loading AI model...", 0);
  await loadModel(modelType);
  onProgress?.("AI model ready", 100);

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
    const { data: downsampled, scale } = downsampleForModel(frameData, 512);

    // Resize mask
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

    const composited = compositeResult(
      frameData,
      result,
      resizedMask,
      0,
      0,
      scale
    );

    processedFrames.push(composited);

    const progress = 10 + (i / frames.length) * 80;
    onProgress?.(`Processing frame ${i + 1}/${frames.length}`, progress);
  }

  onProgress?.("Encoding video...", 95);

  // Encode frames back to video using canvas recording
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = originalWidth;
  outputCanvas.height = originalHeight;
  const outputCtx = outputCanvas.getContext("2d")!;

  // Use MediaRecorder to encode
  const stream = outputCanvas.captureStream(fps);
  const chunks: Blob[] = [];

  const recorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9",
    videoBitsPerSecond: 8000000,
  });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: "video/webm" }));
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
