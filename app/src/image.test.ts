import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeImage } from './image';

afterEach(() => vi.unstubAllGlobals());

function decoder(width: number, height: number) {
  const decode = vi.fn(async () => {});
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = width;
      naturalHeight = height;
      decode = decode;
    },
  );
  const ctx = {
    imageSmoothingQuality: 'low',
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      colorSpace: 'srgb',
      data: new Uint8ClampedArray(),
    })),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  vi.stubGlobal('document', { createElement: () => canvas });
  return { ctx, decode };
}

describe('image decoding', () => {
  it('resizes a 3000px square with high quality and remembers its original dimensions', async () => {
    const { ctx } = decoder(3000, 3000);
    const pixels = await decodeImage('/large.jpg', { maxEdge: 2048, resize: true });
    expect(pixels).toMatchObject({
      width: 2048,
      height: 2048,
      originalSize: { width: 3000, height: 3000 },
    });
    expect(ctx.imageSmoothingQuality).toBe('high');
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 2048);
  });

  it('resizes images beyond the former 4096px ceiling and preserves their aspect ratio', async () => {
    decoder(6000, 3000);
    expect(await decodeImage('/wide.png', { maxEdge: 2048, resize: true })).toMatchObject({
      width: 2048,
      height: 1024,
      originalSize: { width: 6000, height: 3000 },
    });
  });

  it('keeps a 1536px sample at its original size without a resize notice', async () => {
    decoder(1536, 1024);
    const pixels = await decodeImage('/sample.webp', { maxEdge: 2048, resize: true });
    expect(pixels).toMatchObject({ width: 1536, height: 1024 });
    expect(pixels.originalSize).toBeUndefined();
  });

  it('keeps the existing unreadable-image message', async () => {
    const { decode } = decoder(0, 0);
    decode.mockRejectedValueOnce(new Error('decoder failed'));
    await expect(decodeImage('/broken.png', { maxEdge: 2048, resize: true })).rejects.toThrow(
      'この画像は開けませんでした。PNG・JPEG・WebPの画像を選んでください。',
    );
  });
});
