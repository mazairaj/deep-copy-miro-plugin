import { DeepCopyElement, DeepCopyPayload, ImportResult } from '../types/deep-copy';
import JSZip from 'jszip';

/**
 * Check if an error is a Miro rate limit error.
 * Looks for keywords: "credits", "10000", "rate limit", "429", "too many requests"
 */
function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('credits') ||
    msg.includes('10000') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('429')
  );
}

/**
 * Calculate wait time for rate limit recovery.
 * @param retryCount - Current retry attempt (0-based, unused but kept for API compatibility)
 * @returns Wait time in milliseconds (fixed 20 seconds)
 */
function getBackoffWaitTime(retryCount: number): number {
  return 20000; // Fixed 20-second pause
}

/**
 * Wait for rate limit recovery with fixed 20-second pause.
 * @param retryCount - Current retry attempt (0-based)
 */
async function waitWithBackoff(retryCount: number): Promise<void> {
  const waitTime = getBackoffWaitTime(retryCount);
  console.log(`Rate limit detected, waiting 20s before retry ${retryCount + 1}/5`);
  await new Promise(resolve => setTimeout(resolve, waitTime));
}

/**
 * Execute a Miro API call with automatic retry on rate limit errors.
 * @param createFn - Function that performs the Miro API call
 * @param elementId - Element ID for logging
 * @param onRateLimited - Optional callback when rate limit is detected
 * @param maxRetries - Maximum number of retry attempts (default: 5)
 */
async function createWithRetry(
  createFn: () => Promise<void>,
  elementId: string,
  onRateLimited?: (retryCount: number, waitTime: number) => void,
  maxRetries: number = 5
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await createFn();
      return; // Success
    } catch (error) {
      if (isRateLimitError(error) && attempt < maxRetries - 1) {
        const waitTime = getBackoffWaitTime(attempt);
        if (onRateLimited) {
          onRateLimited(attempt, waitTime);
        }
        await waitWithBackoff(attempt);
        continue; // Retry
      }
      throw error; // Not rate limit or max retries reached
    }
  }
}

/**
 * Maps a VibeIQ font family name to the closest Miro FontFamily value.
 */
function mapToMiroFontFamily(vibeiqFont?: string): string | undefined {
  if (!vibeiqFont) return undefined;
  const normalized = vibeiqFont.trim().toLowerCase();
  const mapping: Record<string, string> = {
    'arial': 'arial',
    'arial black': 'arial',
    'arial narrow': 'arial',
    'arial rounded mt bold': 'arial',
    'avenir': 'open_sans',
    'bradley hand': 'cursive',
    'comic sans ms': 'caveat',
    'copperplate': 'serif',
    'courier': 'monospace',
    'courier new': 'monospace',
    'fantasy': 'cursive',
    'georgia': 'georgia',
    'helvetica': 'arial',
    'impact': 'gravitas_one',
    'palatino': 'pt_serif',
    'playfair display': 'eb_garamond',
    'roboto': 'roboto',
    'sans-serif': 'sans_serif',
    'snell roundhand': 'cursive',
    'times new roman': 'times_new_roman',
    'trebuchet ms': 'open_sans',
    'verdana': 'open_sans',
  };
  return mapping[normalized] || 'open_sans';
}

/**
 * Creates a single Miro element from a VibeIQ deep copy element.
 * 
 * NOTE: The JSON payload already contains CENTER coordinates (converted by VibeIQ),
 * so we can use them directly with Miro's API which also uses center coordinates.
 * 
 * @param element - The element data from the VibeIQ payload
 * @param offsetX - X offset to apply (for viewport centering)
 * @param offsetY - Y offset to apply (for viewport centering)
 * @param scale - Scale factor for the element
 */
