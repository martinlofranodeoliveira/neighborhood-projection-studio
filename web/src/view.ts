import type { Fraction, Relation, RelationCategory, RowReceipt, Study } from './study';

export interface CategoryVisibility {
  readonly retained: boolean;
  readonly lost: boolean;
  readonly introduced: boolean;
}

export interface RelationLineSegment {
  readonly id: string;
  readonly targetIndex: number;
  readonly category: RelationCategory;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly input_rank: number;
  readonly projected_rank: number;
  readonly penalty: number;
}

export interface FeatureValueEntry {
  readonly name: string;
  readonly value: number;
}

export interface SelectedRowSummary {
  readonly id: string;
  readonly rowIndex: number;
  readonly scores3: readonly [number, number, number];
  readonly featureValues: readonly FeatureValueEntry[];
  readonly rawFeatureValues: readonly number[];
  readonly receipt: RowReceipt | null;
  readonly inputNeighbors: readonly Relation[];
  readonly projectedNeighbors: readonly Relation[];
  readonly retainedIds: readonly string[];
  readonly lostIds: readonly string[];
  readonly introducedIds: readonly string[];
  readonly relations: readonly Relation[];
}

export interface AxisRange {
  readonly min: number;
  readonly max: number;
}

export const DEFAULT_DISPLAY_SPAN = 2.0;

export function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildIdIndexMap(rowIds: readonly string[]): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < rowIds.length; i++) {
    map.set(rowIds[i]!, i);
  }
  return map;
}

export function resolveSelectedId(
  study: Study,
  candidateId: string | null | undefined,
): string {
  const rowIds = study.input.row_ids;
  if (rowIds.length === 0) {
    return '';
  }
  if (typeof candidateId === 'string' && candidateId.length > 0) {
    const indexMap = buildIdIndexMap(rowIds);
    if (indexMap.has(candidateId)) {
      return candidateId;
    }
  }
  return rowIds[0]!;
}

export function displayPositions(
  scores: readonly (readonly number[])[],
  displaySpan: number = DEFAULT_DISPLAY_SPAN,
): readonly (readonly [number, number, number])[] {
  const n = scores.length;
  if (n === 0) {
    return Object.freeze([]);
  }

  const span =
    typeof displaySpan === 'number' && Number.isFinite(displaySpan) && displaySpan > 0
      ? displaySpan
      : DEFAULT_DISPLAY_SPAN;

  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const row = scores[i];
    if (!row || row.length < 3) {
      throw new Error(`Invalid score tuple at index ${i}.`);
    }
    for (let axis = 0; axis < 3; axis++) {
      const v = row[axis]!;
      if (!Number.isFinite(v)) {
        throw new Error(`Non-finite score coordinate at [${i}][${axis}].`);
      }
      const absV = Math.abs(v);
      if (absV > maxAbs) {
        maxAbs = absV;
      }
    }
  }

  const createCollapsed = (): readonly (readonly [number, number, number])[] => {
    const zeroTuple: readonly [number, number, number] = Object.freeze([0, 0, 0]);
    const collapsed = new Array<readonly [number, number, number]>(n);
    for (let i = 0; i < n; i++) {
      collapsed[i] = zeroTuple;
    }
    return Object.freeze(collapsed);
  };

  if (maxAbs === 0) {
    return createCollapsed();
  }

  const scaled = new Float64Array(n * 3);
  let min0 = Infinity;
  let max0 = -Infinity;
  let min1 = Infinity;
  let max1 = -Infinity;
  let min2 = Infinity;
  let max2 = -Infinity;

  for (let i = 0; i < n; i++) {
    const row = scores[i]!;
    const s0 = row[0]! / maxAbs;
    const s1 = row[1]! / maxAbs;
    const s2 = row[2]! / maxAbs;
    const base = i * 3;
    scaled[base] = s0;
    scaled[base + 1] = s1;
    scaled[base + 2] = s2;

    if (s0 < min0) min0 = s0;
    if (s0 > max0) max0 = s0;
    if (s1 < min1) min1 = s1;
    if (s1 > max1) max1 = s1;
    if (s2 < min2) min2 = s2;
    if (s2 > max2) max2 = s2;
  }

  const range0 = max0 - min0;
  const range1 = max1 - min1;
  const range2 = max2 - min2;
  const extent = Math.max(range0, range1, range2);

  if (extent === 0 || !Number.isFinite(extent)) {
    return createCollapsed();
  }

  const center0 = range0 === 0 ? min0 : min0 + range0 * 0.5;
  const center1 = range1 === 0 ? min1 : min1 + range1 * 0.5;
  const center2 = range2 === 0 ? min2 : min2 + range2 * 0.5;

  const result = new Array<readonly [number, number, number]>(n);
  for (let i = 0; i < n; i++) {
    const base = i * 3;
    const d0 = range0 === 0 ? 0 : ((scaled[base]! - center0) / extent) * span;
    const d1 = range1 === 0 ? 0 : ((scaled[base + 1]! - center1) / extent) * span;
    const d2 = range2 === 0 ? 0 : ((scaled[base + 2]! - center2) / extent) * span;
    result[i] = Object.freeze([
      d0 === 0 ? 0 : d0,
      d1 === 0 ? 0 : d1,
      d2 === 0 ? 0 : d2,
    ]);
  }

  return Object.freeze(result);
}

