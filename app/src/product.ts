export const PRODUCT = { name: 'ひとめぐり', subtitle: '絵の色が、1日をひとめぐりする' } as const;
export const imageName = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
};
export const outputName = (image: string, seconds: number, ext: 'png' | 'mp4') =>
  `${PRODUCT.name}-${image.replace(/[\\/:*?"<>|]/g, '-')}-${seconds}秒.${ext}`;
