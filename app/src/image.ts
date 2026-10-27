export interface DecodedImage extends ImageData {
  originalSize?: { width: number; height: number };
}

export async function decodeImage(
  source: string | File,
  { maxEdge = 4096, resize = false }: { maxEdge?: number; resize?: boolean } = {},
): Promise<DecodedImage> {
  const message = 'この画像は開けませんでした。PNG・JPEG・WebPの画像を選んでください。';
  if (
    typeof source !== 'string' &&
    source.type &&
    !['image/png', 'image/jpeg', 'image/webp'].includes(source.type)
  )
    throw new Error(message);
  const ownedUrl = typeof source !== 'string';
  const url = ownedUrl ? URL.createObjectURL(source) : source;
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error(message);
    }
    const canvas = document.createElement('canvas');
    const scale = resize
      ? Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
      : 1;
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    if (!canvas.width || !canvas.height) throw new Error('画像の大きさを読み取れません。');
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) throw new Error('画像を読み込めません。');
    ctx.imageSmoothingQuality = 'high';
    let resized: ImageBitmap | undefined;
    if (scale < 1 && typeof createImageBitmap === 'function') {
      try {
        // An HTMLImageElement can resize synchronously in Chrome. Blob decoding is asynchronous.
        const blob = typeof source === 'string' ? await (await fetch(url)).blob() : source;
        const bitmap = await createImageBitmap(blob, {
          // Match the <img> path, which honours EXIF orientation even for square photos.
          imageOrientation: 'from-image',
          resizeWidth: canvas.width,
          resizeHeight: canvas.height,
          resizeQuality: 'high',
        });
        // Some browsers accept resize options but return the original dimensions.
        if (bitmap.width === canvas.width && bitmap.height === canvas.height) resized = bitmap;
        else bitmap.close();
      } catch {
        // Keep the canvas path for browsers without bitmap resizing support.
      }
    }
    try {
      ctx.drawImage(resized ?? image, 0, 0, canvas.width, canvas.height);
      const pixels: DecodedImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (scale < 1)
        pixels.originalSize = { width: image.naturalWidth, height: image.naturalHeight };
      return pixels;
    } finally {
      resized?.close();
    }
  } finally {
    if (ownedUrl) URL.revokeObjectURL(url);
  }
}
