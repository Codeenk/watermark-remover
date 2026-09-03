export interface DetectionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  type: "text" | "logo" | "overlay" | "tiled" | "unknown";
}

export interface DetectionOptions {
  sensitivity: number; // 0-1, higher = more regions detected
  types: DetectionRegion["type"][];
  minRegionSize: number;
  maxRegionSize: number;
}

export const DEFAULT_DETECTION_OPTIONS: DetectionOptions = {
  sensitivity: 0.5,
  types: ["text", "logo", "overlay", "tiled"],
  minRegionSize: 20,
  maxRegionSize: 2000,
};

export class WatermarkDetector {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  }

  async detect(
    imageSource: HTMLImageElement | HTMLCanvasElement,
    options: DetectionOptions = DEFAULT_DETECTION_OPTIONS
  ): Promise<DetectionRegion[]> {
    const w =
      "naturalWidth" in imageSource ? imageSource.naturalWidth : imageSource.width;
    const h =
      "naturalHeight" in imageSource ? imageSource.naturalHeight : imageSource.height;

    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(imageSource, 0, 0, w, h);
    const imageData = this.ctx.getImageData(0, 0, w, h);

    const regions: DetectionRegion[] = [];

    if (options.types.includes("overlay")) {
      regions.push(...this.detectOverlays(imageData, options));
    }
    if (options.types.includes("text")) {
      regions.push(...this.detectTextRegions(imageData, options));
    }
    if (options.types.includes("tiled")) {
      regions.push(...this.detectTiledPatterns(imageData, options));
    }
    if (options.types.includes("logo")) {
      regions.push(...this.detectLogoRegions(imageData, options));
    }

    return this.mergeOverlapping(regions);
  }

  private detectOverlays(
    imageData: ImageData,
    options: DetectionOptions
  ): DetectionRegion[] {
    const { width, height, data } = imageData;
    const regions: DetectionRegion[] = [];
    const blockSize = 16;

    for (let by = 0; by < height; by += blockSize) {
      for (let bx = 0; bx < width; bx += blockSize) {
        const endX = Math.min(bx + blockSize, width);
        const endY = Math.min(by + blockSize, height);

        // Check for semi-transparent watermark overlays
        // These typically have consistent alpha or color shifts
        let lowSatCount = 0;
        let totalPixels = 0;
        let avgR = 0,
          avgG = 0,
          avgB = 0;

        for (let y = by; y < endY; y++) {
          for (let x = bx; x < endX; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];

            avgR += r;
            avgG += g;
            avgB += b;
            totalPixels++;

            // Detect very low saturation (white/gray overlay)
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : (max - min) / max;
            if (sat < 0.15 && max > 180) lowSatCount++;

            // Detect consistent alpha channel (not fully opaque or transparent)
            if (a > 0 && a < 255 && Math.abs(a - 128) < 40) {
              lowSatCount++;
            }
          }
        }

        const ratio = lowSatCount / totalPixels;
        if (ratio > options.sensitivity * 0.6) {
          regions.push({
            x: bx,
            y: by,
            width: endX - bx,
            height: endY - by,
            confidence: Math.min(ratio, 1),
            type: "overlay",
          });
        }
      }
    }

    return this.filterAndMerge(regions, options);
  }

  private detectTextRegions(
    imageData: ImageData,
    options: DetectionOptions
  ): DetectionRegion[] {
    const { width, height, data } = imageData;
    const regions: DetectionRegion[] = [];

    // Simple edge-based text detection
    // Text watermarks have high-contrast edges in small, repeated patterns
    const blockSize = 8;
    const edgeMap = new Float32Array(width * height);

    // Compute horizontal and vertical gradients
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const idxR = (y * width + (x + 1)) * 4;
        const idxD = ((y + 1) * width + x) * 4;

        const gx =
          Math.abs(data[idxR] - data[idx]) +
          Math.abs(data[idxR + 1] - data[idx + 1]) +
          Math.abs(data[idxR + 2] - data[idx + 2]);
        const gy =
          Math.abs(data[idxD] - data[idx]) +
          Math.abs(data[idxD + 1] - data[idx + 1]) +
          Math.abs(data[idxD + 2] - data[idx + 2]);

        edgeMap[y * width + x] = Math.sqrt(gx * gx + gy * gy) / 3;
      }
    }

    // Find blocks with consistent edge patterns (text-like)
    for (let by = 0; by < height; by += blockSize * 4) {
      for (let bx = 0; bx < width; bx += blockSize * 4) {
        const endX = Math.min(bx + blockSize * 4, width);
        const endY = Math.min(by + blockSize * 4, height);

        let edgeSum = 0;
        let edgeCount = 0;
        let highEdgePixels = 0;

        for (let y = by; y < endY; y++) {
          for (let x = bx; x < endX; x++) {
            const e = edgeMap[y * width + x];
            edgeSum += e;
            edgeCount++;
            if (e > 30) highEdgePixels++;
          }
        }

        const avgEdge = edgeSum / edgeCount;
        const highEdgeRatio = highEdgePixels / edgeCount;

        // Text has moderate average edges with many high-contrast pixels
        if (avgEdge > 15 && highEdgeRatio > 0.05 && highEdgeRatio < 0.5) {
          // Check if this looks like text (uniform color, specific orientation)
          let avgR = 0,
            avgG = 0,
            avgB = 0;
          let pixelCount = 0;

          for (let y = by; y < endY; y++) {
            for (let x = bx; x < endX; x++) {
              if (edgeMap[y * width + x] > 30) {
                const idx = (y * width + x) * 4;
                avgR += data[idx];
                avgG += data[idx + 1];
                avgB += data[idx + 2];
                pixelCount++;
              }
            }
          }

          if (pixelCount > 0) {
            avgR /= pixelCount;
            avgG /= pixelCount;
            avgB /= pixelCount;

            // Check color consistency of edge pixels
            let colorVariance = 0;
            for (let y = by; y < endY; y++) {
              for (let x = bx; x < endX; x++) {
                if (edgeMap[y * width + x] > 30) {
                  const idx = (y * width + x) * 4;
                  colorVariance +=
                    Math.abs(data[idx] - avgR) +
                    Math.abs(data[idx + 1] - avgG) +
                    Math.abs(data[idx + 2] - avgB);
                }
              }
            }
            colorVariance /= pixelCount * 3;

            if (colorVariance < 60) {
              regions.push({
                x: bx,
                y: by,
                width: endX - bx,
                height: endY - by,
                confidence: Math.min(highEdgeRatio * 5, 1) * options.sensitivity,
                type: "text",
              });
            }
          }
        }
      }
    }

    return this.filterAndMerge(regions, options);
  }

  private detectTiledPatterns(
    imageData: ImageData,
    options: DetectionOptions
  ): DetectionRegion[] {
    const { width, height, data } = imageData;
    const regions: DetectionRegion[] = [];

    // Detect tiled watermarks by looking for repeated patterns
    // Sample a strip across the image and check for periodicity
    const sampleY = Math.floor(height / 2);
    const stripHeight = Math.min(20, height);
    const sampleData: number[] = [];

    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < stripHeight; dy++) {
        const idx = ((sampleY + dy) * width + x) * 4;
        sum += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      }
      sampleData.push(sum / stripHeight);
    }

    // Autocorrelation to find period
    const period = this.findPeriodicity(sampleData);
    if (period && period > 20 && period < width / 3) {
      // Found repeating pattern - mark entire strip region
      regions.push({
        x: 0,
        y: Math.max(0, sampleY - stripHeight),
        width,
        height: stripHeight * 2,
        confidence: 0.7,
        type: "tiled",
      });
    }

    return this.filterAndMerge(regions, options);
  }

  private detectLogoRegions(
    imageData: ImageData,
    options: DetectionOptions
  ): DetectionRegion[] {
    const { width, height, data } = imageData;
    const regions: DetectionRegion[] = [];

    // Logo detection: look for concentrated areas of unusual color
    // or semi-transparent overlays in corners
    const cornerSize = Math.min(width, height) * 0.3;
    const corners = [
      { x: 0, y: 0, label: "top-left" },
      { x: width - cornerSize, y: 0, label: "top-right" },
      { x: 0, y: height - cornerSize, label: "bottom-left" },
      { x: width - cornerSize, y: height - cornerSize, label: "bottom-right" },
      {
        x: (width - cornerSize) / 2,
        y: (height - cornerSize) / 2,
        label: "center",
      },
    ];

    for (const corner of corners) {
      const x1 = Math.max(0, Math.floor(corner.x));
      const y1 = Math.max(0, Math.floor(corner.y));
      const x2 = Math.min(width, Math.floor(corner.x + cornerSize));
      const y2 = Math.min(height, Math.floor(corner.y + cornerSize));

      let uniformColorCount = 0;
      let totalPixels = 0;
      let refR = -1,
        refG = -1,
        refB = -1;
      const blockSize = 4;

      for (let y = y1; y < y2; y += blockSize) {
        for (let x = x1; x < x2; x += blockSize) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          if (refR === -1) {
            refR = r;
            refG = g;
            refB = b;
          }

          const dist = Math.abs(r - refR) + Math.abs(g - refG) + Math.abs(b - refB);
          if (dist < 30) uniformColorCount++;
          totalPixels++;
        }
      }

      const uniformRatio = uniformColorCount / totalPixels;
      if (uniformRatio > 0.6 * options.sensitivity) {
        regions.push({
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1,
          confidence: uniformRatio * options.sensitivity,
          type: "logo",
        });
      }
    }

    return this.filterAndMerge(regions, options);
  }

  private findPeriodicity(data: number[]): number | null {
    const n = data.length;
    if (n < 40) return null;

    // Normalize data
    const mean = data.reduce((a, b) => a + b, 0) / n;
    const normalized = data.map((v) => v - mean);

    // Compute autocorrelation
    const maxLag = Math.min(n / 2, 500);
    const corr = new Float32Array(maxLag);

    for (let lag = 1; lag < maxLag; lag++) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < n - lag; i++) {
        sum += normalized[i] * normalized[i + lag];
        count++;
      }
      corr[lag] = sum / count;
    }

    // Find first significant peak
    const threshold = corr[1] * 0.3;
    let bestLag = -1;
    let bestVal = -Infinity;

    for (let lag = 10; lag < maxLag; lag++) {
      if (
        corr[lag] > threshold &&
        corr[lag] > corr[lag - 1] &&
        corr[lag] > corr[lag + 1] &&
        corr[lag] > bestVal
      ) {
        bestVal = corr[lag];
        bestLag = lag;
      }
    }

    return bestLag > 0 ? bestLag : null;
  }

  private filterAndMerge(
    regions: DetectionRegion[],
    options: DetectionOptions
  ): DetectionRegion[] {
    return regions
      .filter((r) => {
        const area = r.width * r.height;
        return (
          area >= options.minRegionSize * options.minRegionSize &&
          area <= options.maxRegionSize * options.maxRegionSize &&
          r.confidence > options.sensitivity * 0.3
        );
      })
      .map((r) => ({
        ...r,
        confidence: Math.min(r.confidence, 1),
      }));
  }

  private mergeOverlapping(regions: DetectionRegion[]): DetectionRegion[] {
    if (regions.length === 0) return regions;

    const sorted = [...regions].sort(
      (a, b) => b.confidence - a.confidence
    );
    const merged: DetectionRegion[] = [];

    for (const region of sorted) {
      let overlaps = false;
      for (const m of merged) {
        if (this.overlaps(region, m)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) merged.push(region);
    }

    return merged;
  }

  private overlaps(a: DetectionRegion, b: DetectionRegion): boolean {
    return !(
      a.x + a.width < b.x ||
      b.x + b.width < a.x ||
      a.y + a.height < b.y ||
      b.y + b.height < a.y
    );
  }
}
