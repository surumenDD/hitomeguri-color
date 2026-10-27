import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportSize, supportsVideoExport } from './video';

afterEach(() => vi.unstubAllGlobals());

describe('video availability before export', () => {
  it('rejects a missing API without trying to encode', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    expect(await supportsVideoExport(2048, 1536)).toBe(false);
  });
  it('checks the actual even-sized H.264 configuration', async () => {
    const isConfigSupported = vi.fn().mockResolvedValue({ supported: true });
    vi.stubGlobal('VideoEncoder', { isConfigSupported });
    expect(await supportsVideoExport(2048, 1537)).toBe(true);
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
  it('rejects unsupported or failed configuration queries', async () => {
    const isConfigSupported = vi
      .fn()
      .mockResolvedValueOnce({ supported: false })
      .mockRejectedValueOnce(new Error('unavailable'));
    vi.stubGlobal('VideoEncoder', { isConfigSupported });
    expect(await supportsVideoExport(640, 480)).toBe(false);
    expect(await supportsVideoExport(640, 480)).toBe(false);
  });
});

describe('deterministic export size', () => {
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
