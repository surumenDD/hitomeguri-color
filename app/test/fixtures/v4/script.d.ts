import type {Lab} from '../../../src/color';
import type {Role} from '../../../src/script';
interface ReferencePreset {id:string;name:string;durationSec:number;nightDepth:number;glow:number;sequence:[string,number][]}
export const PRESETS:Record<string,ReferencePreset>;
export function rolePaletteAt(palette:Lab[],roles:Role[],seconds:number,preset?:ReferencePreset):Lab[];
