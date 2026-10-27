import { readFile } from 'node:fs/promises';

export interface TestImage {
  id: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export const SAMPLE_IDS = [
  'canal', 'festival', 'flat', 'girl-yukata', 'girl', 'lighthouse', 'oasis', 'seaside', 'snow',
] as const;
export const GENERATED_IDS = [
  'white-border', 'black-lines-on-white', 'black-background', 'rain-white-lines', 'seed-noise', 'solid',
] as const;

// Reuse the browser decoder installed for test/browser.mjs; no new package or server.
// The default long edge keeps the exhaustive matrix affordable; Infinity preserves native pixels.
export async function decodeSamples(maxEdge = 32): Promise<TestImage[]> {
  const playwrightUrl = new URL(
    '../../../../tools/visual-qa/node_modules/playwright-core/index.mjs', import.meta.url,
  ).href;
  const { chromium } = await import(/* @vite-ignore */ playwrightUrl);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const result: TestImage[] = [];
    for (const id of SAMPLE_IDS) {
      const bytes = await readFile(new URL(`../../../src/assets/samples/${id}.webp`, import.meta.url));
      const decoded: { width: number; height: number; rgba: string } = await page.evaluate(
        async ({ base64, maxEdge }: { base64: string; maxEdge: number }) => {
          const image = new Image();
          image.src = `data:image/webp;base64,${base64}`;
          await image.decode();
          const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('2D image decoder unavailable');
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const chunks: string[] = [];
          for (let i = 0; i < rgba.length; i += 32768)
            chunks.push(String.fromCharCode(...rgba.subarray(i, i + 32768)));
          return { width: canvas.width, height: canvas.height, rgba: btoa(chunks.join('')) };
        }, { base64: bytes.toString('base64'), maxEdge },
      );
      result.push({ id, ...decoded, rgba: new Uint8ClampedArray(Buffer.from(decoded.rgba, 'base64')) });
    }
    return result;
  } finally {
    await browser.close();
  }
}

export function generatedImages(): TestImage[] {
  const width = 32, height = 24;
  let seed = 0x5eed1234;
  const randomByte = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 24;
  };
  return GENERATED_IDS.map((id) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let rgb: number[];
        switch (id) {
          case 'white-border':
            // Two-pixel white border: 208 / 768 = 27.08%, exceeding 15%.
            rgb = x < 2 || x >= width - 2 || y < 2 || y >= height - 2
              ? [255, 255, 255] : [65 + x * 3, 85 + y * 3, 130];
            break;
          case 'black-lines-on-white':
            rgb = x % 9 === 4 || y % 11 === 5 ? [0, 0, 0] : [255, 255, 255];
            break;
          case 'black-background':
            // A textured dark field (75%, sRGB 0..99) and varied colours leave
            // quantization residuals; a perfectly uniform black need not fail.
            {
              const gray = (x * 7 + y * 3) % 100;
              rgb = x < 24 ? [gray, gray, gray]
                : [(y * 31 + x * 17) % 256, (y * 71 + x * 43) % 256, (y * 11 + x * 83) % 256];
            }
            break;
          case 'rain-white-lines':
            rgb = (x + y * 2) % 13 === 0 || (x * 2 + y) % 23 === 0
              ? [255, 255, 255] : [15 + y, 22 + x, 50 + y];
            break;
          case 'seed-noise':
            rgb = [randomByte(), randomByte(), randomByte()];
            break;
          case 'solid':
            rgb = [128, 128, 128];
            break;
        }
        rgba.set([...rgb, 255], (y * width + x) * 4);
      }
    }
    return { id, width, height, rgba };
  });
}
