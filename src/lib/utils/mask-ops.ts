export function dilateMask(mask: ImageData, radius: number): ImageData {
  const { width, height, data } = mask;
  const out = new ImageData(width, height);
  const outData = out.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
          const v = data[(ny * width + nx) * 4];
          if (v > max) max = v;
        }
      }
      const idx = (y * width + x) * 4;
      outData[idx] = max;
      outData[idx + 1] = max;
      outData[idx + 2] = max;
      outData[idx + 3] = max > 0 ? 255 : 0;
    }
  }
  return out;
}

export function featherMask(mask: ImageData, blurRadius: number): ImageData {
  const { width, height } = mask;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(mask, 0, 0);

  ctx.globalCompositeOperation = "source-over";
  (ctx as any).filter = `blur(${blurRadius}px)`;
  ctx.drawImage(canvas, 0, 0);
  (ctx as any).filter = "none";

  return ctx.getImageData(0, 0, width, height);
}

export function refineMask(mask: ImageData, dilateRadius = 12, featherRadius = 8): ImageData {
  let refined = dilateMask(mask, dilateRadius);
  refined = featherMask(refined, featherRadius);
  return refined;
}