export function isCategoryVisible(
  category: RelationCategory,
  visible: CategoryVisibility,
): boolean {
  if (category === 'RETAINED') return visible.retained;
  if (category === 'LOST') return visible.lost;
  return visible.introduced;
}

export function selectedRelations(
  study: Study,
  id: string,
  visible?: CategoryVisibility,
): readonly Relation[] {
  if (study.neighborhood.state !== 'AVAILABLE') {
    return Object.freeze([]);
  }
  const indexMap = buildIdIndexMap(study.input.row_ids);
  const rowIndex = indexMap.get(id);
  if (rowIndex === undefined) {
    return Object.freeze([]);
  }
  const receipt = study.neighborhood.receipts[rowIndex];
  if (!receipt) {
    return Object.freeze([]);
  }
  if (!visible) {
    return receipt.relations;
  }
  const filtered = receipt.relations.filter((rel) =>
    isCategoryVisible(rel.category, visible),
  );
  return Object.freeze(filtered);
}

export function selectedRelationLines(
  study: Study,
  selectedId: string,
  positions: readonly (readonly [number, number, number])[],
  visible: CategoryVisibility,
): readonly RelationLineSegment[] {
  if (study.neighborhood.state !== 'AVAILABLE') {
    return Object.freeze([]);
  }
  const indexMap = buildIdIndexMap(study.input.row_ids);
  const fromIndex = indexMap.get(selectedId);
  if (fromIndex === undefined || fromIndex >= positions.length) {
    return Object.freeze([]);
  }
  const receipt = study.neighborhood.receipts[fromIndex];
  if (!receipt) {
    return Object.freeze([]);
  }

  const fromPos = positions[fromIndex]!;
  const segments: RelationLineSegment[] = [];

  for (let i = 0; i < receipt.relations.length; i++) {
    const rel = receipt.relations[i]!;
    if (!isCategoryVisible(rel.category, visible)) {
      continue;
    }
    const targetIndex = indexMap.get(rel.id);
    if (targetIndex === undefined || targetIndex >= positions.length) {
      continue;
    }
    segments.push(
      Object.freeze({
        id: rel.id,
        targetIndex,
        category: rel.category,
        from: fromPos,
        to: positions[targetIndex]!,
        input_rank: rel.input_rank,
        projected_rank: rel.projected_rank,
        penalty: rel.penalty,
      }),
    );
  }

  return Object.freeze(segments);
}

