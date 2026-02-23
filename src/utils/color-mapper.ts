/**
 * Maps hex colors to Miro's predefined sticky note color palette.
 * Miro only accepts specific color names, not arbitrary hex values.
 */

// Miro's available sticky note colors
export type MiroStickyColor =
  | 'gray'
  | 'light_yellow'
  | 'yellow'
  | 'orange'
  | 'light_green'
  | 'green'
  | 'dark_green'
  | 'cyan'
  | 'light_pink'
  | 'light_blue'
  | 'blue'
  | 'dark_blue'
  | 'violet'
  | 'magenta'
  | 'red';

// Mapping of common hex colors to Miro colors
const HEX_TO_MIRO_COLOR: Record<string, MiroStickyColor> = {
  // Yellows
  '#FFEB3B': 'light_yellow',
  '#FFF59D': 'light_yellow',
  '#FFC107': 'yellow',
  '#FFD54F': 'yellow',
  '#FFCA28': 'yellow',
  
  // Oranges
  '#FF9800': 'orange',
  '#FFB74D': 'orange',
  '#FFA726': 'orange',
  
  // Reds/Pinks
  '#F44336': 'red',
  '#EF5350': 'red',
  '#E91E63': 'magenta',
  '#F48FB1': 'light_pink',
  '#FF80AB': 'light_pink',
  
  // Purples
  '#9C27B0': 'violet',
  '#BA68C8': 'violet',
  '#673AB7': 'dark_blue',
  '#7E57C2': 'dark_blue',
  
  // Blues
  '#3F51B5': 'blue',
  '#5C6BC0': 'blue',
  '#2196F3': 'light_blue',
  '#64B5F6': 'light_blue',
  '#03A9F4': 'cyan',
  '#4FC3F7': 'cyan',
  '#00BCD4': 'cyan',
  
  // Greens
  '#009688': 'dark_green',
  '#26A69A': 'dark_green',
  '#4CAF50': 'green',
  '#66BB6A': 'green',
  '#8BC34A': 'light_green',
  '#AED581': 'light_green',
  '#CDDC39': 'light_green',
  
  // Grays
  '#9E9E9E': 'gray',
  '#BDBDBD': 'gray',
  '#E0E0E0': 'gray',
  '#F5F5F5': 'gray',
};

/**
 * Find the closest Miro sticky note color for a given hex color.
 * Falls back to 'light_yellow' if no close match is found.
 */
export function hexToMiroColor(hex: string): MiroStickyColor {
  const normalizedHex = hex.toUpperCase();
  
  // Direct match
  if (HEX_TO_MIRO_COLOR[normalizedHex]) {
    return HEX_TO_MIRO_COLOR[normalizedHex];
  }
  
  // Try to find closest color by hue
  const rgb = hexToRgb(normalizedHex);
  if (rgb) {
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return findClosestColorByHue(hsl.h, hsl.s, hsl.l);
  }
  
  return 'light_yellow';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s, l };
}

function findClosestColorByHue(h: number, s: number, l: number): MiroStickyColor {
  // Very low saturation = gray
  if (s < 0.1) return 'gray';
  
  // Very light = light_yellow (or could be gray)
  if (l > 0.9) return 'light_yellow';
  
  // Map hue ranges to colors (hue is 0-360)
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 75) return 'yellow';
  if (h < 90) return 'light_yellow';
  if (h < 150) return 'green';
  if (h < 180) return 'dark_green';
  if (h < 210) return 'cyan';
  if (h < 240) return 'light_blue';
  if (h < 270) return 'blue';
  if (h < 300) return 'violet';
  if (h < 330) return 'magenta';
  return 'light_pink';
}
