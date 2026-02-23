import * as React from 'react';
import { useState, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { DeepCopyElement, DeepCopyPayload, ImportResult, ImportOptions } from './types/deep-copy';
import { importElements, importMultiplePayloads } from './services/element-creator';
import './assets/style.css';

const DEFAULT_OPTIONS: ImportOptions = {
  useViewportOffset: true,
  scaleFactor: 1.0,
};

const App: React.FC = () => {
  // State
  const [jsonInput, setJsonInput] = useState('');
  // parsedChunks holds one entry per uploaded file (sorted by chunkIndex).
  // Single-file uploads produce a one-element array; multi-chunk exports produce N entries.
  const [parsedChunks, setParsedChunks] = useState<Array<{ payload: DeepCopyPayload; zip: JSZip | null }>>([]);
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  /**
   * Check if a single element has the required fields.
   */
  const isValidElement = (el: any): boolean => {
    return (
      el &&
      el.id &&
      el.type &&
      el.position &&
      typeof el.position.x === 'number' &&
      typeof el.position.y === 'number' &&
      el.size &&
      typeof el.size.width === 'number' &&
      typeof el.size.height === 'number'
    );
  };

  /**
   * Validate the parsed JSON matches the expected payload structure.
   * Filters out invalid elements instead of rejecting the entire payload.
   * Returns the cleaned payload or null if the structure is fundamentally invalid.
   */
  const validateAndCleanPayload = (data: unknown): DeepCopyPayload | null => {
    if (!data || typeof data !== 'object') {
      console.error('Payload validation: data is not an object', typeof data);
      return null;
    }

    const payload = data as DeepCopyPayload;

    if (payload.source !== 'vibeiq-board') {
      console.error('Payload validation: source is not "vibeiq-board"', payload.source);
      return null;
    }

    if (!Array.isArray(payload.elements)) {
      console.error('Payload validation: elements is not an array', typeof payload.elements);
      return null;
    }

    if (payload.elements.length === 0) {
      console.error('Payload validation: elements array is empty');
      return null;
    }

    // Filter to valid elements, log the first few invalid ones for debugging
    const validElements = [];
    const invalidElements = [];
    for (const el of payload.elements) {
      if (isValidElement(el)) {
        validElements.push(el);
      } else {
        if (invalidElements.length < 5) {
          invalidElements.push(el);
        }
      }
    }

    if (invalidElements.length > 0) {
      const skipped = payload.elements.length - validElements.length;
      console.warn(`Payload validation: skipped ${skipped} invalid element(s). First few:`, invalidElements);
    }

    if (validElements.length === 0) {
      console.error('Payload validation: no valid elements found. Sample:', payload.elements.slice(0, 3));
      return null;
    }

    return {
      ...payload,
      elements: validElements,
    };
  };

  /**
   * Decompress a gzip file using the Compression Streams API.
   * Falls back to error if DecompressionStream is not available.
   */
  const decompressGzip = useCallback(async (file: File): Promise<string> => {
    // Check if DecompressionStream is available (Chrome 80+, Edge 80+, Safari 16.4+)
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Gzip decompression is not supported in this browser. Please use an uncompressed .json file or update your browser.');
    }

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      
      // Create a decompression stream
      const decompressionStream = new DecompressionStream('gzip');
      const decompressedStream = new Blob([arrayBuffer]).stream().pipeThrough(decompressionStream);
      
      // Convert decompressed stream to text
      const decompressedBlob = await new Response(decompressedStream).blob();
      return await decompressedBlob.text();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to decompress file: ${error.message}`);
      }
      throw new Error('Failed to decompress file');
    }
  }, []);

  /**
   * Parse a single file and return one or more {payload, zip} entries.
   *
   * Returns an array because a multi-chunk ZIP contains several chunk files;
   * all other formats return a single-element array.
   *
   * ZIP format detection:
   *   - manifest.json has `totalChunks > 1`  → multi-chunk ZIP (reads chunks/chunk-N.json)
   *   - manifest.json has `elements` array   → legacy single-chunk ZIP
   */
  const parseFile = useCallback(async (file: File): Promise<Array<{ payload: DeepCopyPayload; zip: JSZip | null }>> => {
    const isZip = file.name.endsWith('.zip') || file.type === 'application/zip';
    const isCompressed = file.name.endsWith('.gz') || file.name.endsWith('.json.gz');

    if (isZip) {
      const zip = await JSZip.loadAsync(file);
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) throw new Error(`Invalid ZIP: missing manifest.json in ${file.name}`);
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(await manifestFile.async('string'));
      } catch {
        throw new Error(`Invalid manifest.json format in ${file.name}`);
      }

      // Multi-chunk ZIP: manifest has totalChunks but no elements array.
      const totalChunks = typeof manifest.totalChunks === 'number' ? manifest.totalChunks : 0;
      if (totalChunks > 1) {
        const results: Array<{ payload: DeepCopyPayload; zip: JSZip | null }> = [];
        for (let i = 1; i <= totalChunks; i++) {
          const chunkFile = zip.file(`chunks/chunk-${i}.json`);
          if (!chunkFile) throw new Error(`Missing chunks/chunk-${i}.json in ${file.name}`);
          let chunkData: unknown;
          try {
            chunkData = JSON.parse(await chunkFile.async('string'));
          } catch {
            throw new Error(`Invalid chunks/chunk-${i}.json in ${file.name}`);
          }
          const cleaned = validateAndCleanPayload(chunkData);
          if (!cleaned) throw new Error(`Invalid payload in chunks/chunk-${i}.json of ${file.name}`);
          // All chunks share the same ZIP so imageRef paths resolve correctly.
          results.push({ payload: cleaned, zip });
        }
        return results;
      }

      // Legacy single-chunk ZIP: manifest.json contains the elements array directly.
      const cleanedPayload = validateAndCleanPayload(manifest);
      if (!cleanedPayload) throw new Error(`Invalid payload structure in ${file.name}. Check browser console for details.`);
      return [{ payload: cleanedPayload, zip }];
    }

    let text: string;
    if (isCompressed) {
      text = await decompressGzip(file);
    } else {
      text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error(`Error reading ${file.name}`));
        reader.readAsText(file);
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (parseError) {
      if (parseError instanceof RangeError || (parseError instanceof Error && parseError.message.includes('Invalid string length'))) {
        throw new Error(`${file.name} is too large for this browser to parse. Try selecting fewer elements in VibeIQ.`);
      }
      throw new Error(`Invalid JSON format in ${file.name}.`);
    }

    const cleanedPayload = validateAndCleanPayload(payload);
    if (!cleanedPayload) throw new Error(`Invalid payload structure in ${file.name}. Expected VibeIQ deep copy format.`);
    return [{ payload: cleanedPayload, zip: null }];
  }, [decompressGzip]);

  /**
   * Handle file selection — supports single or multiple files (chunked exports).
   * Each file is parsed independently then sorted by chunkIndex before storing.
   */
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const fileCount = files.length;
    setStatus(`Loading ${fileCount} file${fileCount > 1 ? 's' : ''}...`);
    setStatusType('info');
    setParsedChunks([]);

    const newChunks: Array<{ payload: DeepCopyPayload; zip: JSZip | null }> = [];

    try {
      for (let i = 0; i < fileCount; i++) {
        const file = files[i];
        if (fileCount > 1) {
          setStatus(`Loading file ${i + 1} of ${fileCount}: ${file.name}...`);
        }
        const results = await parseFile(file);
        newChunks.push(...results);
      }
    } catch (error) {
      if (error instanceof RangeError || (error instanceof Error && error.message.includes('Invalid string length'))) {
        setStatus('A file is too large for this browser to import. Try selecting fewer elements in VibeIQ and export again.');
      } else if (error instanceof Error) {
        setStatus(error.message);
      } else {
        setStatus('Error processing file. Please check the file content.');
      }
      setStatusType('error');
      event.target.value = '';
      return;
    }

    // Sort by chunkIndex so files imported out-of-order are still processed correctly.
    newChunks.sort((a, b) => (a.payload.chunkIndex ?? 0) - (b.payload.chunkIndex ?? 0));

    setParsedChunks(newChunks);
    setJsonInput('');

    const totalElements = newChunks.reduce((sum, c) => sum + c.payload.elements.length, 0);
    if (newChunks.length === 1) {
      setStatus(`Loaded ${files[0].name} — ${totalElements} elements`);
    } else {
      const expectedChunks = newChunks[0]?.payload.totalChunks;
      const mismatchMsg =
        expectedChunks && expectedChunks !== newChunks.length
          ? ` (warning: expected ${expectedChunks} files, got ${newChunks.length})`
          : '';
      setStatus(`Loaded ${newChunks.length} files — ${totalElements} elements total${mismatchMsg}. Ready to import.`);
    }
    setStatusType('success');

    // Reset so the same file(s) can be re-selected if needed.
    event.target.value = '';
  }, [parseFile]);

  /**
   * Handle the main import action.
   * Uses parsedChunks when files were uploaded; falls back to jsonInput for clipboard pastes.
   */
  const handleImport = useCallback(async () => {
    if (parsedChunks.length === 0 && !jsonInput.trim()) {
      setStatus('Please choose or upload a JSON file first');
      setStatusType('error');
      return;
    }

    setIsImporting(true);
    setStatus('Validating...');
    setStatusType('info');
    setImportResult(null);
    setProgress(null);

    try {
      // Resolve chunks to import — file uploads use parsedChunks, clipboard paste uses jsonInput.
      let chunksToImport: Array<{ payload: DeepCopyPayload; zip: JSZip | null }>;

      if (parsedChunks.length > 0) {
        chunksToImport = parsedChunks;
      } else {
        let payload: DeepCopyPayload;
        try {
          payload = JSON.parse(jsonInput);
        } catch (parseError) {
          if (
            parseError instanceof RangeError ||
            (parseError instanceof Error && parseError.message.includes('Invalid string length'))
          ) {
            throw new Error('File is too large for this browser to import. Try selecting fewer elements in VibeIQ and export again.');
          }
          throw new Error('Invalid JSON format. Please check the file content.');
        }
        const cleaned = validateAndCleanPayload(payload);
        if (!cleaned) {
          throw new Error('Invalid payload structure. Expected VibeIQ deep copy format with "vibeiq-board" source and elements array. Check browser console for details.');
        }
        chunksToImport = [{ payload: cleaned, zip: null }];
      }

      // Collect all elements across every chunk for bounding-box calculation.
      const allElements: DeepCopyElement[] = chunksToImport.flatMap((c) => c.payload.elements);
      setStatus(`Importing ${allElements.length} elements...`);

      // Calculate a single viewport offset from the combined bounding box of ALL elements.
      // This shared offset ensures every chunk lands at the correct relative position.
      let offsetX = 0;
      let offsetY = 0;

      if (options.useViewportOffset && allElements.length > 0) {
        try {
          const viewport = await miro.board.viewport.get();

          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const el of allElements) {
            const halfWidth = el.size.width / 2;
            const halfHeight = el.size.height / 2;
            minX = Math.min(minX, el.position.x - halfWidth);
            minY = Math.min(minY, el.position.y - halfHeight);
            maxX = Math.max(maxX, el.position.x + halfWidth);
            maxY = Math.max(maxY, el.position.y + halfHeight);
          }

          const boundingBoxCenterX = (minX + maxX) / 2;
          const boundingBoxCenterY = (minY + maxY) / 2;
          const viewportCenterX = viewport.x + viewport.width / 2;
          const viewportCenterY = viewport.y + viewport.height / 2;
          offsetX = viewportCenterX - boundingBoxCenterX;
          offsetY = viewportCenterY - boundingBoxCenterY;

          console.log('Viewport centering:', {
            boundingBox: { minX, minY, maxX, maxY },
            boundingBoxCenter: { x: boundingBoxCenterX, y: boundingBoxCenterY },
            viewportCenter: { x: viewportCenterX, y: viewportCenterY },
            offset: { x: offsetX, y: offsetY },
          });
        } catch (viewportError) {
          console.warn('Could not get viewport, using original positions', viewportError);
        }
      }

      // Run import — multi-chunk uses importMultiplePayloads for a unified two-pass strategy.
      const progressCallback = (current: number, total: number) => {
        setProgress({ current, total });
        setStatus(`Importing ${current} of ${total}...`);
      };

      // Rate limit callback: update UI when rate limited
      const rateLimitCallback = (retryCount: number, _waitTime: number) => {
        setStatus(`Rate limit reached, waiting 20s before retry ${retryCount + 1}/5...`);
        setStatusType('info');
      };

      let result: ImportResult;
      if (chunksToImport.length === 1) {
        result = await importElements(
          chunksToImport[0].payload.elements,
          offsetX,
          offsetY,
          options.scaleFactor,
          progressCallback,
          chunksToImport[0].zip,
          rateLimitCallback,
        );
      } else {
        result = await importMultiplePayloads(
          chunksToImport,
          offsetX,
          offsetY,
          options.scaleFactor,
          progressCallback,
          rateLimitCallback,
        );
      }

      setImportResult(result);
      setProgress(null);

      if (result.failed === 0) {
        setStatus(`Successfully imported ${result.created} elements`);
        setStatusType('success');
        setJsonInput('');
        setParsedChunks([]);
      } else if (result.created > 0) {
        setStatus(`Partially imported: ${result.created} succeeded, ${result.failed} failed`);
        setStatusType('error');
      } else {
        setStatus(`Import failed: ${result.failed} elements could not be created`);
        setStatusType('error');
      }
    } catch (error) {
      console.error('Import error:', error);
      setStatus(error instanceof Error ? error.message : 'An unknown error occurred');
      setStatusType('error');
      setProgress(null);
    } finally {
      setIsImporting(false);
    }
  }, [jsonInput, parsedChunks, options]);

  /**
   * Clear all state.
   */
  const handleClear = useCallback(() => {
    setJsonInput('');
    setParsedChunks([]);
    setStatus('');
    setStatusType('info');
    setImportResult(null);
    setProgress(null);
  }, []);

  /**
   * Calculate preview info from current JSON or parsed chunks.
   */
  const previewInfo = useMemo(() => {
    let allElements: DeepCopyElement[] = [];

    if (parsedChunks.length > 0) {
      allElements = parsedChunks.flatMap((c) => c.payload.elements);
    } else if (jsonInput.trim()) {
      try {
        const parsed = JSON.parse(jsonInput);
        const cleaned = validateAndCleanPayload(parsed);
        if (cleaned) allElements = cleaned.elements;
      } catch {
        // Invalid JSON, no preview
      }
    }

    if (allElements.length === 0) return null;

    const typeCounts = allElements.reduce((acc, el) => {
      acc[el.type] = (acc[el.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: allElements.length,
      types: typeCounts,
      chunkCount: parsedChunks.length > 1 ? parsedChunks.length : undefined,
    };
  }, [jsonInput, parsedChunks]);

  return (
    <div className="wrapper">
      {/* Header */}
      <header className="header">
        <h2>VibeIQ Import</h2>
        <p className="description">
          Export elements in VibeIQ using "Deep Copy All", then upload the .json file here.
          <br />
          <strong>For large exports, VibeIQ will download a single .zip file containing all chunks — upload that file here.</strong>
        </p>
      </header>

      {/* Actions - Primary: file upload via hidden input triggered by button */}
      <div className="button-group">
        <input
          type="file"
          id="vibeiq-file-upload"
          accept=".json,.json.gz,.zip,application/json,application/gzip,application/zip"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button
          className="button button-secondary"
          onClick={() => document.getElementById('vibeiq-file-upload')?.click()}
          disabled={isImporting}
        >
          Choose File
        </button>
        <button
          className="button button-secondary"
          onClick={handleClear}
          disabled={isImporting || (!jsonInput && parsedChunks.length === 0)}
        >
          Clear
        </button>
      </div>

      {/* Options */}
      <div className="options-section">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.useViewportOffset}
            onChange={(e) =>
              setOptions((prev) => ({ ...prev, useViewportOffset: e.target.checked }))
            }
            disabled={isImporting}
          />
          <span>Center elements at current viewport</span>
        </label>
      </div>

      {/* JSON Input — hidden when a file is loaded to avoid rendering large strings
          in a controlled textarea which can freeze the browser. */}
      {parsedChunks.length === 0 && (
        <textarea
          className="json-input"
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          placeholder='Choose a file or paste JSON from VibeIQ export...

File: vibeiq-export-YYYY-MM-DD.json'
          disabled={isImporting}
          spellCheck={false}
        />
      )}

      {/* Preview Info */}
      {previewInfo && (
        <div className="preview-info">
          <strong>
            {previewInfo.total} elements ready to import
            {previewInfo.chunkCount ? ` (${previewInfo.chunkCount} chunks)` : ''}:
          </strong>
          <ul>
            {Object.entries(previewInfo.types).map(([type, count]) => (
              <li key={type}>
                {type}: {count}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Progress Bar */}
      {progress && (
        <div className="progress-container">
          <div
            className="progress-bar"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
          <span className="progress-text">
            {progress.current} / {progress.total}
          </span>
        </div>
      )}

      {/* Import Button */}
      <button
        className="button button-primary button-large"
        onClick={handleImport}
        disabled={isImporting || (parsedChunks.length === 0 && !jsonInput.trim())}
      >
        {isImporting ? 'Importing...' : 'Import Elements'}
      </button>

      {/* Status Message */}
      {status && (
        <p className={`status status-${statusType}`}>
          {status}
        </p>
      )}

      {/* Error Details */}
      {importResult && importResult.errors.length > 0 && (
        <details className="error-details">
          <summary>
            View {importResult.errors.length} error{importResult.errors.length !== 1 ? 's' : ''}
          </summary>
          <ul>
            {importResult.errors.map((err, index) => (
              <li key={index}>
                <code>{err.elementId.substring(0, 8)}...</code>: {err.error}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Footer */}
      <footer className="footer">
        <p className="hint">
          Tip: Elements will appear at your current viewport position when "Center elements" is enabled.
        </p>
      </footer>
    </div>
  );
};

// Mount the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
