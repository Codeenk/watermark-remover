let cvReady: Promise<any> | null = null;

function loadOpenCV(): Promise<any> {
  if (cvReady) return cvReady;
  if (typeof window !== "undefined" && (window as any).cv && (window as any).cv.Mat) {
    return Promise.resolve((window as any).cv);
  }

  cvReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OpenCV timeout")), 15000);
    const script = document.createElement("script");
    script.src = "/opencv.js";
    script.async = true;
    script.onload = () => {
      const cv = (window as any).cv;
      if (cv && cv.Mat) {
        clearTimeout(timeout);
        resolve(cv);
      } else if (cv) {
        cv.onRuntimeInitialized = () => {
          clearTimeout(timeout);
          resolve(cv);
        };
      } else {
        clearTimeout(timeout);
        reject(new Error("OpenCV not found"));
      }
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Failed to load OpenCV.js"));
    };
    document.head.appendChild(script);
  });

  return cvReady;
}

export async function inpaintWithOpenCV(
  imageData: ImageData,
  maskData: ImageData,
  method: "telea" | "ns" = "telea",
  radius = 7
): Promise<ImageData> {
  const cv = await loadOpenCV();

  const { width, height } = imageData;

  const src = cv.matFromImageData(imageData);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d")!;
  const maskW = maskData.width;
  const maskH = maskData.height;
  const scaleX = width / maskW;
  const scaleY = height / maskH;

  const fullMask = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mx = Math.min(maskW - 1, Math.floor(x / scaleX));
      const my = Math.min(maskH - 1, Math.floor(y / scaleY));
      const v = maskData.data[(my * maskW + mx) * 4] > 128 ? 255 : 0;
      const idx = (y * width + x) * 4;
      fullMask.data[idx] = v;
      fullMask.data[idx + 1] = v;
      fullMask.data[idx + 2] = v;
      fullMask.data[idx + 3] = 255;
    }
  }

  const mask = cv.matFromImageData(fullMask);

  const gray = new cv.Mat();
  cv.cvtColor(mask, gray, cv.COLOR_RGBA2GRAY);

  const dst = new cv.Mat();
  const flag = method === "telea" ? cv.INPAINT_TELEA : cv.INPAINT_NS;
  cv.inpaint(src, gray, dst, radius, flag);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = width;
  outCanvas.height = height;
  cv.imshow(outCanvas, dst);
  const outCtx = outCanvas.getContext("2d")!;
  const result = outCtx.getImageData(0, 0, width, height);

  src.delete();
  mask.delete();
  gray.delete();
  dst.delete();

  return result;
}

export function isOpenCVSupported(): boolean {
  return typeof window !== "undefined";
}
