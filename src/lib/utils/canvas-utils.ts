export function createCanvas(
  width: number,
  height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality = 1
): Promise<Blob> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), type, quality);
  });
}

export function imageToCanvas(
  img: HTMLImageElement
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const { canvas, ctx } = createCanvas(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx };
}

export function drawImageOnCanvas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  maxWidth?: number,
  maxHeight?: number
): { width: number; height: number } {
  let w = "naturalWidth" in img ? img.naturalWidth : img.width;
  let h = "naturalHeight" in img ? img.naturalHeight : img.height;

  if (maxWidth && w > maxWidth) {
    h = (h * maxWidth) / w;
    w = maxWidth;
  }
  if (maxHeight && h > maxHeight) {
    w = (w * maxHeight) / h;
    h = maxHeight;
  }

  ctx.drawImage(img, 0, 0, w, h);
  return { width: w, height: h };
}

export function downsampleForModel(
  imgData: ImageData,
  maxSize = 512
): { data: ImageData; scale: number } {
  const { width, height, data } = imgData;
  if (width <= maxSize && height <= maxSize) {
    return { data: imgData, scale: 1 };
  }

  const scale = maxSize / Math.max(width, height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.putImageData(imgData, 0, 0);

  const dstCanvas = document.createElement("canvas");
  dstCanvas.width = newW;
  dstCanvas.height = newH;
  const dstCtx = dstCanvas.getContext("2d")!;
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = "high";
  dstCtx.drawImage(srcCanvas, 0, 0, newW, newH);

  return {
    data: dstCtx.getImageData(0, 0, newW, newH),
    scale,
  };
}

export function resizeImageData(
  imgData: ImageData,
  targetW: number,
  targetH: number
): ImageData {
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = imgData.width;
  srcCanvas.height = imgData.height;
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.putImageData(imgData, 0, 0);

  const dstCanvas = document.createElement("canvas");
  dstCanvas.width = targetW;
  dstCanvas.height = targetH;
  const dstCtx = dstCanvas.getContext("2d")!;
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = "high";
  dstCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);

  return dstCtx.getImageData(0, 0, targetW, targetH);
}

export function compositeResult(
  original: ImageData,
  inpainted: ImageData,
  mask: ImageData,
  offsetX: number,
  offsetY: number,
  scale: number
): ImageData {
  const result = new ImageData(
    new Uint8ClampedArray(original.data),
    original.width,
    original.height
  );

  const mData = mask.data;
  const iData = inpainted.data;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const mIdx = (y * mask.width + x) * 4;
      if (mData[mIdx] > 128) {
        const srcX = Math.floor(x / scale + offsetX);
        const srcY = Math.floor(y / scale + offsetY);
        if (
          srcX >= 0 &&
          srcX < original.width &&
          srcY >= 0 &&
          srcY < original.height
        ) {
          const srcIdx = (srcY * original.width + srcX) * 4;
          const px = Math.min(
            Math.max(Math.round(x / scale), 0),
            inpainted.width - 1
          );
          const py = Math.min(
            Math.max(Math.round(y / scale), 0),
            inpainted.height - 1
          );
          const iIdx = (py * inpainted.width + px) * 4;

          // Feather the mask edge for smooth blending
          const featherRadius = 2;
          let alpha = mData[mIdx] / 255;

          // Check nearby mask pixels for feathering
          for (let fy = -featherRadius; fy <= featherRadius; fy++) {
            for (let fx = -featherRadius; fx <= featherRadius; fx++) {
              const nx = x + fx;
              const ny = y + fy;
              if (
                nx >= 0 &&
                nx < mask.width &&
                ny >= 0 &&
                ny < mask.height
              ) {
                const nIdx = (ny * mask.width + nx) * 4;
                if (mData[nIdx] < 128) {
                  const dist = Math.sqrt(fx * fx + fy * fy);
                  alpha = Math.min(
                    alpha,
                    Math.max(0, 1 - dist / (featherRadius + 1))
                  );
                }
              }
            }
          }

          result.data[srcIdx] = iData[iIdx] * alpha + result.data[srcIdx] * (1 - alpha);
          result.data[srcIdx + 1] =
            iData[iIdx + 1] * alpha + result.data[srcIdx + 1] * (1 - alpha);
          result.data[srcIdx + 2] =
            iData[iIdx + 2] * alpha + result.data[srcIdx + 2] * (1 - alpha);
        }
      }
    }
  }

  return result;
}

export function maskFromBounds(
  bounds: { x: number; y: number; w: number; h: number }[],
  width: number,
  height: number,
  padding = 8
): ImageData {
  const data = new ImageData(width, height);
  const pixels = data.data;

  for (const b of bounds) {
    const x1 = Math.max(0, b.x - padding);
    const y1 = Math.max(0, b.y - padding);
    const x2 = Math.min(width, b.x + b.w + padding);
    const y2 = Math.min(height, b.y + b.h + padding);

    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const idx = (y * width + x) * 4;
        pixels[idx] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
        pixels[idx + 3] = 255;
      }
    }
  }

  return data;
}

export function mergeMasks(masks: ImageData[]): ImageData {
  if (masks.length === 0) throw new Error("No masks to merge");
  const { width, height } = masks[0];
  const data = new ImageData(width, height);

  for (const mask of masks) {
    for (let i = 0; i < data.data.length; i += 4) {
      if (mask.data[i] > 128) {
        data.data[i] = 255;
        data.data[i + 1] = 255;
        data.data[i + 2] = 255;
        data.data[i + 3] = 255;
      }
    }
  }

  return data;
}

export function getMaskBounds(
  mask: ImageData
): { x: number; y: number; w: number; h: number } | null {
  const { width, height, data } = mask;
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] > 128) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        found = true;
      }
    }
  }

  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
