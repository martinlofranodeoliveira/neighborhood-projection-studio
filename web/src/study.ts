export type Locale = 'pt-BR' | 'en';

export type StudyErrorCode =
  | 'FILE_TOO_LARGE'
  | 'INVALID_JSON'
  | 'INVALID_STUDY'
  | 'DIGEST_MISMATCH'
  | 'CRYPTO_UNAVAILABLE'
  | 'INPUT_IO';

export class StudyError extends Error {
  readonly code: StudyErrorCode;

  constructor(code: StudyErrorCode, message: string) {
    super(message);
    this.name = 'StudyError';
    this.code = code;
    Object.setPrototypeOf(this, StudyError.prototype);
  }
}

export type PcaFlag =
  | 'CUTOFF_NEAR_TIE'
  | 'RETAINED_AXES_NEAR_TIE'
  | 'RANK_BELOW_3_POLICY';

export type SignalState = 'NONCONSTANT_INPUT' | 'CONSTANT_INPUT';
export type NeighborhoodState = 'AVAILABLE' | 'UNAVAILABLE_CONSTANT_INPUT';
export type RelationCategory = 'RETAINED' | 'LOST' | 'INTRODUCED';

export interface Fraction {
  readonly numerator: number;
  readonly denominator: number;
}

export interface Relation {
  readonly id: string;
  readonly input_rank: number;
  readonly projected_rank: number;
  readonly category: RelationCategory;
  readonly penalty: number;
  readonly input_distance: number;
  readonly projected_distance: number;
}

export interface RowReceipt {
  readonly id: string;
  readonly input_neighbors: readonly string[];
  readonly projected_neighbors: readonly string[];
  readonly retained_count: number;
  readonly penalty: number;
  readonly relations: readonly Relation[];
}

export interface FitReceiptVersions {
  readonly python: string;
  readonly numpy: string;
  readonly scipy: string;
  readonly 'scikit-learn': string;
  readonly threadpoolctl: string;
}

export interface FitReceiptParams {
  readonly n_components: null;
  readonly svd_solver: 'full';
  readonly whiten: false;
  readonly copy: true;
}

export interface FitReceipt {
  readonly estimator: 'sklearn.decomposition.PCA';
  readonly params: FitReceiptParams;
  readonly versions: FitReceiptVersions;
  readonly native_threads: 1;
}

export interface StudyProducer {
  readonly package: 'neighborhood-projection-studio';
  readonly version: '0.1.0';
}

export interface StudyInput {
  readonly row_ids: readonly string[];
  readonly feature_names: readonly string[];
  readonly values: readonly (readonly number[])[];
  readonly digest_sha256: string;
  readonly canonical_order: 'ASCII_ID';
  readonly unit_policy: 'UNSCALED_INPUT';
}

export interface StudyPlan {
  readonly k: number;
}

export interface StudyPca {
  readonly scores3: readonly (readonly [number, number, number])[];
  readonly mean: readonly number[];
  readonly components3: readonly [
    readonly number[],
    readonly number[],
    readonly number[],
  ];
  readonly singular_values: readonly number[];
  readonly tau: number;
  readonly rank_screen_count: number;
  readonly gap12: number;
  readonly gap23: number;
  readonly gap34: number;
  readonly flags: readonly PcaFlag[];
  readonly signal_state: SignalState;
  readonly retained_variance_fraction: number | null;
  readonly fit_receipt: FitReceipt;
}

export interface StudyNeighborhood {
  readonly state: NeighborhoodState;
  readonly k: number;
  readonly trustworthiness_fraction: Fraction | null;
  readonly retention_fraction: Fraction | null;
  readonly total_penalty: number | null;
  readonly total_retained: number | null;
  readonly receipts: readonly RowReceipt[];
}

export interface StudyWork {
  readonly planned_distance_entries: number;
  readonly planned_neighbor_slots: number;
  readonly actual_distance_entries: number;
  readonly fit_count: 1;
}

export interface Study {
  readonly schema: 'neighborhood-projection-study/1';
  readonly producer: StudyProducer;
  readonly input: StudyInput;
  readonly plan: StudyPlan;
  readonly pca: StudyPca;
  readonly neighborhood: StudyNeighborhood;
  readonly work: StudyWork;
}

export interface ImportLease {
  begin(): number;
  owns(token: number): boolean;
  revoke(): void;
}

export const MAX_STUDY_BYTES = 16777216;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,31}$/;
const DIGEST_HEX_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_ASCII_PATTERN = /^[\x20-\x7E]{1,64}$/;
const MAX_INPUT_ABS = 1000000;

