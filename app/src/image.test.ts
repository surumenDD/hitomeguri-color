import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeImage } from './image';

afterEach(() => vi.unstubAllGlobals());

function decoder(width: number, height: number) {
  vi.stubGlobal('createImageBitmap', undefined);
  const blob = new Blob(['image'], { type: 'image/png' });
  const fetch = vi.fn(async () => ({ blob: async () => blob }));
  vi.stubGlobal('fetch', fetch);
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
  return { ctx, decode, blob, fetch };
}

describe('image decoding', () => {
  it('draws an asynchronously resized bitmap and releases it after reading the pixels', async () => {
    const { ctx, blob, fetch } = decoder(8000, 6000);
    const bitmap = { width: 2048, height: 1536, close: vi.fn() };
    const createBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createBitmap);

    const pixels = await decodeImage('/large.png', { maxEdge: 2048, resize: true });

    expect(fetch).toHaveBeenCalledWith('/large.png');
    expect(createBitmap).toHaveBeenCalledWith(blob, {
      resizeWidth: 2048,
      resizeHeight: 1536,
      resizeQuality: 'high',
    });
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2048, 1536);
    expect(ctx.imageSmoothingQuality).toBe('high');
    expect(pixels.originalSize).toEqual({ width: 8000, height: 6000 });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(ctx.getImageData.mock.invocationCallOrder[0]).toBeLessThan(
      bitmap.close.mock.invocationCallOrder[0],
    );
  });

  it('rounds a tall resized bitmap to the same dimensions as the canvas fallback', async () => {
    decoder(300, 6000);
    const createBitmap = vi.fn(async () => ({ width: 102, height: 2048, close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', createBitmap);
    expect(await decodeImage('/tall.png', { maxEdge: 2048, resize: true })).toMatchObject({
      width: 102,
      height: 2048,
      originalSize: { width: 300, height: 6000 },
    });
    expect(createBitmap).toHaveBeenCalledWith(expect.anything(), {
      resizeWidth: 102,
      resizeHeight: 2048,
      resizeQuality: 'high',
    });
  });

  it.each([
    [1536, 1024, true],
    [2048, 1536, true],
    [3000, 2000, false],
  ])('keeps the original drawing path for %i×%i (resize=%s)', async (width, height, resize) => {
    const { ctx, fetch } = decoder(width, height);
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);
    const pixels = await decodeImage('/unchanged.png', { maxEdge: 2048, resize });
    expect(createBitmap).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.drawImage.mock.calls[0][0]).toHaveProperty('naturalWidth', width);
    expect(pixels).toMatchObject({ width, height });
    expect(pixels.originalSize).toBeUndefined();
  });

  it('falls back to the decoded image when bitmap resizing rejects', async () => {
    const { ctx } = decoder(8000, 6000);
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported options')));
    const pixels = await decodeImage('/large.png', { maxEdge: 2048, resize: true });
    expect(ctx.drawImage.mock.calls[0][0]).toHaveProperty('naturalWidth', 8000);
    expect(pixels).toMatchObject({
      width: 2048,
      height: 1536,
      originalSize: { width: 8000, height: 6000 },
    });
  });

  it('uses the original file directly for asynchronous bitmap decoding', async () => {
    const { ctx, fetch } = decoder(8000, 6000);
    const file = new File(['image'], 'large.png', { type: 'image/png' });
    const bitmap = { width: 2048, height: 1536, close: vi.fn() };
    const createBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createBitmap);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    try {
      await decodeImage(file, { maxEdge: 2048, resize: true });
      expect(createBitmap).toHaveBeenCalledWith(file, {
        resizeWidth: 2048,
        resizeHeight: 1536,
        resizeQuality: 'high',
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2048, 1536);
      expect(revokeObjectURL).toHaveBeenCalledWith(createObjectURL.mock.results[0].value);
    } finally {
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it('keeps loading through the canvas when fetching a string source fails', async () => {
    const { ctx, fetch } = decoder(8000, 6000);
    fetch.mockRejectedValueOnce(new Error('fetch failed'));
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);
    const pixels = await decodeImage('/large.png', { maxEdge: 2048, resize: true });
    expect(createBitmap).not.toHaveBeenCalled();
    expect(ctx.drawImage.mock.calls[0][0]).toHaveProperty('naturalWidth', 8000);
    expect(pixels).toMatchObject({ width: 2048, height: 1536 });
  });

  it.each([
    [8000, 6000],
    [2048, 6000],
    [8000, 1536],
  ])('discards a bitmap with ignored resize dimensions (%i×%i)', async (width, height) => {
    const { ctx } = decoder(8000, 6000);
    const bitmap = { width, height, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const pixels = await decodeImage('/large.png', { maxEdge: 2048, resize: true });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(ctx.drawImage.mock.calls[0][0]).toHaveProperty('naturalWidth', 8000);
    expect(pixels).toMatchObject({ width: 2048, height: 1536 });
  });

  it('releases the resized bitmap even when canvas readback fails', async () => {
    const { ctx } = decoder(8000, 6000);
    const bitmap = { width: 2048, height: 1536, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    ctx.getImageData.mockImplementationOnce(() => {
      throw new Error('readback failed');
    });
    await expect(decodeImage('/large.png', { maxEdge: 2048, resize: true })).rejects.toThrow(
      'readback failed',
    );
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

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
