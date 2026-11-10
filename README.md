# Neighborhood Projection Studio

A local Python SDK and CLI that fits maintained scikit-learn PCA and explains
which neighbors change when a numeric table is projected into three dimensions.
Per-point receipts identify retained, lost and introduced neighbors; exact
integer fractions summarize rank penalties. It uses synthetic examples and no
runtime API, model download or data upload.

This repository includes the Python SDK/CLI and a React/Three.js inspector.
Python performs the actual PCA fit; the browser reads its exported report.
Native Python/CPU/JSDOM checks and static review do not establish rendered
WebGL, physical pointer behavior, responsive visual finish or accessibility
conformance. The source-derived DESIGN.md retains a recapture requirement.

## Install and run

The qualified stack is Linux x86_64 CPython 3.13.18, NumPy 2.5.4, SciPy 1.18.1,
scikit-learn 1.9.1 and threadpoolctl 3.8.0. Other stacks have not been qualified.
Requirements and wheel hashes are genuine; build uses setuptools 84.2.1/wheel 0.48.0.

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install --only-binary=:all: --require-hashes -r requirements-dev.lock
.venv/bin/python -m pip install --no-build-isolation --no-deps .
.venv/bin/neighborhood-projection-studio --version
.venv/bin/neighborhood-projection-studio demo --assert
.venv/bin/neighborhood-projection-studio analyze --input examples/weighted.input.json --format csv
.venv/bin/python -O -m neighborhood_projection_studio demo --assert
```

Installation acquires pinned packages. Analysis is offline. `demo --assert` calls
real PCA on 64 synthetic rows/8 features and independently checks every row's
ranks and Fraction 115/128 using explicit checks that remain active under `-O`.
This is a descriptive fixture result, not a quality benchmark.

Use `--input -` for bounded binary stdin, read in chunks through EOF; a pending
nonblocking read (None), even after a valid prefix, is INPUT_IO. `--format json|csv` chooses complete
output; `--max-output-bytes N` accepts canonical integers 0..16777216. A zero
chosen-format cap follows input/core processing and then returns budget failure;
`budget.max_report_bytes:0` remains the SDK's earlier preflight. Successful exit0
and complete newline framing are both required; stdout can fail after a prefix.
Errors are fixed JSON on stderr without paths, values or SDK exception text.
If stderr itself fails, its already-failed descriptor is quieted and the original
error exit remains; help/version/stdout delivery failure uses OUTPUT_IO/exit4.

## Python → JSON → React

Create a study report after installing the Python package above:

```sh
.venv/bin/neighborhood-projection-studio analyze --input examples/weighted.input.json --format json > study.json
```

Continue only after exit0; a failed output stream can leave an incomplete file.
In a repository checkout, use the qualified Node22.23.4/npm10.9.9 stack:

```sh
cd web
npm ci --ignore-scripts
npm run dev
```

Open the localhost address printed by Vite and choose **Import study** (**Abrir
estudo** in the default PT-BR interface), then select `study.json`. Import the
SDK's **report output**, not an `*.input.json` table. The browser validates the
closed report and recomputes its input digest before acceptance. User imports
remain explicitly **unverified execution**; a matching hash or producer field
does not prove a PCA fit was performed. Analysis data are not uploaded.

Four bundled examples are actual local synthetic SDK exports, with input/output
hashes and observed source/runtime provenance. Select a record to compare its
original/projected neighbors, change PT-BR/EN or visible relationship layers,
and use the2D fallback when WebGL is unavailable. Camera/display changes do not
refit or rerank the study. k is read-only: create a new Python report to change it.
No model image, model weights or fabricated analysis is used in the interface.

```sh
npm run typecheck
npm test
npm run test:foundation
npm run build
npm run check:html
```

The build writes static assets to `web/dist`; serve that directory using
localhost or HTTPS so WebCrypto is available. Do not open `index.html` through
file:// and expect secure-context capabilities. The Python wheel provides the
SDK/CLI; the repository and complete source archive also contain the React
source. Use the repository for local frontend development. Initial page/assets
are served normally; report inspection makes no backend/model request.

## Closed input and SDK

`examples/*.input.json` show the exact schema. Required fields are schema exactly
`neighborhood-projection-input/1`, row_ids, feature_names, values and plan exactly
`{k:...}`. Optional budget accepts only max_rows, max_distance_entries,
max_neighbor_slots and max_report_bytes; omitted fields use SDK defaults.
Unknown keys, duplicates and nonfinite JSON (including 1e309) are rejected.

Call `analyze_projection(row_ids,values,feature_names,ProjectionPlan(k),budget=...)`.
The typed result is COMPLETE with immutable report, or a failure with report=None.
Use `serialize_json`/`serialize_point_csv` for the wire format; dataclasses.asdict
is not its adapter. `ProjectionReport.from_dict` is a passive DTO builder, not a
bounded untrusted-file reader or proof that a fit was executed.

Admit 8..4096 rows, 4..16 unscaled features, finite values within ±1000000 and
k1..min(16,floor((n-1)/2)). IDs/names match
`[A-Za-z0-9_][A-Za-z0-9_-]{0,31}`. Numeric-looking IDs stay strings; JSON is
authoritative because CSV consumers can coerce types or discard leading zeros.
Ordinary row sequences use builtin int/float, never bool. Non-masked ndarrays
support signed/unsigned widths 8..64 and float32/float64 with either byte order.
NumPy MaskedArray is rejected even with nomask; no missing values are imputed.

## Interpret the report

PCA centers but does not scale features. Full SVD retains the complete spectrum;
only the first three score columns define the analyzed geometry. A camera or a
screen projection does not define these distances. Different units can dominate
unscaled PCA; no clustering, prediction, semantic truth or operational policy is
inferred from the display.

Self is excluded by ID, including coincident observations. Distance ties follow
ASCII IDs. Neighborhoods are directed. Introduced neighbors contribute
input_rank−k; global trustworthiness and retention are exact reduced fractions,
with display approximations derived outside the wire. The ratio of retained
variance describes a different property from neighborhood preservation.

Constant input still fits real PCA but returns unavailable/null scientific
readings and no neighborhood receipts; the inspector must not amplify tiny
roundoff into a spread. Near-tie/rank flags use a declared numerical tolerance
and do not establish exact rank, a unique basis, uncertainty or stability.
Native rounding can perturb ties and valid axes; no bitwise portability is
claimed. Actual generated examples and their provenance are in examples/reports;
they are observed local fits, not expected bitwise outputs on every machine.

The complete canonical JSON must fit16 MiB before SDK COMPLETE, even if CSV is
chosen later. Hard row/k/work admission does not guarantee that the report fits.
The genuine 4096x16/k16 fixture produced 23895444 private bytes and correctly
returned UNKNOWN_BUDGET/JSON_BUDGET with no report. No receipts were truncated.
Each serializer has its own complete-byte cap including LF. Budgets are logical
bounds, not guarantees about native memory, time, parser recursion or process OOM.

## Verification and limits

```sh
sh scripts/check.sh
sh scripts/check_web.sh
```

Explicit dependency-preparation builds acquire hash-locked PyPI wheels or npm
artifacts from their ordinary verified registries. Later checks are offline.
The Python public SDK/runtime pipeline uses networknone, no host binds, UID 1000,
capsALLdrop, no-new-privileges, PIDs 256, 1 GiB and 2 CPU. The runtime is readonly.
The gate builds wheel/sdist, rebuilds FROM the sdist, checks source/package bytes,
runs actual installed tests and a clean seven-dependency consumer with real
native moderate/maximum cases and installed CLI commands. `dist` is marked
managed output and is reset before preparation; unmarked data or symlinks are
refused. Do not store personal files there.

The Node source-bound SDK checks use only the project bind and private temporary
work, with networknone, UID1000, capsALLdrop, NNP, PIDs256/1GiB/2CPU. They run
50runtime CPU/JSDOM tests, five foundation checks, strict TypeScript and the real
Vite/HTML build. These counts do not constitute browser or GPU proof. The CI
workflow runs both Python package/consumer and Node checks with pinned checkout
and read-only repository permissions.

Python tests are Codex support. Four complete primary Argon runtime modules were
retained from a partial response; no incomplete model test was repaired or used.
Focused core review and native counterevidence are separate from adapter tests.
A workflow file is not a passed hosted-CI run, and no customer, production,
certification, accuracy or adoption claim is made here.

See docs/contract.md for statuses/formulas, README.pt-BR.md for Portuguese and
LICENSE/NOTICE.md for original MIT and retained dependency terms. Project context:
https://lofranotecnologia.com.br.