function failStudy(message: string): never {
  throw new StudyError('INVALID_STUDY', message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertExactKeys(
  obj: Record<string, unknown>,
  expectedKeys: readonly string[],
  context: string,
): void {
  const actualKeys = Object.keys(obj);
  if (actualKeys.length !== expectedKeys.length) {
    failStudy(`Unexpected key count in ${context}.`);
  }
  for (let i = 0; i < expectedKeys.length; i++) {
    const key = expectedKeys[i]!;
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      failStudy(`Missing required key ${key} in ${context}.`);
    }
  }
}

function isStrictSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isFiniteFloat(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function canonicalZero(value: number): number {
  return value === 0 ? 0 : value;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function validateReducedFraction(
  value: unknown,
  expectedNumerator: number,
  expectedDenominator: number,
  context: string,
): Fraction {
  if (!isPlainObject(value)) {
    failStudy(`${context} must be a fraction object.`);
  }
  assertExactKeys(value, ['numerator', 'denominator'], context);
  const num = value.numerator;
  const den = value.denominator;
  if (!isStrictSafeInteger(num) || !isStrictSafeInteger(den)) {
    failStudy(`${context} numerator and denominator must be safe integers.`);
  }
  if (den <= 0 || num < 0 || num > den) {
    failStudy(`${context} fraction out of bounds.`);
  }
  if (gcd(num, den) !== 1) {
    failStudy(`${context} fraction is not reduced.`);
  }
  if (expectedDenominator <= 0 || expectedNumerator < 0 || expectedNumerator > expectedDenominator) {
    failStudy(`${context} expected fraction out of bounds.`);
  }
  const divisor = gcd(expectedNumerator, expectedDenominator);
  const reducedExpectedNum = expectedNumerator / divisor;
  const reducedExpectedDen = expectedDenominator / divisor;
  if (num !== reducedExpectedNum || den !== reducedExpectedDen) {
    failStudy(`${context} does not match aggregate value.`);
  }
  return Object.freeze({
    numerator: num,
    denominator: den,
  });
}

export function validateStudy(value: unknown): Study {
  if (!isPlainObject(value)) {
    failStudy('Root value must be a plain object.');
  }
  assertExactKeys(
    value,
    ['schema', 'producer', 'input', 'plan', 'pca', 'neighborhood', 'work'],
    'root',
  );

  if (value.schema !== 'neighborhood-projection-study/1') {
    failStudy('Unsupported study schema.');
  }

  if (!isPlainObject(value.producer)) {
    failStudy('producer must be an object.');
  }
  assertExactKeys(value.producer, ['package', 'version'], 'producer');
  if (
    value.producer.package !== 'neighborhood-projection-studio' ||
    value.producer.version !== '0.1.0'
  ) {
    failStudy('Invalid producer metadata.');
  }
  const producer: StudyProducer = Object.freeze({
    package: 'neighborhood-projection-studio',
    version: '0.1.0',
  });

  if (!isPlainObject(value.input)) {
    failStudy('input must be an object.');
  }
  assertExactKeys(
    value.input,
    ['row_ids', 'feature_names', 'values', 'digest_sha256', 'canonical_order', 'unit_policy'],
    'input',
  );

  if (value.input.canonical_order !== 'ASCII_ID') {
    failStudy('input.canonical_order must be ASCII_ID.');
  }
  if (value.input.unit_policy !== 'UNSCALED_INPUT') {
    failStudy('input.unit_policy must be UNSCALED_INPUT.');
  }
  if (
    typeof value.input.digest_sha256 !== 'string' ||
    !DIGEST_HEX_PATTERN.test(value.input.digest_sha256)
  ) {
    failStudy('input.digest_sha256 must be 64 lowercase hex characters.');
  }

  const rawRowIds = value.input.row_ids;
  const rawFeatureNames = value.input.feature_names;
  const rawValues = value.input.values;

  if (!Array.isArray(rawRowIds) || rawRowIds.length < 8 || rawRowIds.length > 4096) {
    failStudy('input.row_ids length n must be in 8..4096.');
  }
  if (!Array.isArray(rawFeatureNames) || rawFeatureNames.length < 4 || rawFeatureNames.length > 16) {
    failStudy('input.feature_names length d must be in 4..16.');
  }

  const n = rawRowIds.length;
  const d = rawFeatureNames.length;

  const rowIds: string[] = new Array<string>(n);
  const rowIdToIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const id = rawRowIds[i];
    if (typeof id !== 'string' || !IDENTIFIER_PATTERN.test(id)) {
      failStudy(`Invalid row_id at index ${i}.`);
    }
    if (i > 0 && !(rowIds[i - 1]! < id)) {
      failStudy('input.row_ids must be strictly sorted in ASCII order without duplicates.');
    }
    rowIds[i] = id;
    rowIdToIndex.set(id, i);
  }
  if (rowIdToIndex.size !== n) {
    failStudy('input.row_ids must be unique.');
  }

  const featureNames: string[] = new Array<string>(d);
  const featureSet = new Set<string>();
  for (let j = 0; j < d; j++) {
    const fname = rawFeatureNames[j];
    if (typeof fname !== 'string' || !IDENTIFIER_PATTERN.test(fname)) {
      failStudy(`Invalid feature_name at index ${j}.`);
    }
    if (featureSet.has(fname)) {
      failStudy('input.feature_names must be unique.');
    }
    featureSet.add(fname);
    featureNames[j] = fname;
  }

  if (!Array.isArray(rawValues) || rawValues.length !== n) {
    failStudy('input.values must have length n.');
  }
  const values: (readonly number[])[] = new Array<readonly number[]>(n);
  let isConstantInput = true;
  for (let i = 0; i < n; i++) {
    const rawRow = rawValues[i];
    if (!Array.isArray(rawRow) || rawRow.length !== d) {
      failStudy(`input.values[${i}] must have length d.`);
    }
    const cleanRow = new Array<number>(d);
    for (let j = 0; j < d; j++) {
      const cell = rawRow[j];
      if (!isFiniteFloat(cell) || Math.abs(cell) > MAX_INPUT_ABS) {
        failStudy(`input.values[${i}][${j}] must be finite with |x| <= 1000000.`);
      }
      const normalized = canonicalZero(cell);
      cleanRow[j] = normalized;
      if (i > 0 && normalized !== values[0]![j]) {
        isConstantInput = false;
      }
    }
    values[i] = Object.freeze(cleanRow);
  }

  const input: StudyInput = Object.freeze({
    row_ids: Object.freeze(rowIds),
    feature_names: Object.freeze(featureNames),
    values: Object.freeze(values),
    digest_sha256: value.input.digest_sha256,
    canonical_order: 'ASCII_ID',
    unit_policy: 'UNSCALED_INPUT',
  });

  if (!isPlainObject(value.plan)) {
    failStudy('plan must be an object.');
  }
  assertExactKeys(value.plan, ['k'], 'plan');
  const k = value.plan.k;
  const maxK = Math.min(16, Math.floor((n - 1) / 2));
  if (!isStrictSafeInteger(k) || k < 1 || k > maxK) {
    failStudy('plan.k out of allowed integer bounds.');
  }
  const plan: StudyPlan = Object.freeze({ k });

  if (!isPlainObject(value.pca)) {
    failStudy('pca must be an object.');
  }
  assertExactKeys(
    value.pca,
    [
      'scores3',
      'mean',
      'components3',
      'singular_values',
      'tau',
      'rank_screen_count',
      'gap12',
      'gap23',
      'gap34',
      'flags',
      'signal_state',
      'retained_variance_fraction',
      'fit_receipt',
    ],
    'pca',
  );

  const rawScores3 = value.pca.scores3;
  if (!Array.isArray(rawScores3) || rawScores3.length !== n) {
    failStudy('pca.scores3 must have length n.');
  }
  const scores3: (readonly [number, number, number])[] = new Array<
    readonly [number, number, number]
  >(n);
  for (let i = 0; i < n; i++) {
    const row = rawScores3[i];
    if (!Array.isArray(row) || row.length !== 3) {
      failStudy(`pca.scores3[${i}] must have length 3.`);
    }
    const c0 = row[0];
    const c1 = row[1];
    const c2 = row[2];
    if (!isFiniteFloat(c0) || !isFiniteFloat(c1) || !isFiniteFloat(c2)) {
      failStudy(`pca.scores3[${i}] coordinates must be finite numbers.`);
    }
    scores3[i] = Object.freeze([
      canonicalZero(c0),
      canonicalZero(c1),
      canonicalZero(c2),
    ]);
  }

  const rawMean = value.pca.mean;
  if (!Array.isArray(rawMean) || rawMean.length !== d) {
    failStudy('pca.mean must have length d.');
  }
  const mean = new Array<number>(d);
  for (let j = 0; j < d; j++) {
    const m = rawMean[j];
    if (!isFiniteFloat(m)) {
      failStudy(`pca.mean[${j}] must be finite.`);
    }
    mean[j] = canonicalZero(m);
  }

  const rawComponents3 = value.pca.components3;
  if (!Array.isArray(rawComponents3) || rawComponents3.length !== 3) {
    failStudy('pca.components3 must have 3 rows.');
  }
  const compRows: (readonly number[])[] = new Array<readonly number[]>(3);
  for (let c = 0; c < 3; c++) {
    const crow = rawComponents3[c];
    if (!Array.isArray(crow) || crow.length !== d) {
      failStudy(`pca.components3[${c}] must have length d.`);
    }
    const cleanComp = new Array<number>(d);
    for (let j = 0; j < d; j++) {
      const coeff = crow[j];
      if (!isFiniteFloat(coeff)) {
        failStudy(`pca.components3[${c}][${j}] must be finite.`);
      }
      cleanComp[j] = canonicalZero(coeff);
    }
    compRows[c] = Object.freeze(cleanComp);
  }
  const components3: readonly [
    readonly number[],
    readonly number[],
    readonly number[],
  ] = Object.freeze([compRows[0]!, compRows[1]!, compRows[2]!]);

  const svLen = Math.min(n, d);
  const rawSv = value.pca.singular_values;
  if (!Array.isArray(rawSv) || rawSv.length !== svLen) {
    failStudy('pca.singular_values must have length min(n, d).');
  }
  const singularValues = new Array<number>(svLen);
  for (let i = 0; i < svLen; i++) {
    const sv = rawSv[i];
    if (!isFiniteFloat(sv) || sv < 0) {
      failStudy(`pca.singular_values[${i}] must be finite and nonnegative.`);
    }
    const cleanSv = canonicalZero(sv);
    if (i > 0 && singularValues[i - 1]! < cleanSv) {
      failStudy('pca.singular_values must be descending.');
    }
    singularValues[i] = cleanSv;
  }

  const s0 = singularValues[0]!;
  const s1 = singularValues[1]!;
  const s2 = singularValues[2]!;
  const s3 = singularValues[3]!;

  const expectedTau = canonicalZero(64 * Number.EPSILON * Math.max(n, d) * s0);
  const expectedGap12 = canonicalZero(s0 - s1);
  const expectedGap23 = canonicalZero(s1 - s2);
  const expectedGap34 = canonicalZero(s2 - s3);

  if (!isFiniteFloat(value.pca.tau) || canonicalZero(value.pca.tau) !== expectedTau) {
    failStudy('pca.tau does not match deterministic contract formula.');
  }
  if (!isFiniteFloat(value.pca.gap12) || canonicalZero(value.pca.gap12) !== expectedGap12) {
    failStudy('pca.gap12 does not match s0 - s1.');
  }
  if (!isFiniteFloat(value.pca.gap23) || canonicalZero(value.pca.gap23) !== expectedGap23) {
    failStudy('pca.gap23 does not match s1 - s2.');
  }
  if (!isFiniteFloat(value.pca.gap34) || canonicalZero(value.pca.gap34) !== expectedGap34) {
    failStudy('pca.gap34 does not match s2 - s3.');
  }

  let expectedRankScreenCount = 0;
  for (let i = 0; i < svLen; i++) {
    if (singularValues[i]! > expectedTau) {
      expectedRankScreenCount += 1;
    }
  }
  if (
    !isStrictSafeInteger(value.pca.rank_screen_count) ||
    value.pca.rank_screen_count !== expectedRankScreenCount
  ) {
    failStudy('pca.rank_screen_count does not match count(s > tau).');
  }

  const expectedFlags: PcaFlag[] = [];
  if (expectedGap34 <= expectedTau) {
    expectedFlags.push('CUTOFF_NEAR_TIE');
  }
  if (expectedGap12 <= expectedTau || expectedGap23 <= expectedTau) {
    expectedFlags.push('RETAINED_AXES_NEAR_TIE');
  }
  if (expectedRankScreenCount < 3) {
    expectedFlags.push('RANK_BELOW_3_POLICY');
  }

  const rawFlags = value.pca.flags;
  if (!Array.isArray(rawFlags) || rawFlags.length !== expectedFlags.length) {
    failStudy('pca.flags does not match expected policy flags.');
  }
  for (let i = 0; i < expectedFlags.length; i++) {
    if (rawFlags[i] !== expectedFlags[i]) {
      failStudy('pca.flags order or membership mismatch.');
    }
  }

  const expectedSignalState: SignalState = isConstantInput
    ? 'CONSTANT_INPUT'
    : 'NONCONSTANT_INPUT';
  if (value.pca.signal_state !== expectedSignalState) {
    failStudy('pca.signal_state does not match input constancy.');
  }

  let retainedVarianceFraction: number | null = null;
  if (isConstantInput) {
    if (value.pca.retained_variance_fraction !== null) {
      failStudy('pca.retained_variance_fraction must be null for CONSTANT_INPUT.');
    }
  } else {
    const rvf = value.pca.retained_variance_fraction;
    if (!isFiniteFloat(rvf) || rvf < 0 || rvf > 1) {
      failStudy('pca.retained_variance_fraction must be finite in [0, 1].');
    }
    retainedVarianceFraction = canonicalZero(rvf);
  }

  if (!isPlainObject(value.pca.fit_receipt)) {
    failStudy('pca.fit_receipt must be an object.');
  }
  assertExactKeys(
    value.pca.fit_receipt,
    ['estimator', 'params', 'versions', 'native_threads'],
    'pca.fit_receipt',
  );
  if (value.pca.fit_receipt.estimator !== 'sklearn.decomposition.PCA') {
    failStudy('Invalid pca.fit_receipt.estimator.');
  }
  if (
    !isStrictSafeInteger(value.pca.fit_receipt.native_threads) ||
    value.pca.fit_receipt.native_threads !== 1
  ) {
    failStudy('pca.fit_receipt.native_threads must be 1.');
  }

  const rawParams = value.pca.fit_receipt.params;
  if (!isPlainObject(rawParams)) {
    failStudy('pca.fit_receipt.params must be an object.');
  }
  assertExactKeys(
    rawParams,
    ['n_components', 'svd_solver', 'whiten', 'copy'],
    'pca.fit_receipt.params',
  );
  if (
    rawParams.n_components !== null ||
    rawParams.svd_solver !== 'full' ||
    rawParams.whiten !== false ||
    rawParams.copy !== true
  ) {
    failStudy('Invalid pca.fit_receipt.params values.');
  }

  const rawVersions = value.pca.fit_receipt.versions;
  if (!isPlainObject(rawVersions)) {
    failStudy('pca.fit_receipt.versions must be an object.');
  }
  const versionKeys = ['python', 'numpy', 'scipy', 'scikit-learn', 'threadpoolctl'] as const;
  assertExactKeys(rawVersions, versionKeys, 'pca.fit_receipt.versions');
  for (let i = 0; i < versionKeys.length; i++) {
    const vKey = versionKeys[i]!;
    const vVal = rawVersions[vKey];
    if (typeof vVal !== 'string' || !VERSION_ASCII_PATTERN.test(vVal)) {
      failStudy(`Invalid version string for ${vKey}.`);
    }
  }

  const fitReceipt: FitReceipt = Object.freeze({
    estimator: 'sklearn.decomposition.PCA',
    params: Object.freeze({
      n_components: null,
      svd_solver: 'full',
      whiten: false,
      copy: true,
    }),
    versions: Object.freeze({
      python: rawVersions.python as string,
      numpy: rawVersions.numpy as string,
      scipy: rawVersions.scipy as string,
      'scikit-learn': rawVersions['scikit-learn'] as string,
      threadpoolctl: rawVersions.threadpoolctl as string,
    }),
    native_threads: 1,
  });

  const pca: StudyPca = Object.freeze({
    scores3: Object.freeze(scores3),
    mean: Object.freeze(mean),
    components3,
    singular_values: Object.freeze(singularValues),
    tau: expectedTau,
    rank_screen_count: expectedRankScreenCount,
    gap12: expectedGap12,
    gap23: expectedGap23,
    gap34: expectedGap34,
    flags: Object.freeze(expectedFlags),
    signal_state: expectedSignalState,
    retained_variance_fraction: retainedVarianceFraction,
    fit_receipt: fitReceipt,
  });

  if (!isPlainObject(value.neighborhood)) {
    failStudy('neighborhood must be an object.');
  }
  assertExactKeys(
    value.neighborhood,
    [
      'state',
      'k',
      'trustworthiness_fraction',
      'retention_fraction',
      'total_penalty',
      'total_retained',
      'receipts',
    ],
    'neighborhood',
  );

  if (!isStrictSafeInteger(value.neighborhood.k) || value.neighborhood.k !== k) {
    failStudy('neighborhood.k must equal plan.k.');
  }

  const rawReceipts = value.neighborhood.receipts;
  if (!Array.isArray(rawReceipts)) {
    failStudy('neighborhood.receipts must be an array.');
  }

  let neighborhood: StudyNeighborhood;
  if (isConstantInput) {
    if (value.neighborhood.state !== 'UNAVAILABLE_CONSTANT_INPUT') {
      failStudy('Constant input requires UNAVAILABLE_CONSTANT_INPUT neighborhood state.');
    }
    if (
      value.neighborhood.trustworthiness_fraction !== null ||
      value.neighborhood.retention_fraction !== null ||
      value.neighborhood.total_penalty !== null ||
      value.neighborhood.total_retained !== null ||
      rawReceipts.length !== 0
    ) {
      failStudy('Constant input requires null neighborhood aggregates and empty receipts.');
    }
    neighborhood = Object.freeze({
      state: 'UNAVAILABLE_CONSTANT_INPUT',
      k,
      trustworthiness_fraction: null,
      retention_fraction: null,
      total_penalty: null,
      total_retained: null,
      receipts: Object.freeze([]),
    });
  } else {
    if (value.neighborhood.state !== 'AVAILABLE') {
      failStudy('Nonconstant input requires AVAILABLE neighborhood state.');
    }
    if (rawReceipts.length !== n) {
      failStudy('neighborhood.receipts must have length n.');
    }

    const receipts: RowReceipt[] = new Array<RowReceipt>(n);
    let sumRetained = 0;
    let sumPenalty = 0;

    for (let i = 0; i < n; i++) {
      const rawRec = rawReceipts[i];
      if (!isPlainObject(rawRec)) {
        failStudy(`Receipt at index ${i} must be an object.`);
      }
      assertExactKeys(
        rawRec,
        ['id', 'input_neighbors', 'projected_neighbors', 'retained_count', 'penalty', 'relations'],
        `neighborhood.receipts[${i}]`,
      );

      const selfId = rowIds[i]!;
      if (rawRec.id !== selfId) {
        failStudy(`Receipt ID at index ${i} does not match canonical row_id.`);
      }

      const rawInNeighbors = rawRec.input_neighbors;
      const rawProjNeighbors = rawRec.projected_neighbors;
      if (!Array.isArray(rawInNeighbors) || rawInNeighbors.length !== k) {
        failStudy(`Receipt ${selfId} input_neighbors must have length k.`);
      }
      if (!Array.isArray(rawProjNeighbors) || rawProjNeighbors.length !== k) {
        failStudy(`Receipt ${selfId} projected_neighbors must have length k.`);
      }

      const inNeighbors: string[] = new Array<string>(k);
      const inRankByNeighbor = new Map<string, number>();
      for (let m = 0; m < k; m++) {
        const nid = rawInNeighbors[m];
        if (
          typeof nid !== 'string' ||
          nid === selfId ||
          !rowIdToIndex.has(nid) ||
          inRankByNeighbor.has(nid)
        ) {
          failStudy(`Invalid input_neighbor in receipt ${selfId}.`);
        }
        inNeighbors[m] = nid;
        inRankByNeighbor.set(nid, m + 1);
      }

      const projNeighbors: string[] = new Array<string>(k);
      const projRankByNeighbor = new Map<string, number>();
      let intersectionCount = 0;
      for (let m = 0; m < k; m++) {
        const nid = rawProjNeighbors[m];
        if (
          typeof nid !== 'string' ||
          nid === selfId ||
          !rowIdToIndex.has(nid) ||
          projRankByNeighbor.has(nid)
        ) {
          failStudy(`Invalid projected_neighbor in receipt ${selfId}.`);
        }
        projNeighbors[m] = nid;
        projRankByNeighbor.set(nid, m + 1);
        if (inRankByNeighbor.has(nid)) {
          intersectionCount += 1;
        }
      }

      if (
        !isStrictSafeInteger(rawRec.retained_count) ||
        rawRec.retained_count !== intersectionCount
      ) {
        failStudy(`Receipt ${selfId} retained_count does not match neighbor intersection.`);
      }

      const expectedUnionSize = 2 * k - intersectionCount;
      const rawRelations = rawRec.relations;
      if (!Array.isArray(rawRelations) || rawRelations.length !== expectedUnionSize) {
        failStudy(`Receipt ${selfId} relations count does not match neighbor union size.`);
      }

      const relations: Relation[] = new Array<Relation>(expectedUnionSize);
      const seenInputRanks = new Set<number>();
      const seenProjectedRanks = new Set<number>();
      let receiptPenaltySum = 0;

      for (let rIdx = 0; rIdx < expectedUnionSize; rIdx++) {
        const rawRel = rawRelations[rIdx];
        if (!isPlainObject(rawRel)) {
          failStudy(`Relation ${rIdx} in receipt ${selfId} must be an object.`);
        }
        assertExactKeys(
          rawRel,
          [
            'id',
            'input_rank',
            'projected_rank',
            'category',
            'penalty',
            'input_distance',
            'projected_distance',
          ],
          `receipts[${i}].relations[${rIdx}]`,
        );

        const relId = rawRel.id;
        if (
          typeof relId !== 'string' ||
          relId === selfId ||
          !rowIdToIndex.has(relId) ||
          (!inRankByNeighbor.has(relId) && !projRankByNeighbor.has(relId))
        ) {
          failStudy(`Invalid relation id in receipt ${selfId}.`);
        }
        if (rIdx > 0 && !(relations[rIdx - 1]!.id < relId)) {
          failStudy(`Relations in receipt ${selfId} must be strictly sorted in ASCII order.`);
        }

        const inRank = rawRel.input_rank;
        const projRank = rawRel.projected_rank;
        if (
          !isStrictSafeInteger(inRank) ||
          inRank < 1 ||
          inRank > n - 1 ||
          seenInputRanks.has(inRank)
        ) {
          failStudy(`Invalid or duplicate input_rank in receipt ${selfId}.`);
        }
        if (
          !isStrictSafeInteger(projRank) ||
          projRank < 1 ||
          projRank > n - 1 ||
          seenProjectedRanks.has(projRank)
        ) {
          failStudy(`Invalid or duplicate projected_rank in receipt ${selfId}.`);
        }
        seenInputRanks.add(inRank);
        seenProjectedRanks.add(projRank);

        const expectedInRank = inRankByNeighbor.get(relId);
        if (expectedInRank !== undefined) {
          if (inRank !== expectedInRank) {
            failStudy(`input_rank mismatch with input_neighbors order in receipt ${selfId}.`);
          }
        } else if (inRank <= k) {
          failStudy(`Relation ${relId} has input_rank <= k but is absent from input_neighbors.`);
        }

        const expectedProjRank = projRankByNeighbor.get(relId);
        if (expectedProjRank !== undefined) {
          if (projRank !== expectedProjRank) {
            failStudy(`projected_rank mismatch with projected_neighbors order in receipt ${selfId}.`);
          }
        } else if (projRank <= k) {
          failStudy(
            `Relation ${relId} has projected_rank <= k but is absent from projected_neighbors.`,
          );
        }

        let expectedCategory: RelationCategory;
        let expectedPenalty: number;
        if (inRank <= k && projRank <= k) {
          expectedCategory = 'RETAINED';
          expectedPenalty = 0;
        } else if (inRank <= k && projRank > k) {
          expectedCategory = 'LOST';
          expectedPenalty = 0;
        } else {
          expectedCategory = 'INTRODUCED';
          expectedPenalty = inRank - k;
        }

        if (rawRel.category !== expectedCategory) {
          failStudy(`Category mismatch in receipt ${selfId} relation ${relId}.`);
        }
        if (!isStrictSafeInteger(rawRel.penalty) || rawRel.penalty !== expectedPenalty) {
          failStudy(`Penalty mismatch in receipt ${selfId} relation ${relId}.`);
        }

        const inDist = rawRel.input_distance;
        const projDist = rawRel.projected_distance;
        if (!isFiniteFloat(inDist) || inDist < 0 || !isFiniteFloat(projDist) || projDist < 0) {
          failStudy(`Invalid relation distance in receipt ${selfId}.`);
        }

        receiptPenaltySum += expectedPenalty;
        relations[rIdx] = Object.freeze({
          id: relId,
          input_rank: inRank,
          projected_rank: projRank,
          category: expectedCategory,
          penalty: expectedPenalty,
          input_distance: canonicalZero(inDist),
          projected_distance: canonicalZero(projDist),
        });
      }

      for (let aIdx = 0; aIdx < expectedUnionSize; aIdx++) {
        const relA = relations[aIdx]!;
        for (let bIdx = aIdx + 1; bIdx < expectedUnionSize; bIdx++) {
          const relB = relations[bIdx]!;
          if (relA.input_rank < relB.input_rank) {
            if (
              relA.input_distance > relB.input_distance ||
              (relA.input_distance === relB.input_distance && !(relA.id < relB.id))
            ) {
              failStudy(`Input distance/tie order violation in receipt ${selfId}.`);
            }
          } else {
            if (
              relB.input_distance > relA.input_distance ||
              (relB.input_distance === relA.input_distance && !(relB.id < relA.id))
            ) {
              failStudy(`Input distance/tie order violation in receipt ${selfId}.`);
            }
          }
          if (relA.projected_rank < relB.projected_rank) {
            if (
              relA.projected_distance > relB.projected_distance ||
              (relA.projected_distance === relB.projected_distance && !(relA.id < relB.id))
            ) {
              failStudy(`Projected distance/tie order violation in receipt ${selfId}.`);
            }
          } else {
            if (
              relB.projected_distance > relA.projected_distance ||
              (relB.projected_distance === relA.projected_distance && !(relB.id < relA.id))
            ) {
              failStudy(`Projected distance/tie order violation in receipt ${selfId}.`);
            }
          }
        }
      }

      if (!isStrictSafeInteger(rawRec.penalty) || rawRec.penalty !== receiptPenaltySum) {
        failStudy(`Receipt ${selfId} penalty does not equal sum of relation penalties.`);
      }

      sumRetained += intersectionCount;
      sumPenalty += receiptPenaltySum;

      receipts[i] = Object.freeze({
        id: selfId,
        input_neighbors: Object.freeze(inNeighbors),
        projected_neighbors: Object.freeze(projNeighbors),
        retained_count: intersectionCount,
        penalty: receiptPenaltySum,
        relations: Object.freeze(relations),
      });
    }

    if (
      !isStrictSafeInteger(value.neighborhood.total_retained) ||
      value.neighborhood.total_retained !== sumRetained
    ) {
      failStudy('neighborhood.total_retained does not equal sum of receipt retained_count.');
    }
    if (
      !isStrictSafeInteger(value.neighborhood.total_penalty) ||
      value.neighborhood.total_penalty !== sumPenalty
    ) {
      failStudy('neighborhood.total_penalty does not equal sum of receipt penalties.');
    }

    const denomD = n * k * (2 * n - 3 * k - 1);
    const trustNumerator = denomD - 2 * sumPenalty;
    const trustworthinessFraction = validateReducedFraction(
      value.neighborhood.trustworthiness_fraction,
      trustNumerator,
      denomD,
      'neighborhood.trustworthiness_fraction',
    );
    const retentionFraction = validateReducedFraction(
      value.neighborhood.retention_fraction,
      sumRetained,
      n * k,
      'neighborhood.retention_fraction',
    );

    neighborhood = Object.freeze({
      state: 'AVAILABLE',
      k,
      trustworthiness_fraction: trustworthinessFraction,
      retention_fraction: retentionFraction,
      total_penalty: sumPenalty,
      total_retained: sumRetained,
      receipts: Object.freeze(receipts),
    });
  }

  if (!isPlainObject(value.work)) {
    failStudy('work must be an object.');
  }
  assertExactKeys(
    value.work,
    ['planned_distance_entries', 'planned_neighbor_slots', 'actual_distance_entries', 'fit_count'],
    'work',
  );

  const expectedDistanceEntries = 2 * n * n;
  const expectedNeighborSlots = 2 * n * k;
  const expectedActualDistanceEntries = isConstantInput ? 0 : expectedDistanceEntries;

  if (
    !isStrictSafeInteger(value.work.planned_distance_entries) ||
    value.work.planned_distance_entries !== expectedDistanceEntries
  ) {
    failStudy('work.planned_distance_entries must equal 2*n*n.');
  }
  if (
    !isStrictSafeInteger(value.work.planned_neighbor_slots) ||
    value.work.planned_neighbor_slots !== expectedNeighborSlots
  ) {
    failStudy('work.planned_neighbor_slots must equal 2*n*k.');
  }
  if (
    !isStrictSafeInteger(value.work.actual_distance_entries) ||
    value.work.actual_distance_entries !== expectedActualDistanceEntries
  ) {
    failStudy('work.actual_distance_entries invalid for signal_state.');
  }
  if (!isStrictSafeInteger(value.work.fit_count) || value.work.fit_count !== 1) {
    failStudy('work.fit_count must be 1.');
  }

  const work: StudyWork = Object.freeze({
    planned_distance_entries: expectedDistanceEntries,
    planned_neighbor_slots: expectedNeighborSlots,
    actual_distance_entries: expectedActualDistanceEntries,
    fit_count: 1,
  });

  return Object.freeze({
    schema: 'neighborhood-projection-study/1',
    producer,
    input,
    plan,
    pca,
    neighborhood,
    work,
  });
}

export function inputFrame(study: Study): Uint8Array<ArrayBuffer> {
  const { row_ids, feature_names, values } = study.input;
  const n = row_ids.length;
  const d = feature_names.length;

  let totalBytes = 10 + 4 + 2;
  for (let j = 0; j < d; j++) {
    totalBytes += 2 + feature_names[j]!.length;
  }
  for (let i = 0; i < n; i++) {
    totalBytes += 2 + row_ids[i]!.length + d * 8;
  }

  const buffer = new ArrayBuffer(totalBytes);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const header = 'NPSinput1';
  for (let i = 0; i < header.length; i++) {
    bytes[i] = header.charCodeAt(i);
  }
  bytes[9] = 0;

  let offset = 10;
  view.setUint32(offset, n, true);
  offset += 4;
  view.setUint16(offset, d, true);
  offset += 2;

  for (let j = 0; j < d; j++) {
    const fname = feature_names[j]!;
    const len = fname.length;
    view.setUint16(offset, len, true);
    offset += 2;
    for (let c = 0; c < len; c++) {
      bytes[offset + c] = fname.charCodeAt(c);
    }
    offset += len;
  }

  for (let i = 0; i < n; i++) {
    const rid = row_ids[i]!;
    const len = rid.length;
    view.setUint16(offset, len, true);
    offset += 2;
    for (let c = 0; c < len; c++) {
      bytes[offset + c] = rid.charCodeAt(c);
    }
    offset += len;

    const rowVals = values[i]!;
    for (let j = 0; j < d; j++) {
      const val = canonicalZero(rowVals[j]!);
      view.setFloat64(offset, val, true);
      offset += 8;
    }
  }

  return bytes;
}

function resolveSubtleCrypto(cryptoProvider?: Crypto): SubtleCrypto {
  if (cryptoProvider === undefined) {
    const globalScope = globalThis as { isSecureContext?: unknown; crypto?: Crypto };
    if (globalScope.isSecureContext === false) {
      throw new StudyError(
        'CRYPTO_UNAVAILABLE',
        'WebCrypto requires a secure context (HTTPS or localhost).',
      );
    }
  }
  const provider = cryptoProvider !== undefined ? cryptoProvider : globalThis.crypto;
  if (
    !provider ||
    typeof provider !== 'object' ||
    (provider as { isSecureContext?: unknown }).isSecureContext === false ||
    !provider.subtle ||
    typeof provider.subtle.digest !== 'function'
  ) {
    throw new StudyError(
      'CRYPTO_UNAVAILABLE',
      'WebCrypto SHA-256 capability is unavailable in this environment.',
    );
  }
  return provider.subtle;
}

export async function readStudy(text: string, cryptoProvider?: Crypto): Promise<Study> {
  if (typeof text !== 'string') {
    throw new StudyError('INVALID_JSON', 'Input study content must be a UTF-8 string.');
  }
  if (text.length > MAX_STUDY_BYTES) {
    throw new StudyError('FILE_TOO_LARGE', 'Study exceeds 16 MiB byte limit.');
  }
  if (text.length > 4194304) {
    const utf8ByteLength = new TextEncoder().encode(text).byteLength;
    if (utf8ByteLength > MAX_STUDY_BYTES) {
      throw new StudyError('FILE_TOO_LARGE', 'Study exceeds 16 MiB UTF-8 byte limit.');
    }
  }

  const subtle = resolveSubtleCrypto(cryptoProvider);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StudyError('INVALID_JSON', 'Input text is not valid JSON.');
  }

  const study = validateStudy(parsed);
  const frame = inputFrame(study);

  let digestBuffer: ArrayBuffer;
  try {
    digestBuffer = await subtle.digest('SHA-256', frame);
  } catch {
    throw new StudyError(
      'CRYPTO_UNAVAILABLE',
      'WebCrypto SHA-256 execution failed or is unavailable.',
    );
  }

  const digestBytes = new Uint8Array(digestBuffer);
  if (digestBytes.length !== 32) {
    throw new StudyError('CRYPTO_UNAVAILABLE', 'Unexpected SHA-256 digest byte length.');
  }
  let computedHex = '';
  for (let i = 0; i < 32; i++) {
    computedHex += digestBytes[i]!.toString(16).padStart(2, '0');
  }

  if (computedHex !== study.input.digest_sha256) {
    throw new StudyError(
      'DIGEST_MISMATCH',
      'Computed NPSinput1 SHA-256 digest does not match input.digest_sha256.',
    );
  }

  return study;
}

export function createImportLease(): ImportLease {
  let epochCounter = 0;
  let activeToken = 0;

  return Object.freeze({
    begin(): number {
      epochCounter += 1;
      activeToken = epochCounter;
      return activeToken;
    },
    owns(token: number): boolean {
      return Number.isSafeInteger(token) && token > 0 && token === activeToken;
    },
    revoke(): void {
      epochCounter += 1;
      activeToken = 0;
    },
  });
}