export function getSelectedRowSummary(
  study: Study,
  selectedId: string,
): SelectedRowSummary | null {
  const indexMap = buildIdIndexMap(study.input.row_ids);
  const rowIndex = indexMap.get(selectedId);
  if (rowIndex === undefined) {
    return null;
  }

  const rawFeatureValues = study.input.values[rowIndex]!;
  const featureNames = study.input.feature_names;
  const featureValues: FeatureValueEntry[] = new Array<FeatureValueEntry>(
    featureNames.length,
  );
  for (let j = 0; j < featureNames.length; j++) {
    featureValues[j] = Object.freeze({
      name: featureNames[j]!,
      value: rawFeatureValues[j]!,
    });
  }

  const scores3 = study.pca.scores3[rowIndex]!;
  if (study.neighborhood.state !== 'AVAILABLE') {
    return Object.freeze({
      id: selectedId,
      rowIndex,
      scores3,
      featureValues: Object.freeze(featureValues),
      rawFeatureValues,
      receipt: null,
      inputNeighbors: Object.freeze([]),
      projectedNeighbors: Object.freeze([]),
      retainedIds: Object.freeze([]),
      lostIds: Object.freeze([]),
      introducedIds: Object.freeze([]),
      relations: Object.freeze([]),
    });
  }

  const receipt = study.neighborhood.receipts[rowIndex]!;
  const relationById = new Map<string, Relation>();
  const retainedIds: string[] = [];
  const lostIds: string[] = [];
  const introducedIds: string[] = [];

  for (let i = 0; i < receipt.relations.length; i++) {
    const rel = receipt.relations[i]!;
    relationById.set(rel.id, rel);
    if (rel.category === 'RETAINED') {
      retainedIds.push(rel.id);
    } else if (rel.category === 'LOST') {
      lostIds.push(rel.id);
    } else {
      introducedIds.push(rel.id);
    }
  }

  const inputNeighbors: Relation[] = [];
  for (let i = 0; i < receipt.input_neighbors.length; i++) {
    const nid = receipt.input_neighbors[i]!;
    const rel = relationById.get(nid);
    if (rel) {
      inputNeighbors.push(rel);
    }
  }

  const projectedNeighbors: Relation[] = [];
  for (let i = 0; i < receipt.projected_neighbors.length; i++) {
    const nid = receipt.projected_neighbors[i]!;
    const rel = relationById.get(nid);
    if (rel) {
      projectedNeighbors.push(rel);
    }
  }

  return Object.freeze({
    id: selectedId,
    rowIndex,
    scores3,
    featureValues: Object.freeze(featureValues),
    rawFeatureValues,
    receipt,
    inputNeighbors: Object.freeze(inputNeighbors),
    projectedNeighbors: Object.freeze(projectedNeighbors),
    retainedIds: Object.freeze(retainedIds),
    lostIds: Object.freeze(lostIds),
    introducedIds: Object.freeze(introducedIds),
    relations: receipt.relations,
  });
}

export function findCoincidentIds(
  study: Study,
  selectedId: string,
  mode: '2d' | '3d',
): readonly string[] {
  const indexMap = buildIdIndexMap(study.input.row_ids);
  const selectedIndex = indexMap.get(selectedId);
  if (selectedIndex === undefined) {
    return Object.freeze([]);
  }
  const targetScore = study.pca.scores3[selectedIndex]!;
  const matches: string[] = [];
  for (let i = 0; i < study.input.row_ids.length; i++) {
    const s = study.pca.scores3[i]!;
    const same2d = s[0] === targetScore[0] && s[1] === targetScore[1];
    const same = mode === '2d' ? same2d : same2d && s[2] === targetScore[2];
    if (same) {
      matches.push(study.input.row_ids[i]!);
    }
  }
  return Object.freeze(matches);
}

export function computeAxisRanges(
  scores: readonly (readonly number[])[],
): readonly [AxisRange, AxisRange, AxisRange] {
  if (scores.length === 0) {
    const zero = Object.freeze({ min: 0, max: 0 });
    return Object.freeze([zero, zero, zero]);
  }
  let min0 = Infinity;
  let max0 = -Infinity;
  let min1 = Infinity;
  let max1 = -Infinity;
  let min2 = Infinity;
  let max2 = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    const r = scores[i]!;
    const c0 = r[0]!;
    const c1 = r[1]!;
    const c2 = r[2]!;
    if (c0 < min0) min0 = c0;
    if (c0 > max0) max0 = c0;
    if (c1 < min1) min1 = c1;
    if (c1 > max1) max1 = c1;
    if (c2 < min2) min2 = c2;
    if (c2 > max2) max2 = c2;
  }
  return Object.freeze([
    Object.freeze({ min: min0, max: max0 }),
    Object.freeze({ min: min1, max: max1 }),
    Object.freeze({ min: min2, max: max2 }),
  ]);
}

export function formatFractionDecimal(fraction: Fraction | null, digits = 4): string {
  if (!fraction || fraction.denominator <= 0) {
    return '—';
  }
  const ratio = fraction.numerator / fraction.denominator;
  return ratio.toFixed(digits);
}

export function formatFractionPercent(fraction: Fraction | null, digits = 1): string {
  if (!fraction || fraction.denominator <= 0) {
    return '—';
  }
  const pct = (fraction.numerator / fraction.denominator) * 100;
  return `${pct.toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const abs = Math.abs(value);
  if (abs === 0) {
    return (0).toFixed(digits);
  }
  if (abs >= 1e6 || abs < 1e-4) {
    return value.toExponential(3);
  }
  return value.toFixed(digits);
}
