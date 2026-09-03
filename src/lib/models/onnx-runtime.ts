import * as ort from "onnxruntime-web";

type ExecutionProvider = "webgpu" | "wasm";

const sessions: Map<ModelType, ort.InferenceSession> = new Map();
let currentProvider: ExecutionProvider = "wasm";

const LAMA_MODEL_URL =
  "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx";

const MIGAN_MODEL_URL =
  "https://huggingface.co/lxfater/inpaint-web/resolve/main/migan.onnx";

export type ModelType = "lama" | "migan";

export interface ModelConfig {
  type: ModelType;
  url: string;
  inputSize: number;
}

const MODELS: Record<ModelType, ModelConfig> = {
  lama: { type: "lama", url: LAMA_MODEL_URL, inputSize: 512 },
  migan: { type: "migan", url: MIGAN_MODEL_URL, inputSize: 512 },
};

export async function getAvailableProvider(): Promise<ExecutionProvider> {
  try {
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch {}
  return "wasm";
}

export async function loadModel(
  modelType: ModelType = "lama",
  onProgress?: (progress: number) => void
): Promise<ort.InferenceSession> {
  const cached = sessions.get(modelType);
  if (cached) return cached;

  if (typeof window !== "undefined") {
    try {
      ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
    } catch {}
  }

  const config = MODELS[modelType];
  currentProvider = await getAvailableProvider();

  const executionProviders: ExecutionProvider[] = [currentProvider];
  if (currentProvider === "webgpu") {
    executionProviders.push("wasm");
  }

  onProgress?.(0);

  // Try to load from cache first
  let modelBuffer: ArrayBuffer | null = null;

  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open("watermark-model-v2");
      const cachedResponse = await cache.match(config.url);
      if (cachedResponse) {
        const buf = await cachedResponse.arrayBuffer();
        if (buf.byteLength > 1024) {
          modelBuffer = buf;
          onProgress?.(100);
        } else {
          await cache.delete(config.url);
        }
      }
    } catch {}
  }

  if (!modelBuffer) {
    const response = await fetch(config.url);
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    const contentLength = parseInt(
      response.headers.get("Content-Length") || "0",
      10
    );
    const chunks: Uint8Array[] = [];
    let receivedLength = 0;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          receivedLength += value.length;
          if (contentLength > 0) {
            onProgress?.(Math.round((receivedLength / contentLength) * 100));
          }
        }
      }
      const totalLength = chunks.reduce((acc, val) => acc + val.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      modelBuffer = combined.buffer;
    } else {
      modelBuffer = await response.arrayBuffer();
    }

    if (!modelBuffer || modelBuffer.byteLength < 1024) {
      throw new Error("Downloaded model is invalid or too small");
    }

    // Cache the model
    if (typeof caches !== "undefined") {
      try {
        const cache = await caches.open("watermark-model-v2");
        const blob = new Blob([modelBuffer]);
        await cache.put(config.url, new Response(blob));
      } catch {}
    }

    onProgress?.(100);
  }

  let newSession: ort.InferenceSession;
  try {
    newSession = await ort.InferenceSession.create(modelBuffer!, {
      executionProviders,
      graphOptimizationLevel: "all",
    });
  } catch (e) {
    if (typeof caches !== "undefined") {
      try {
        const cache = await caches.open("watermark-model-v2");
        await cache.delete(config.url);
      } catch {}
    }
    throw e;
  }

  sessions.set(modelType, newSession);
  return newSession;
}

export function disposeModel(modelType?: ModelType) {
  if (modelType) {
    const s = sessions.get(modelType);
    if (s) {
      s.release();
      sessions.delete(modelType);
    }
  } else {
    for (const s of sessions.values()) s.release();
    sessions.clear();
  }
}

export function getModelInputSize(modelType: ModelType = "lama"): number {
  return MODELS[modelType].inputSize;
}

