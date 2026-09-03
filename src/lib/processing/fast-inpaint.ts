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
  const src = result.data;
  const mask = maskData.data;
  const maskW = maskData.width;
  const maskH = maskData.height;
  const scaleX = width / maskW;
  const scaleY = height / maskH;

  const isMasked = (x: number, y: number): boolean => {
    const mx = Math.min(maskW - 1, Math.max(0, Math.floor(x / scaleX)));
    const my = Math.min(maskH - 1, Math.max(0, Math.floor(y / scaleY)));
    return mask[(my * maskW + mx) * 4] > 128;
  };

  const distMap = new Int32Array(width * height).fill(-1);
  const queue: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isMasked(x, y)) {
        distMap[y * width + x] = 0;
      } else {
        let isBoundary = false;
        for (let dy = -1; dy <= 1 && !isBoundary; dy++) {
          for (let dx = -1; dx <= 1 && !isBoundary; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && !isMasked(nx, ny)) {
              isBoundary = true;
            }
          }
        }
        if (isBoundary) {
          distMap[y * width + x] = 1;
          queue.push(y * width + x);
        }
      }
    }
  }

  const visited = new Uint8Array(width * height);
  const order: number[] = [...queue];
  let qIdx = 0;

  while (qIdx < queue.length) {
    const idx = queue[qIdx++];
    if (visited[idx]) continue;
    visited[idx] = 1;
    const x = idx % width;
    const y = Math.floor(idx / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (distMap[nIdx] === -1 && isMasked(nx, ny)) {
          distMap[nIdx] = distMap[idx] + 1;
          queue.push(nIdx);
          order.push(nIdx);
        }
      }
    }
  }

  order.sort((a, b) => distMap[a] - distMap[b]);

  for (const idx of order) {
    const x = idx % width;
    const y = Math.floor(idx / width);

    let sumR = 0, sumG = 0, sumB = 0;
    let weightSum = 0;

    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (distMap[nIdx] >= distMap[idx]) continue;

        const dist = Math.sqrt(dx * dx + dy * dy);
        const w = 1 / (dist + 0.5);

        const pIdx = nIdx * 4;
        sumR += src[pIdx] * w;
        sumG += src[pIdx + 1] * w;
        sumB += src[pIdx + 2] * w;
        weightSum += w;
      }
    }

    if (weightSum > 0) {
      const outIdx = idx * 4;
      src[outIdx] = Math.round(sumR / weightSum);
      src[outIdx + 1] = Math.round(sumG / weightSum);
      src[outIdx + 2] = Math.round(sumB / weightSum);
    }
  }

  const featherRadius = 1;
  const feathered = new Uint8ClampedArray(src);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isMasked(x, y)) continue;

      let isEdge = false;
      for (let dy = -featherRadius; dy <= featherRadius && !isEdge; dy++) {
        for (let dx = -featherRadius; dx <= featherRadius && !isEdge; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && !isMasked(nx, ny)) {
            isEdge = true;
          }
        }
      }

      if (isEdge) {
        const idx = (y * width + x) * 4;
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && !isMasked(nx, ny)) {
              const nIdx = (ny * width + nx) * 4;
              sumR += result.data[nIdx];
              sumG += result.data[nIdx + 1];
              sumB += result.data[nIdx + 2];
              count++;
            }
          }
        }
        if (count > 0) {
          const avgR = sumR / count;
          const avgG = sumG / count;
          const avgB = sumB / count;
          feathered[idx] = Math.round(src[idx] * 0.7 + avgR * 0.3);
          feathered[idx + 1] = Math.round(src[idx + 1] * 0.7 + avgG * 0.3);
          feathered[idx + 2] = Math.round(src[idx + 2] * 0.7 + avgB * 0.3);
        }
      }
    }
  }

  for (let i = 0; i < src.length; i++) src[i] = feathered[i];

  return result;
}

export async function convertWebmToMp4(webmBlob: Blob): Promise<Blob> {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  await ffmpeg.writeFile("input.webm", await fetchFile(webmBlob));
  await ffmpeg.exec([
    "-i", "input.webm",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-c:a", "aac",
    "-movflags", "+faststart",
    "output.mp4",
  ]);

  const data = await ffmpeg.readFile("output.mp4") as Uint8Array;
  await ffmpeg.deleteFile("input.webm");
  await ffmpeg.deleteFile("output.mp4");

  return new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
}
