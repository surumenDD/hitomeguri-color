import { expect, it } from 'vitest';
import { imageName, outputName } from './product';

it('uses the image basename for both display and saved filenames', () => {
  expect(outputName(imageName('island-regression.png'), 12, 'mp4')).toBe(
    'ひとめぐり-island-regression-12秒.mp4',
  );
  expect(imageName('a.b.jpg')).toBe('a.b');
});