export async function createMiroElement(
  element: DeepCopyElement,
  offsetX: number = 0,
  offsetY: number = 0,
  scale: number = 1,
  zip?: JSZip | null,
  onRateLimited?: (retryCount: number, waitTime: number) => void
): Promise<void> {
  const width = element.size.width * scale;
  const height = element.size.height * scale;
  
  // Positions are already CENTER coordinates (converted by VibeIQ export)
  // Just apply the offset for viewport centering
  const x = element.position.x + offsetX;
  const y = element.position.y + offsetY;

  switch (element.type) {
    case 'text':
    case 'sticky_note':
      // Both text and sticky_note use the same logic:
      // - Text with background → shape with content
      // - Text without background → createText()
      // - Sticky notes always have background, so they become shapes
      await createTextElement(element, x, y, width, height, undefined, onRateLimited);
      break;

    case 'frame':
      await createFrameElement(element, x, y, width, height, onRateLimited);
      break;

    case 'image':
    case 'item_card':
      await createImageElement(element, x, y, width, zip, undefined, onRateLimited);
      break;

    case 'shape':
      if (element.shapeType) {
        await createNativeShapeElement(element, x, y, width, height, onRateLimited);
      } else {
        // Legacy: image-based shape (heart, line, arrow, etc.)
        await createImageElement(element, x, y, width, zip, undefined, onRateLimited);
      }
      break;

    case 'table':
      await createTableElement(element, x, y, width, height, onRateLimited);
      break;

    default:
      console.warn(`Unknown element type: ${element.type}, skipping`);
  }
}

/**
 * Create a text element. When the element has a non-white, non-transparent background
 * (hasShapeBackground), Miro Text does not support fill—so we use createShape
 * (rectangle with built-in content and alignment). Otherwise we use createText only.
 */
async function createTextElement(
  element: DeepCopyElement,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string,
  onRateLimited?: (retryCount: number, waitTime: number) => void
): Promise<void> {
  const fontSize = element.fontSize || 14;
  const hasShapeBackground =
    element.hasShapeBackground === true ||
    (element.backgroundColor &&
      element.backgroundColor.trim() !== '' &&
      !isWhiteOrTransparent(element.backgroundColor.trim()));

  const textAlign = element.textAlign || 'left';
  const textAlignVertical = element.textAlignVertical || 'middle';

  if (hasShapeBackground) {
    // Miro Text does not support background/fill. Use a shape (rectangle with content).
    const contentHtml = element.content
      ? `<p>${escapeHtmlContent(element.content).replace(/\n/g, '<br/>')}</p>`
      : '<p></p>';

    // Build style object
    const shapeStyle: Record<string, unknown> = {
      fillColor: normalizeColorToHex(element.backgroundColor!),
      fillOpacity: 1,
      borderOpacity: 0,
      color: normalizeColorToHex(element.color || '#1a1a1a'),
      fontSize,
      textAlign,
      textAlignVertical,
    };

    if (element.fontFamily && element.fontFamily.trim() !== '') {
      const mappedFont = mapToMiroFontFamily(element.fontFamily);
      if (mappedFont) {
        shapeStyle.fontFamily = mappedFont;
      }
    }

    // Build shape options
    const shapeOptions: Record<string, unknown> = {
      content: contentHtml,
      shape: 'rectangle',
      x,
      y,
      width,
      height,
      style: shapeStyle,
    };

    if (element.rotation != null) {
      shapeOptions.rotation = element.rotation;
    }

    if (parentId) {
      shapeOptions.parentId = parentId;
    }

    // Debug logging
    console.log('Creating shape with text:', {
      elementId: element.id,
      content: contentHtml.substring(0, 100) + (contentHtml.length > 100 ? '...' : ''),
      shape: 'rectangle',
      position: { x, y },
      size: { width, height },
      style: shapeStyle,
    });

    await createWithRetry(
      async () => { await miro.board.createShape(shapeOptions as Parameters<typeof miro.board.createShape>[0]); },
      element.id,
      onRateLimited
    );
  } else {
    // Text without background - use createText()
    const style: Record<string, unknown> = {
      fontSize: fontSize,
      textAlign: textAlign,
    };

    // Apply font color (from element.color, normalized to hex by VibeIQ export)
    if (element.color) {
      style.color = normalizeColorToHex(element.color);
    }

    if (element.fontFamily) {
      style.fontFamily = mapToMiroFontFamily(element.fontFamily);
    }

    const textOptions: Parameters<typeof miro.board.createText>[0] = {
      content: element.content || '',
      x,
      y,
      width,
      style: style as Parameters<typeof miro.board.createText>[0]['style'],
    };

    if (element.rotation != null) {
      (textOptions as Record<string, unknown>).rotation = element.rotation;
    }

    if (parentId) {
      (textOptions as Record<string, unknown>).parentId = parentId;
    }

    await createWithRetry(
      async () => { await miro.board.createText(textOptions); },
      element.id,
      onRateLimited
    );
  }
}

