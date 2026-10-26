import type { Lab } from '../color';
import { distance2 } from '../color';

/** d^-4, scaled by min(d)^4 to avoid overflow next to a palette point. */
export function shepardWeights(p: Lab, palette: Lab[]): Float64Array<ArrayBuffer> {
  if (!palette.length) throw new Error('パレットが空です。');
  const ds = Float64Array.from(palette, (q) => distance2(p, q));
  const min = Math.min(...ds);
  const exact = ds.indexOf(0);
  if (exact >= 0) {
    ds.fill(0);
    ds[exact] = 1;
    return ds;
  }
  let total = 0;
  for (let k = 0; k < ds.length; k++) total += ds[k] = (min / ds[k]) ** 2;
  for (let k = 0; k < ds.length; k++) ds[k] /= total;
  return ds;
}
