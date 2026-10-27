export async function decodeImage(
  source: string | File,
  { maxEdge = 4096, resize = false }: { maxEdge?: number; resize?: boolean } = {},
): Promise<ImageData> {
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
    if (!resize && Math.max(image.naturalWidth, image.naturalHeight) > maxEdge)
      throw new Error(
        `画像が大きすぎます（${image.naturalWidth}×${image.naturalHeight}）。長辺4096px以下にしてから開いてください。`,
      );
    const canvas = document.createElement('canvas');
    const scale = resize
      ? Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
      : 1;
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    if (!canvas.width || !canvas.height) throw new Error('画像の大きさを読み取れません。');
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) throw new Error('画像を読み込めません。');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    if (ownedUrl) URL.revokeObjectURL(url);
  }
}
