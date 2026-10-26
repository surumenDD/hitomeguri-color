export interface PreviewEmphasis {
  L: number;
  C: number;
}
export const DEFAULT_EMPHASIS: PreviewEmphasis = { L: 0.6, C: 0.25 };
/** Temporary, invisible tuning controls for the art director's local preview. */
export function previewEmphasis(search: string): PreviewEmphasis {
  const params = new URLSearchParams(search);
  const value = (name: string, fallback: number): number => {
    const raw = params.get(name),
      number = raw?.trim() ? Number(raw) : NaN;
    return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
  };
  return { L: value('dimL', DEFAULT_EMPHASIS.L), C: value('dimC', DEFAULT_EMPHASIS.C) };
}