/** True when the color is white or transparent (no shape background). */
function isWhiteOrTransparent(hex: string): boolean {
  const h = hex.trim().toLowerCase();
  return h === '#ffffff' || h === '#fff' || h === 'transparent';
}

/** Convert color name or hex to hex format for Miro API. */
function normalizeColorToHex(color: string): string {
  if (!color) return '#1a1a1a'; // Default dark gray
  
  const normalized = color.trim().toLowerCase();
  
  // If already hex, return as-is
  if (normalized.startsWith('#')) {
    return normalized;
  }
  
  // Convert common color names to hex
  const colorMap: Record<string, string> = {
    'white': '#ffffff',
    'black': '#000000',
    'red': '#ff0000',
    'green': '#00ff00',
    'blue': '#0000ff',
    'yellow': '#ffff00',
    'cyan': '#00ffff',
    'magenta': '#ff00ff',
    'gray': '#808080',
    'grey': '#808080',
    'orange': '#ffa500',
    'purple': '#800080',
    'pink': '#ffc0cb',
    'brown': '#a52a2a',
    'transparent': '#ffffff', // Fallback to white for transparent
  };
  
  return colorMap[normalized] || normalized; // Return original if not found
}

/** Escape HTML for use inside shape content (basic). */
function escapeHtmlContent(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Create a frame element.
 */
async function createFrameElement(
  element: DeepCopyElement,
  x: number,
  y: number,
  width: number,
  height: number,
  onRateLimited?: (retryCount: number, waitTime: number) => void
): Promise<unknown> {
  const frameOptions = {
    title: element.title || '',
    x,
    y,
    width: Math.max(width, 100),
    height: Math.max(height, 100),
    style: {
      fillColor: element.backgroundColor && element.backgroundColor.trim() !== ''
        ? element.backgroundColor
        : '#ffffff',
    },
  };
  
  await createWithRetry(
    async () => { await miro.board.createFrame(frameOptions); },
    element.id,
    onRateLimited
  );
}

/**
 * Convert a Blob to a data URL for use with Miro's createImage API.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to convert blob to data URL'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Resolve imageRef from ZIP file to a data URL.
 *
 * JSZip's async('blob') returns a Blob with MIME type 'application/octet-stream',
 * which Miro's createImage API rejects. We use async('arraybuffer') and wrap it
 * in a Blob with an explicit 'image/png' MIME type so the FileReader produces a
 * valid 'data:image/png;base64,...' URL that Miro accepts.
 */
async function resolveImageRefFromZip(zip: JSZip, imageRef: string): Promise<string> {
  const imageFile = zip.file(imageRef);
  if (!imageFile) {
    throw new Error(`Image not found in ZIP: ${imageRef}`);
  }
  const arrayBuffer = await imageFile.async('arraybuffer');
  const mimeType = imageRef.endsWith('.jpg') || imageRef.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  const blob = new Blob([arrayBuffer], { type: mimeType });
  return await blobToDataUrl(blob);
}

/**
 * Create an image element from base64 data URL or ZIP imageRef.
 */
async function createImageElement(
  element: DeepCopyElement,
  x: number,
  y: number,
  width: number,
  zip?: JSZip | null,
  parentId?: string,
  onRateLimited?: (retryCount: number, waitTime: number) => void
): Promise<void> {
  let imageUrl: string;

  // Priority: imageRef (ZIP) > imageData (legacy)
  if (element.imageRef && zip) {
    // Resolve image from ZIP
    try {
      imageUrl = await resolveImageRefFromZip(zip, element.imageRef);
    } catch (error) {
      console.error(`Failed to resolve imageRef ${element.imageRef}:`, error);
      throw new Error(`Image not found: ${element.imageRef}`);
    }
  } else if (element.imageData) {
    // Use legacy imageData (base64 data URL)
    imageUrl = element.imageData;
  } else {
    throw new Error('Image element missing imageData or imageRef');
  }

  // Log first 80 chars of the resolved URL so we can confirm the format
  console.log(`Creating image ${element.id} — url prefix: ${imageUrl.substring(0, 80)}`);

  // Guard against empty base64 data URLs (canvas rendered a blank element).
  // A valid PNG data URL has content after "base64," — an empty one has nothing.
  if (/^data:[^;]+;base64,$/.test(imageUrl.trim())) {
    throw new Error(`Element ${element.id} rendered as empty image — skipping`);
  }

  const imageOptions: Parameters<typeof miro.board.createImage>[0] = {
    url: imageUrl,
    x,
    y,
    width,
  };

  if (element.rotation != null) {
    (imageOptions as Record<string, unknown>).rotation = element.rotation;
  }

  if (parentId) {
    (imageOptions as Record<string, unknown>).parentId = parentId;
  }

  await createWithRetry(
    async () => { await miro.board.createImage(imageOptions); },
    element.id,
    onRateLimited
  );
}

/**
 * VibeIQ shape type → Miro ShapeType mapping.
 */
const VIBEIQ_TO_MIRO_SHAPE: Record<string, string> = {
  circle: 'circle',
  rectangle: 'rectangle',
  round_rectangle: 'round_rectangle',
  triangle: 'triangle',
  diamond: 'rhombus',
  star: 'star',
  right_arrow: 'right_arrow',
  double_arrow: 'left_right_arrow',
  rhombus: 'rhombus',
  cloud: 'cloud',
  callout: 'wedge_round_rectangle_callout',
};

/**
 * Create a native Miro shape element (rectangle, circle, star, etc.)
 * from VibeIQ shape metadata — no canvas rendering required.
 */
async function createNativeShapeElement(
  element: DeepCopyElement,
  x: number,
  y: number,
  width: number,
  height: number,
  onRateLimited?: (retryCount: number, waitTime: number) => void
): Promise<void> {
  const miroShape = VIBEIQ_TO_MIRO_SHAPE[element.shapeType!] || 'rectangle';
  const isTransparent = !element.backgroundColor || element.backgroundColor === 'transparent';

  const style: Record<string, unknown> = {
    fillColor: isTransparent ? '#ffffff' : normalizeColorToHex(element.backgroundColor!),
    fillOpacity: isTransparent ? 0 : 1,
  };

  if (element.borderColor) {
    style.borderColor = normalizeColorToHex(element.borderColor);
    style.borderOpacity = 1;
  }
  if (element.borderWidth != null) {
    style.borderWidth = element.borderWidth;
  }

  const shapeOptions: Record<string, unknown> = {
    shape: miroShape,
    x,
    y,
    width,
    height,
    style,
  };

  if (element.rotation != null) {
    shapeOptions.rotation = element.rotation;
  }

  console.log(`Creating native shape ${element.id} (${miroShape}):`, {
    position: { x, y },
    size: { width, height },
    style,
  });

  await createWithRetry(
    async () => { await miro.board.createShape(shapeOptions as Parameters<typeof miro.board.createShape>[0]); },
    element.id,
    onRateLimited
  );
}

/**
 * Create a Miro table from VibeIQ table data.
 *
 * miro.board.createTable may not appear in older @mirohq/websdk-types definitions,
 * so we cast miro.board to any to avoid compile errors while preserving runtime behaviour.
 *
 * NOTE: Miro's createTable does NOT accept width/height directly — table dimensions
 * are determined by the row/column counts. We pass only x, y, rows, columns, cells, style.
 */
async function createTableElement(
  element: DeepCopyElement,
  x: number,
  y: number,
  _width: number,
  _height: number,
  onRateLimited?: (retryCount: number, waitTime: number) => void
): Promise<void> {
  const rows = element.rows ?? 1;
  const columns = element.columns ?? 1;

  const tableOptions: Record<string, unknown> = {
    x,
    y,
    rows,
    columns,
  };

  if (element.cells && element.cells.length > 0) {
    tableOptions.cells = element.cells.map((row) =>
      row.map((cell) => {
        const cellDef: Record<string, unknown> = { content: cell.content ?? '' };
        if (cell.style && (cell.style.fillColor || cell.style.textAlign)) {
          const cellStyle: Record<string, unknown> = {};
          if (cell.style.fillColor) cellStyle.fillColor = cell.style.fillColor;
          if (cell.style.textAlign) cellStyle.textAlign = cell.style.textAlign;
          cellDef.style = cellStyle;
        }
        return cellDef;
      }),
    );
  }

  if (element.borderColor) {
    tableOptions.style = {
      borderColor: element.borderColor,
      borderWidth: element.borderWidth ?? 1,
    };
  }

  console.log(`Creating table ${element.id}:`, JSON.stringify(tableOptions, null, 2));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boardAny = miro.board as any;
  if (typeof boardAny.createTable !== 'function') {
    throw new Error('miro.board.createTable is not available in this SDK version');
  }

  await createWithRetry(
    async () => {
      await boardAny.createTable(tableOptions);
      console.log(`Table ${element.id} created successfully`);
    },
    element.id,
    onRateLimited
  );
}

/**
 * Import all elements from a payload with progress tracking.
 *
 * Elements are imported in two passes:
 * 1. First pass: Create all FRAMES
 * 2. Second pass: Create all other elements at their ABSOLUTE positions
 *
 * All positions in the payload are absolute canvas coordinates.
 * Elements that were visually inside frames in VibeIQ will appear at
 * the correct position overlapping the Miro frame.
 *
 * @param elements - Array of elements to import
 * @param offsetX - X offset for positioning
 * @param offsetY - Y offset for positioning
 * @param scale - Scale factor
 * @param onProgress - Callback for progress updates
 * @returns Import result with success/failure counts
 */
export async function importElements(
  elements: DeepCopyElement[],
  offsetX: number = 0,
  offsetY: number = 0,
  scale: number = 1,
  onProgress?: (current: number, total: number) => void,
  zip?: JSZip | null,
  onRateLimited?: (retryCount: number, waitTime: number) => void
): Promise<ImportResult> {
  const result: ImportResult = {
    total: elements.length,
    created: 0,
    failed: 0,
    errors: [],
  };

  const frames = elements.filter(el => el.type === 'frame');
  const nonFrames = elements.filter(el => el.type !== 'frame');

  let progressIndex = 0;

  // PASS 1: Create all frames first (so they visually contain child elements)
  for (const frame of frames) {
    progressIndex++;
    if (onProgress) {
      onProgress(progressIndex, elements.length);
    }

    try {
      console.log(`Creating frame ${frame.id}:`, {
        title: frame.title,
        x: frame.position.x + offsetX,
        y: frame.position.y + offsetY,
        width: frame.size.width * scale,
        height: frame.size.height * scale,
        backgroundColor: frame.backgroundColor,
      });
      await createFrameElement(
        frame,
        frame.position.x + offsetX,
        frame.position.y + offsetY,
        frame.size.width * scale,
        frame.size.height * scale,
      );
      result.created++;
    } catch (error) {
      result.failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({
        elementId: frame.id,
        error: errorMsg,
      });
      console.error(`Failed to create frame ${frame.id}:`, error);
    }
  }

  console.log(`Pass 1 complete. Created ${result.created} frames out of ${frames.length}.`);

  // PASS 2: Create all non-frame elements in batches with a delay between batches.
  const BATCH_SIZE = 30;
  const DELAY_BETWEEN_BATCHES_MS = 2000;

  for (let i = 0; i < nonFrames.length; i += BATCH_SIZE) {
    const batch = nonFrames.slice(i, i + BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
      const element = batch[batchIndex];
      if (onProgress) onProgress(progressIndex + i + batchIndex + 1, elements.length);

      try {
        await createMiroElement(element, offsetX, offsetY, scale, zip, onRateLimited);
        result.created++;
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({ elementId: element.id, error: errorMsg });
        console.error(`Failed to create element ${element.id}:`, error);
      }
    }

    if (i + BATCH_SIZE < nonFrames.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  progressIndex += nonFrames.length;

  return result;
}

/**
 * Import elements from multiple chunk payloads in a single coordinated session.
 *
 * Runs two passes across ALL chunks before moving on:
 * 1. Pass 1: Create every frame from every chunk (establishes visual containers)
 * 2. Pass 2: Create all remaining elements from every chunk in batches
 *
 * A single viewport offset is applied to all elements, so all chunks land
 * at the correct positions relative to each other.
 *
 * @param chunks   - Ordered array of {payload, zip} pairs (sort by chunkIndex before calling)
 * @param offsetX  - X offset for viewport centering (same value used for all chunks)
 * @param offsetY  - Y offset for viewport centering (same value used for all chunks)
 * @param scale    - Scale factor applied to all elements
 * @param onProgress - Progress callback with (current, total) across all chunks combined
 */
export async function importMultiplePayloads(
  chunks: Array<{ payload: DeepCopyPayload; zip: JSZip | null }>,
  offsetX: number = 0,
  offsetY: number = 0,
  scale: number = 1,
  onProgress?: (current: number, total: number) => void,
  onRateLimited?: (retryCount: number, waitTime: number) => void
): Promise<ImportResult> {
  const total = chunks.reduce((sum, c) => sum + c.payload.elements.length, 0);
  const result: ImportResult = { total, created: 0, failed: 0, errors: [] };

  // Collect all frames and non-frames with their associated ZIP context.
  const allFrames: Array<{ element: DeepCopyElement; zip: JSZip | null }> = [];
  const allNonFrames: Array<{ element: DeepCopyElement; zip: JSZip | null }> = [];

  for (const chunk of chunks) {
    for (const el of chunk.payload.elements) {
      if (el.type === 'frame') {
        allFrames.push({ element: el, zip: chunk.zip });
      } else {
        allNonFrames.push({ element: el, zip: chunk.zip });
      }
    }
  }

  let progressIndex = 0;

  // PASS 1: Create all frames across all chunks first.
  for (const { element: frame } of allFrames) {
    progressIndex++;
    if (onProgress) onProgress(progressIndex, total);

    try {
      console.log(`[multi] Creating frame ${frame.id}:`, {
        title: frame.title,
        x: frame.position.x + offsetX,
        y: frame.position.y + offsetY,
        width: frame.size.width * scale,
        height: frame.size.height * scale,
      });
      await createFrameElement(
        frame,
        frame.position.x + offsetX,
        frame.position.y + offsetY,
        frame.size.width * scale,
        frame.size.height * scale,
        onRateLimited
      );
      result.created++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        elementId: frame.id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`[multi] Failed to create frame ${frame.id}:`, error);
    }
  }

  console.log(`[multi] Pass 1 complete. Created ${result.created} frames out of ${allFrames.length}.`);

  // PASS 2: Create all non-frame elements in batches with a delay between batches.
  const BATCH_SIZE = 30;
  const DELAY_BETWEEN_BATCHES_MS = 2000;

  for (let i = 0; i < allNonFrames.length; i += BATCH_SIZE) {
    const batch = allNonFrames.slice(i, i + BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
      const { element, zip } = batch[batchIndex];
      if (onProgress) onProgress(progressIndex + i + batchIndex + 1, total);

      try {
        await createMiroElement(element, offsetX, offsetY, scale, zip, onRateLimited);
        result.created++;
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({ elementId: element.id, error: errorMsg });
        console.error(`[multi] Failed to create element ${element.id}:`, error);
      }
    }

    if (i + BATCH_SIZE < allNonFrames.length) {
      await new Promise<void>(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  return result;
}