export async function runInference(
  imageData: ImageData,
  maskData: ImageData,
  modelType: ModelType = "lama"
): Promise<ImageData> {
  const sess = await loadModel(modelType);
  const config = MODELS[modelType];
  const inputSize = config.inputSize;

  // Preprocess: normalize to [-1, 1], CHW layout
  const { tensor: imageTensor, originalWidth, originalHeight } =
    preprocessImage(imageData, inputSize);
  const maskTensor = preprocessMask(maskData, inputSize);

  // Run inference
  const feeds: Record<string, ort.Tensor> = {};

  if (modelType === "lama") {
    feeds["image"] = imageTensor;
    feeds["mask"] = maskTensor;
  } else {
    feeds["image"] = imageTensor;
    feeds["mask"] = maskTensor;
  }

  const results = await sess.run(feeds);
  const outputName = Object.keys(results)[0];
  const output = results[outputName];

  // Postprocess
  return postprocessOutput(output, originalWidth, originalHeight);
}

function preprocessImage(
  imageData: ImageData,
  targetSize: number
): { tensor: ort.Tensor; originalWidth: number; originalHeight: number } {
  const { width, height, data } = imageData;
  const originalWidth = width;
  const originalHeight = height;

  // Resize to target size maintaining aspect ratio
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.putImageData(imageData, 0, 0);

  const dstCanvas = document.createElement("canvas");
  dstCanvas.width = targetSize;
  dstCanvas.height = targetSize;
  const dstCtx = dstCanvas.getContext("2d")!;
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = "high";
  dstCtx.drawImage(srcCanvas, 0, 0, targetSize, targetSize);

  const resized = dstCtx.getImageData(0, 0, targetSize, targetSize);
  const pixels = resized.data;

  // Normalize to [-1, 1] and convert to CHW
  const chw = new Float32Array(3 * targetSize * targetSize);
  for (let i = 0; i < targetSize * targetSize; i++) {
    const idx = i * 4;
    chw[i] = (pixels[idx] / 255.0 - 0.5) / 0.5; // R
    chw[targetSize * targetSize + i] =
      (pixels[idx + 1] / 255.0 - 0.5) / 0.5; // G
    chw[2 * targetSize * targetSize + i] =
      (pixels[idx + 2] / 255.0 - 0.5) / 0.5; // B
  }

  return {
    tensor: new ort.Tensor("float32", chw, [1, 3, targetSize, targetSize]),
    originalWidth,
    originalHeight,
  };
}

function preprocessMask(
  maskData: ImageData,
  targetSize: number
): ort.Tensor {
  const { width, height, data } = maskData;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.putImageData(maskData, 0, 0);

  const dstCanvas = document.createElement("canvas");
  dstCanvas.width = targetSize;
  dstCanvas.height = targetSize;
  const dstCtx = dstCanvas.getContext("2d")!;
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.drawImage(srcCanvas, 0, 0, targetSize, targetSize);

  const resized = dstCtx.getImageData(0, 0, targetSize, targetSize);
  const pixels = resized.data;

  // Single channel, 0 or 1
  const mask = new Float32Array(targetSize * targetSize);
  for (let i = 0; i < targetSize * targetSize; i++) {
    mask[i] = pixels[i * 4] > 128 ? 1.0 : 0.0;
  }

  return new ort.Tensor("float32", mask, [1, 1, targetSize, targetSize]);
}

function postprocessOutput(
  output: ort.Tensor,
  originalWidth: number,
  originalHeight: number
): ImageData {
  const data = output.data as Float32Array;
  const size = Math.round(Math.sqrt(data.length / 3));

  // Convert CHW [-1,1] back to HWC [0,255]
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(size, size);
  const pixels = imageData.data;

  for (let i = 0; i < size * size; i++) {
    const r = Math.round(((data[i] + 1) / 2) * 255);
    const g = Math.round(((data[size * size + i] + 1) / 2) * 255);
    const b = Math.round(((data[2 * size * size + i] + 1) / 2) * 255);

    pixels[i * 4] = Math.max(0, Math.min(255, r));
    pixels[i * 4 + 1] = Math.max(0, Math.min(255, g));
    pixels[i * 4 + 2] = Math.max(0, Math.min(255, b));
    pixels[i * 4 + 3] = 255;
  }

  // Resize back to original dimensions
  ctx.putImageData(imageData, 0, 0);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = originalWidth;
  outCanvas.height = originalHeight;
  const outCtx = outCanvas.getContext("2d")!;
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(canvas, 0, 0, originalWidth, originalHeight);

  return outCtx.getImageData(0, 0, originalWidth, originalHeight);
}
