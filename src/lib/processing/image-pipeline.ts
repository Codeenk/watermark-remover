import { loadModel, runInference, type ModelType } from "../models/onnx-runtime";
import {
  downsampleForModel,
  compositeResult,
  maskFromBounds,
} from "../utils/canvas-utils";
import { refineMask } from "../utils/mask-ops";
import type { DetectionRegion } from "../detection/auto-detect";

export interface ProcessImageOptions {
  modelType: ModelType;
  onProgress?: (stage: string, progress: number) => void;
}

export async function processImage(
  imageSource: HTMLImageElement,
  mask: ImageData,
  options: ProcessImageOptions
): Promise<Blob> {
  const { modelType, onProgress } = options;

  onProgress?.("Loading AI model...", 0);
  await loadModel(modelType);
  onProgress?.("AI model ready", 100);

  // Get original image data
  const origCanvas = document.createElement("canvas");
  origCanvas.width = imageSource.naturalWidth;
  origCanvas.height = imageSource.naturalHeight;
  const origCtx = origCanvas.getContext("2d")!;
  origCtx.drawImage(imageSource, 0, 0);
  const originalImageData = origCtx.getImageData(
    0,
    0,
    origCanvas.width,
    origCanvas.height
  );

  onProgress?.("Preparing image...", 20);

  // Downsample for model
  const { data: downsampledImage, scale } = downsampleForModel(
    originalImageData,
    512
  );

  const refinedMaskFull = refineMask(mask, 12, 8);

  // Resize mask to match
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = refinedMaskFull.width;
  srcCanvas.height = refinedMaskFull.height;
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.putImageData(refinedMaskFull, 0, 0);

  const maskCanvas = document.createElement("canvas");
  const modelSize = 512;
  maskCanvas.width = modelSize;
  maskCanvas.height = modelSize;
  const maskCtx = maskCanvas.getContext("2d")!;
  maskCtx.imageSmoothingEnabled = false;
  maskCtx.drawImage(srcCanvas, 0, 0, modelSize, modelSize);
  const resizedMask = maskCtx.getImageData(0, 0, modelSize, modelSize);

  onProgress?.("Running AI inpainting...", 40);

  // Run inference
  const result = await runInference(downsampledImage, resizedMask, modelType);

  onProgress?.("Compositing result...", 80);

  // Composite the inpainted region back onto the original
  const finalResult = compositeResult(
    originalImageData,
    result,
    resizedMask,
    0,
    0,
    scale
  );

  onProgress?.("Encoding output...", 95);

  // Encode to blob
  const outCanvas = document.createElement("canvas");
  outCanvas.width = originalImageData.width;
  outCanvas.height = originalImageData.height;
  const outCtx = outCanvas.getContext("2d")!;
  outCtx.putImageData(finalResult, 0, 0);

  return new Promise((resolve) => {
    outCanvas.toBlob((blob) => resolve(blob!), "image/png", 1);
  });
}

export function createMaskFromRegions(
  regions: DetectionRegion[],
  imageWidth: number,
  imageHeight: number,
  padding = 14
): ImageData {
  const bounds = regions.map((r) => ({
    x: r.x,
    y: r.y,
    w: r.width,
    h: r.height,
  }));
  return maskFromBounds(bounds, imageWidth, imageHeight, padding);
}

export function createMaskFromCanvas(
  maskCanvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number
): ImageData {
  const ctx = maskCanvas.getContext("2d")!;
  return ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
}
