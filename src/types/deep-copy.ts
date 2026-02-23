/**
 * Represents a single element from the VibeIQ deep copy payload.
 */
export interface DeepCopyElement {
  /** UUID of the original VibeIQ element */
  id: string;
  
  /** Element type classification */
  type: 'text' | 'frame' | 'image' | 'item_card' | 'shape' | 'sticky_note' | 'table';
  
  /** 
   * Position on the source board (pixels) - CENTER coordinates
   * NOTE: VibeIQ export converts from top-left to center coordinates
   * so these values can be used directly with Miro's API.
   * 
   * IMPORTANT: These are ABSOLUTE canvas coordinates, even for
   * elements that are children of frames.
   */
  position: {
    x: number;
    y: number;
  };
  
  /** Dimensions (pixels) */
  size: {
    width: number;
    height: number;
  };
  
  /** Text content for text elements */
  content?: string;
  
  /** Image source: remote URL (S3) or base64 data URL for image-based elements (legacy) */
  imageData?: string;

  /** Reference to image file in ZIP export (e.g., "images/abc123.png") */
  imageRef?: string;
  
  /** Background color in hex format (e.g., "#FFEB3B") */
  backgroundColor?: string;
  
  /** Title for frame elements */
  title?: string;
  
  /** Font size in pixels for text elements */
  fontSize?: number;

  /** Text color in hex format (e.g., "#000000") */
  color?: string;

  /** Rotation angle in degrees */
  rotation?: number;

  /** Font family name from VibeIQ (e.g., "Roboto", "Bradley Hand") */
  fontFamily?: string;

  /** Horizontal text alignment (left | center | right) for Miro */
  textAlign?: 'left' | 'center' | 'right';

  /** Vertical text alignment (top | middle | bottom) for Miro shapes */
  textAlignVertical?: 'top' | 'middle' | 'bottom';

  /** When true, text with background should be created as a Miro shape (rectangle with content), not Text */
  hasShapeBackground?: boolean;

  /** VibeIQ shape type for native Miro shape creation (e.g., "circle", "rectangle", "star") */
  shapeType?: string;

  /** Border color in hex for native shapes and tables */
  borderColor?: string;

  /** Border width in pixels for native shapes and tables */
  borderWidth?: number;

  /** Number of rows (table elements only) */
  rows?: number;

  /** Number of columns (table elements only) */
  columns?: number;

  /**
   * 2D cell data array [row][column] (table elements only).
   * Each cell has `content` (plain text) and optional styling.
   */
  cells?: Array<Array<{
    content: string;
    style?: {
      fillColor?: string;
      textAlign?: 'left' | 'center' | 'right';
    };
  }>>;

  /** Whether element is positioned on a frame (informational only) */
  isOnFrame?: boolean;
  
  /**
   * ID of the parent frame in VibeIQ (if element is a child of a frame).
   * When present, the Miro import will:
   * 1. Create the frame first
   * 2. Convert this element's position to frame-relative coordinates
   * 3. Create this element as a child of the Miro frame
   */
  parentFrameId?: string;
}

/**
 * The complete JSON file payload from VibeIQ's Deep Copy All feature.
 */
export interface DeepCopyPayload {
  /** Schema version (currently "1.0") */
  version: string;

  /** Source identifier - must be "vibeiq-board" */
  source: string;

  /** Array of elements to import */
  elements: DeepCopyElement[];

  /**
   * 1-based index of this chunk within a split export.
   * Present only when the export was split into multiple files.
   */
  chunkIndex?: number;

  /**
   * Total number of chunk files in this split export.
   * Present only when the export was split into multiple files.
   */
  totalChunks?: number;
}

/**
 * Result of an import operation.
 */
export interface ImportResult {
  /** Total number of elements attempted */
  total: number;
  
  /** Number successfully created */
  created: number;
  
  /** Number that failed */
  failed: number;
  
  /** Details of any errors */
  errors: Array<{
    elementId: string;
    error: string;
  }>;
}

/**
 * Import options configurable by the user.
 */
export interface ImportOptions {
  /** Whether to offset elements to the current viewport center */
  useViewportOffset: boolean;
  
  /** Scale factor for imported elements (1.0 = original size) */
  scaleFactor: number;
}
