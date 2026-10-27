// RGBA8 PNG (https://www.w3.org/TR/png/): preserve the renderer's unpremultiplied bytes.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type: string, data = new Uint8Array(0)): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < out.length - 4; i++) crc = crcTable[(crc ^ out[i]) & 255] ^ (crc >>> 8);
  view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0);
  return out;
}
export async function pngBlob(
  rgba: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): Promise<Blob> {
  const stride = width * 4;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const source = y * stride;
    const target = y * (stride + 1);
    filtered[target] = 1; // Sub: exact byte differences from the pixel to the left.
    for (let x = 0; x < stride; x++)
      filtered[target + 1 + x] = rgba[source + x] - (x >= 4 ? rgba[source + x - 4] : 0);
  }
  const stream = new Blob([filtered]).stream().pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6; // Eight bits per channel, RGBA, noninterlaced.
  return new Blob(
    [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('sRGB', new Uint8Array([0])),
      chunk('IDAT', compressed),
      chunk('IEND'),
    ],
    { type: 'image/png' },
  );
}
