# Credit-Aware Throttling — Archived Implementation

This throttling approach was designed to proactively stay within Miro's credit budget
without needing to hit the rate limit and retry. It was removed in favour of the simpler
batch+delay approach because the per-call delays (~375ms for images) were slower than
what the app can get away with in practice.

Keep this code for reference if rate-limit retries become frequent in production.

---

## Miro Credit Budget Reference

| Operation | Credits |
|---|---|
| `createText`, `createShape`, `createFrame`, `createTable` | 50 (Level 1) |
| `createImage` | 500 (Level 3) |
| Budget | 100,000 credits/minute |

At 80% utilisation (80,000/min):
- Images: ~375ms gap → ~160/min
- Text/shapes: ~37ms gap → ~1,600/min

---

## Implementation (drop into `element-creator.ts`, after `createWithRetry`)

```typescript
// ---------------------------------------------------------------------------
// Credit-aware throttling
// ---------------------------------------------------------------------------

/** Miro Web SDK credit costs per operation type. */
const CREDIT_COSTS: Record<string, number> = {
  text:        50,
  sticky_note: 50,
  shape:       50,
  frame:       50,
  table:       50,
  image:       500,
  item_card:   500,
};

/**
 * Target 80% of the 100,000 credits/minute budget to leave headroom for
 * incidental calls (viewport reads, metadata, etc.).
 * 80,000 credits/min ÷ 60,000 ms/min ≈ 1.333 credits/ms
 */
const EFFECTIVE_CREDITS_PER_MS = (100_000 * 0.8) / 60_000;

/** Throttle state — resets on each page load. */
let _lastOpTimestamp = 0;
let _lastOpCreditCost = 0;

/**
 * Wait until enough time has elapsed since the last SDK call so that
 * cumulative credit spend stays at or below 80% of Miro's budget.
 *
 * Pacing is derived from the *previous* call's cost, not a running total.
 * This avoids needing to predict Miro's internal credit state (which would
 * be invalidated by concurrent imports or other in-app SDK calls).
 */
async function throttleForCredits(creditCost: number): Promise<void> {
  if (_lastOpTimestamp > 0) {
    const minGapMs = _lastOpCreditCost / EFFECTIVE_CREDITS_PER_MS;
    const elapsed = Date.now() - _lastOpTimestamp;
    const remainingMs = minGapMs - elapsed;
    if (remainingMs > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, remainingMs));
    }
  }
  _lastOpTimestamp = Date.now();
  _lastOpCreditCost = creditCost;
}
```

## Usage in `createMiroElement`

Add at the top of the function body, before `const width = ...`:

```typescript
// Throttle to stay within Miro's credit budget BEFORE making any SDK call.
await throttleForCredits(CREDIT_COSTS[element.type] ?? 50);
```

## Usage in import loops

Replace the batch+delay loops with a flat sequential loop — the throttle handles pacing:

```typescript
for (let i = 0; i < nonFrames.length; i++) {
  const element = nonFrames[i];
  if (onProgress) onProgress(progressIndex + i + 1, elements.length);
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
```
