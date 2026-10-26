import type { Lab } from '../color';

export interface Spatial {
  x: number;
  y: number;
  top: number;
  bottom: number;
}
export interface Metadata {
  width: number;
  height: number;
  palette: Lab[];
  counts: number[];
  spatial: Spatial[];
  timing: {
    conversion: number;
    palette: number;
    assignment: number;
    weights: number;
    total: number;
  };
  bytes: number;
}
export interface Decomposition {
  alpha: Uint8Array<ArrayBuffer>;
  /** RGBA32F: L,a,b,nearest-palette-index, rows from top to bottom. */
  lab: Float32Array<ArrayBuffer>;
  /** RGBA32F planes holding four weights each: 16 base colours, up to 32 spatial islands. */
  weights: Float32Array<ArrayBuffer>[];
  metadata: Metadata;
}
