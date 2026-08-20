/**
 * Fractional indexing for drag-and-drop ordering.
 *
 * The alternative — storing 0,1,2,... and renumbering on every move — writes
 * the whole list for a single drag and races badly when two tabs reorder at
 * once. Storing a float and inserting the midpoint between neighbours makes a
 * move exactly one UPDATE, touching only the row that moved.
 *
 * The catch is precision: repeatedly halving the same gap exhausts a double's
 * 52 bits of mantissa after roughly fifty insertions in one spot. `needsRebalance`
 * detects that, and callers respond by renumbering the list — rare enough to
 * be worth the trade.
 */

export const POSITION_STEP = 1024;

/** Below this gap, midpoints stop being reliably distinct. */
const MIN_GAP = 0.0001;

export function positionBefore(first: number | undefined): number {
  return first === undefined ? POSITION_STEP : first - POSITION_STEP;
}

export function positionAfter(last: number | undefined): number {
  return last === undefined ? POSITION_STEP : last + POSITION_STEP;
}

/**
 * A position between two neighbours. `before`/`after` are the positions either
 * side of the drop point; either may be undefined at the ends of the list.
 */
export function positionBetween(
  before: number | undefined,
  after: number | undefined,
): number {
  if (before === undefined && after === undefined) return POSITION_STEP;
  if (before === undefined) return positionBefore(after);
  if (after === undefined) return positionAfter(before);
  return (before + after) / 2;
}

/**
 * True when the gap has collapsed far enough that further insertions would
 * start colliding. Callers should renumber via `rebalance` and persist the
 * result.
 */
export function needsRebalance(
  before: number | undefined,
  after: number | undefined,
): boolean {
  if (before === undefined || after === undefined) return false;
  return Math.abs(after - before) < MIN_GAP;
}

/** Evenly spaced positions for a known order — used after a rebalance. */
export function rebalance<T>(items: T[]): { item: T; position: number }[] {
  return items.map((item, index) => ({
    item,
    position: (index + 1) * POSITION_STEP,
  }));
}

/**
 * Resolves a drag to a new position.
 *
 * `orderedPositions` is the list as currently displayed, and `toIndex` is
 * where the item was dropped. The moved item is excluded first so its own
 * position never becomes one of its neighbours — the bug that makes an item
 * dropped one slot down appear not to move at all.
 */
export function computeMovePosition(
  orderedPositions: number[],
  fromIndex: number,
  toIndex: number,
): number {
  const without = orderedPositions.filter((_, i) => i !== fromIndex);
  const clamped = Math.max(0, Math.min(toIndex, without.length));

  return positionBetween(without[clamped - 1], without[clamped]);
}
