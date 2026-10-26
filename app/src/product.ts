export const PRODUCT = { name: 'ひとめぐり', subtitle: '絵の色が、1日をひとめぐりする' } as const;
export const outputName = (image: string, seconds: number, ext: 'png' | 'mp4') =>
  `${PRODUCT.name}-${image.replace(/[\\/:*?"<>|]/g, '-')}-${seconds}秒.${ext}`;
