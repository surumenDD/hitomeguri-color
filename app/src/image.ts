export async function decodeImage(source: string | File): Promise<ImageData> {
  const ownedUrl = typeof source !== 'string';
  const url = ownedUrl ? URL.createObjectURL(source) : source;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    if (!canvas.width || !canvas.height) throw new Error('画像の大きさを読み取れません。');
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) throw new Error('画像を読み込めません。');
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    if (ownedUrl) URL.revokeObjectURL(url);
  }
}
