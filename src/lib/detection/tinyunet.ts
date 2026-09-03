import * as ort from "onnxruntime-web";

let session: ort.InferenceSession | null = null;

const MODEL_URL = "https://huggingface.co/spaces/sourav520/ai_wartermark_remover/resolve/main/watermark_model.onnx";
const INPUT_SIZE = 256;

export async function loadTinyUNet(onProgress?: (p: number) => void): Promise<ort.InferenceSession> {
  if (session) return session;

  if (typeof window !== "undefined") {
    try {
      ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
    } catch {}
  }

  let buffer: ArrayBuffer | null = null;

  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open("watermark-tinyunet-v1");
      const hit = await cache.match(MODEL_URL);
      if (hit) {
        const ab = await hit.arrayBuffer();
        if (ab.byteLength > 1000) buffer = ab;
      }
    } catch {}
  }

  if (!buffer) {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`TinyUNet download failed: ${res.status}`);
    buffer = await res.arrayBuffer();
    if (typeof caches !== "undefined") {
      try {
        const cache = await caches.open("watermark-tinyunet-v1");
        await cache.put(MODEL_URL, new Response(buffer.slice(0)));
      } catch {}
    }
  }

  session = await ort.InferenceSession.create(buffer, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  return session;
}

export async function predictMaskTinyUNet(
  imageSource: HTMLImageElement | HTMLCanvasElement
): Promise<ImageData | null> {
  const w = (imageSource as HTMLImageElement).naturalWidth || (imageSource as HTMLCanvasElement).width;
  const h = (imageSource as HTMLImageElement).naturalHeight || (imageSource as HTMLCanvasElement).height;

  const sess = await loadTinyUNet();

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(imageSource, 0, 0, w, h);

  const size = Math.min(INPUT_SIZE, w, h);
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = INPUT_SIZE;
  cropCanvas.height = INPUT_SIZE;
  const cropCtx = cropCanvas.getContext("2d")!;
  cropCtx.drawImage(canvas, w - size, h - size, size, size, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const cropData = cropCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;

  const input = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    const r = cropData[i * 4] / 255;
    const g = cropData[i * 4 + 1] / 255;
    const b = cropData[i * 4 + 2] / 255;
    input[i] = r;
    input[INPUT_SIZE * INPUT_SIZE + i] = g;
    input[2 * INPUT_SIZE * INPUT_SIZE + i] = b;
  }

  const tensor = new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const inputName = (sess as any).inputNames[0];
  const results = await sess.run({ [inputName]: tensor });
  const outputName = (sess as any).outputNames[0];
  const pred = results[outputName].data as Float32Array;

  const maskSize = size;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = maskSize;
  maskCanvas.height = maskSize;
  const maskCtx = maskCanvas.getContext("2d")!;
  const maskImg = maskCtx.createImageData(maskSize, maskSize);

  for (let y = 0; y < maskSize; y++) {
    for (let x = 0; x < maskSize; x++) {
      const sx = Math.floor((x / maskSize) * INPUT_SIZE);
      const sy = Math.floor((y / maskSize) * INPUT_SIZE);
      const v = pred[sy * INPUT_SIZE + sx];
      const isWatermark = v > 0.45 ? 255 : 0;
      const idx = (y * maskSize + x) * 4;
      maskImg.data[idx] = isWatermark;
      maskImg.data[idx + 1] = isWatermark;
      maskImg.data[idx + 2] = isWatermark;
      maskImg.data[idx + 3] = isWatermark;
    }
  }

  const fullMask = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isInROI = x >= w - size && y >= h - size;
      let val = 0;
      if (isInROI) {
        const rx = x - (w - size);
        const ry = y - (h - size);
        const mx = Math.floor((rx / size) * maskSize);
        const my = Math.floor((ry / size) * maskSize);
        val = maskImg.data[(my * maskSize + mx) * 4];
      }
      const idx = (y * w + x) * 4;
      fullMask.data[idx] = val;
      fullMask.data[idx + 1] = val;
      fullMask.data[idx + 2] = val;
      fullMask.data[idx + 3] = val;
    }
  }

  return fullMask;
}
