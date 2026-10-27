import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decomposition } from '../palette/types';
import { DAYLIGHT } from '../script';
import {
  exportSize,
  exportVideo,
  VIDEO_SIZE_UNSUPPORTED,
  VIDEO_UNSUPPORTED,
  videoExportSupport,
} from './video';

afterEach(() => vi.unstubAllGlobals());

describe('video availability before export', () => {
  it('rejects a missing API without trying to encode', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    expect(await videoExportSupport(2048, 1536)).toBe('browser-unsupported');
  });
  it('checks the actual even-sized H.264 configuration', async () => {
    const isConfigSupported = vi.fn().mockResolvedValue({ supported: true });
    vi.stubGlobal('VideoEncoder', { isConfigSupported });
    expect(await videoExportSupport(2048, 1537)).toBe('supported');
    expect(isConfigSupported).toHaveBeenCalledWith({
      codec: 'avc1.420033',
      width: 1920,
      height: 1440,
      bitrate: 12_000_000,
      framerate: 30,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    });
  });
  it.each([1, 2, 16])('checks enlarged %i×%i pictures before export', async (edge) => {
    const isConfigSupported = vi.fn().mockResolvedValue({ supported: true });
    vi.stubGlobal('VideoEncoder', { isConfigSupported });
    expect(await videoExportSupport(edge, edge)).toBe('supported');
    expect(isConfigSupported).toHaveBeenCalledWith(
      expect.objectContaining({ width: 512, height: 512 }),
    );
  });
  it('rejects unsupported or failed configuration queries', async () => {
    const isConfigSupported = vi
      .fn()
      .mockResolvedValueOnce({ supported: false })
      .mockResolvedValueOnce({ supported: true })
      .mockRejectedValueOnce(new Error('unavailable'));
    vi.stubGlobal('VideoEncoder', { isConfigSupported });
    expect(await videoExportSupport(640, 480)).toBe('size-unsupported');
    expect(isConfigSupported).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 1280, height: 720 }),
    );
    expect(await videoExportSupport(640, 480)).toBe('size-unsupported');
  });
  it('blames the browser when H.264 fails at an ordinary size too', async () => {
    vi.stubGlobal('VideoEncoder', {
      isConfigSupported: vi.fn().mockResolvedValue({ supported: false }),
    });
    expect(await videoExportSupport(640, 480)).toBe('browser-unsupported');
  });
  it('uses the same reason if an export is attempted directly', async () => {
    const data = { metadata: { width: 1, height: 2048 } } as Decomposition;
    vi.stubGlobal('VideoEncoder', undefined);
    await expect(exportVideo(data, [], DAYLIGHT)).rejects.toThrow(VIDEO_UNSUPPORTED);
    vi.stubGlobal('VideoEncoder', {
      isConfigSupported: vi.fn().mockResolvedValue({ supported: false }),
    });
    await expect(exportVideo(data, [], DAYLIGHT)).rejects.toThrow(VIDEO_SIZE_UNSUPPORTED);
  });
});

describe('deterministic export size', () => {
  it.each([
    [1, 1, 512, 512],
    [2, 2, 512, 512],
    [16, 16, 512, 512],
    [64, 48, 512, 384],
    [300, 6000, 96, 1920],
    [6000, 300, 1920, 96],
    [1536, 1024, 1536, 1024],
    [8000, 6000, 1920, 1440],
  ])('exports %i×%i at %i×%i', (width, height, x, y) => {
    expect(exportSize(width, height)).toEqual([x, y]);
  });
  it('respects a smaller analysis cap when enlarging tiny pictures', () => {
    expect(exportSize(1, 1, 384)).toEqual([384, 384]);
    expect(exportSize(64, 48, 384)).toEqual([384, 288]);
  });
  it('keeps both axes even, fits the long edge and preserves aspect within quantization', () => {
    for (const [w, h] of [
      [1536, 1024],
      [1921, 1081],
      [1000, 3001],
      [1, 1],
    ]) {
      const [x, y] = exportSize(w, h);
      expect(x % 2).toBe(0);
      expect(y % 2).toBe(0);
      expect(Math.max(x, y)).toBeLessThanOrEqual(1920);
      expect(Math.abs(x / y - w / h)).toBeLessThan(0.01);
    }
  });
});
