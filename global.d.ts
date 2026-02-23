// https://vitejs.dev/guide/features.html#typescript-compiler-options
/// <reference types="vite/client" />

declare const miro: {
  board: {
    ui: {
      on: (event: string, callback: () => void) => void;
      openPanel: (options: { url: string }) => Promise<void>;
    };
    viewport: {
      get: () => Promise<{
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
    };
    createText: (options: {
      content?: string;
      x?: number;
      y?: number;
      width?: number;
      parentId?: string;
      style?: {
        color?: string;
        fontFamily?: string;
        fontSize?: number;
        textAlign?: 'left' | 'center' | 'right';
      };
    }) => Promise<unknown>;
    createStickyNote: (options: {
      content?: string;
      x?: number;
      y?: number;
      width?: number;
      shape?: 'square' | 'rectangle';
      style?: {
        fillColor?: string;
        textAlign?: 'left' | 'center' | 'right';
        textAlignVertical?: 'top' | 'middle' | 'bottom';
      };
    }) => Promise<unknown>;
    createFrame: (options: {
      title?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      style?: {
        fillColor?: string;
      };
    }) => Promise<{ id: string }>;
    createImage: (options: {
      url: string;
      x?: number;
      y?: number;
      width?: number;
      title?: string;
      rotation?: number;
      parentId?: string;
    }) => Promise<unknown>;
    createShape: (options: {
      content?: string;
      shape: 'rectangle' | 'round_rectangle' | 'circle' | 'triangle' | 'rhombus' | 'parallelogram' | 'trapezoid' | 'pentagon' | 'hexagon' | 'octagon' | 'star' | 'line' | 'arrow';
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      rotation?: number;
      parentId?: string;
      style?: {
        fillColor?: string;
        fillOpacity?: number;
        borderColor?: string;
        borderOpacity?: number;
        borderWidth?: number;
        borderStyle?: 'normal' | 'dashed' | 'dotted';
        color?: string;
        fontSize?: number;
        fontFamily?: string;
        textAlign?: 'left' | 'center' | 'right';
        textAlignVertical?: 'top' | 'middle' | 'bottom';
      };
    }) => Promise<unknown>;
  };
};
