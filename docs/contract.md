# Python SDK and CLI contract

The qualified stack and bounds are in both READMEs. One maintained
PCA(n_components=None,svd_solver="full",whiten=False,copy=True) fit uses native
threadpools1. Canonical ASCII row order and admitted owned float64 values drive
both fitting and NPSinput1-framed SHA256. No feature scaling/model selection,
plugins, pickle, callbacks or arbitrary expressions.

Let s be the full observed spectrum, eps=2^-52 and tau=64*eps*max(n,d)*s0.
Rank_screen_count counts s>tau. Gap34<=tau and either gap12/gap23<=tau give
descriptive near-tie flags; count<3 gives RANK_BELOW_3_POLICY. Equal/near-equal
subspaces and signs need not identify unique axes. Exact constant owned rows
produce CONSTANT_INPUT with retained_variance_fraction=null and
UNAVAILABLE_CONSTANT_INPUT: all neighborhood aggregates null, receipts[].

Nonconstant input uses maintained Euclidean distance blocks of at most 128 rows,
self excluded, exact numeric distance ties ordered by ASCII ID. Ni and Zi are
the first k original/projected neighbors. Per-row introduced penalties are
input_rank−k; P sums them, R counts retained memberships. Exact fractions:

T = 1 − 2P/[n*k*(2n−3k−1)], retention = R/(n*k).

The wire fraction has EXACTLY numerator/denominator, no display approximation.
Per-point receipts contain ordered lists, integer penalty/intersection counts
and the ASCII-sorted union with both ranks/distances/category. A serializer
validates algebraic/structural consistency; it does not refit or authenticate
caller-forged consistent DTOs. Use canonical sorted compact ensure_ascii JSON,
allow_nan=False, UTF8 and one LF. CSV has fixed header and LF; unavailable cells
are empty. Numeric string IDs can be coerced by CSV consumers; JSON is authority.

| SDK status | Meaning | CLI exit |
|---|---|---|
| COMPLETE | Whole report admitted | 0 |
| INVALID_INPUT | Input/plan/metadata invalid | 2 |
| UNKNOWN_BUDGET | Supported lower work/report bound exhausted | 3 |
| FIT_FAILED | ValueError only inside fixed native fit | 4 |
| NUMERICALLY_INDETERMINATE | Known SVD/owned nonfinite arithmetic unresolved | 5 |
| INCOMPLETE | Memory/dependency/timeout/I/O/unexpected operational failure | 4 |

Only the encoded result admits NOT_COMPLETE for a valid failed run source.
Every failed run has report=None; every failed encoding has data=None. Known
operational failures never become budget or bad-user-input verdicts. Process
kill/OOM cannot promise an in-process returned result. NumPy conversion overflow
of an ordinary invalid DTO is INVALID_INPUT; arbitrary SDK OverflowError remains
operational. Metadata tau/gaps replay exactly from their same binary64 operands;
native reconstruction comparisons retain their separate numerical tolerances.

CLI input: required schema,row_ids,feature_names,values,plan; schema exactly
neighborhood-projection-input/1, plan only k. Optional budget has only four known
partial keys. Unknown/duplicate JSON keys and nonfinite numbers are rejected;
core owns scalar/count/type rules. Input bytes<=4194304; larger gives
UNKNOWN_BUDGET/INPUT_BYTES/3. Malformed JSON/UTF8 gives INPUT_JSON/2; wrong schema
or unknown wrapper keys INPUT_SCHEMA/2; usage CLI_USAGE/2. File/stdin I/O is
INPUT_IO/4, output delivery OUTPUT_IO/4. Chosen-format cap 0 follows input/core;
SDKbudget.max_report_bytes0 still admits before copies/fitting. Both formats have
separate0..16777216-byte caps; canonical JSON is required before SDK COMPLETE.

Local files are opened RDONLY|NOFOLLOW|NONBLOCK|CLOEXEC. Regular-file identity,
size, mtime/ctime snapshots through fstat and no-follow leaf stat are checked
before/after bounded owned reads, including expected byte length. Symlinks,
nonregular, missing, changed and failed reads/closes are INPUT_IO. This is a
cooperative-source capture, not protection from every adversarial pathname race
or metadata restoration. Stdin is bounded chunk reading through EOF; None at any point is INPUT_IO,
including after a valid JSON prefix. A later extra JSON/text chunk is decoded
as part of the same complete document and rejected when malformed. No
parent directory sandbox, recursion/RSS guarantee or implicit stdin deadline.

Binary writes loop on short writes and flush. Only an already-failed FD1/2 is
redirected to the null device to avoid a second CPython finalizer failure/exit120.
Argparse help/version use controlled exits and flush. Stderr error delivery is
best effort; its own failure preserves the original error exit. Stdout can have
an unsuccessful prefix; require exit0 plus full framing. Errors never repeat
caller paths/data or arbitrary SDK text.

The inspector must retain the last valid study on rejected import, label user
reports provenance-unverified and avoid changing metrics under camera/locale
controls. Changing k requires another Python run. Browser acceptance is a
separate actual-host gate; these Python checks do not establish it.
