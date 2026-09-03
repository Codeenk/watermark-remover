export function fastInpaint(
  imageData: ImageData,
  maskData: ImageData
): ImageData {
  const { width, height } = imageData;
  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    width,
    height
  );
  const src = imageData.data;
  const mask = maskData.data;
  const dst = result.data;

  const maskW = maskData.width;
  const maskH = maskData.height;
  const scaleX = width / maskW;
  const scaleY = height / maskH;

  const isMasked = (x: number, y: number): boolean => {
    const mx = Math.min(maskW - 1, Math.max(0, Math.floor(x / scaleX)));
    const my = Math.min(maskH - 1, Math.max(0, Math.floor(y / scaleY)));
    return mask[(my * maskW + mx) * 4] > 128;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isMasked(x, y)) continue;

      let bestR = 0,
        bestG = 0,
        bestB = 0;
      let found = false;

      for (let r = 1; r <= 32 && !found; r++) {
        let sumR = 0,
          sumG = 0,
          sumB = 0,
          count = 0;

        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (isMasked(nx, ny)) continue;
            const idx = (ny * width + nx) * 4;
            sumR += src[idx];
            sumG += src[idx + 1];
            sumB += src[idx + 2];
            count++;
          }
        }

        if (count > 0) {
          bestR = sumR / count;
          bestG = sumG / count;
          bestB = sumB / count;
          found = true;
        }
      }

      const idx = (y * width + x) * 4;
      if (found) {
        dst[idx] = bestR;
        dst[idx + 1] = bestG;
        dst[idx + 2] = bestB;
        src[idx] = bestR;
        src[idx + 1] = bestG;
        src[idx + 2] = bestB;
      }
    }
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!isMasked(x, y)) continue;
      const idx = (y * width + x) * 4;
      const blurR =
        (dst[idx - 4] + dst[idx + 4] + dst[(y - 1) * width * 4 + x * 4] + dst[(y + 1) * width * 4 + x * 4]) / 4;
      const blurG =
        (dst[idx - 3] + dst[idx + 5] + dst[(y - 1) * width * 4 + x * 4 + 1] + dst[(y + 1) * width * 4 + x * 4 + 1]) / 4;
      const blurB =
        (dst[idx - 2] + dst[idx + 6] + dst[(y - 1) * width * 4 + x * 4 + 2] + dst[(y + 1) * width * 4 + x * 4 + 2]) / 4;
      dst[idx] = dst[idx] * 0.5 + blurR * 0.5;
      dst[idx + 1] = dst[idx + 1] * 0.5 + blurG * 0.5;
      dst[idx + 2] = dst[idx + 2] * 0.5 + blurB * 0.5;
    }
  }

  return result;
}
