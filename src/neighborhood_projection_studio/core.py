"""Core analysis pipeline and canonical report serializers."""

from __future__ import annotations

import csv
from fractions import Fraction
import hashlib
import io
import json
import math
import platform
import re
import struct
from types import MappingProxyType
from typing import Any
import warnings

from ._ranks import (
    NonFiniteDistanceError,
    compute_block_neighborhood,
    summarize_receipts,
)
from .types import (
    Budget,
    EncodedReport,
    FitParams,
    FitReceipt,
    FitVersions,
    FractionValue,
    InputSection,
    NeighborRelation,
    NeighborhoodSection,
    PcaSection,
    ProducerInfo,
    ProjectionPlan,
    ProjectionReport,
    ProjectionResult,
    RowReceipt,
    Status,
    WorkSection,
)

HARD_MAX_ROWS: int = 4096
HARD_MIN_ROWS: int = 8
HARD_MAX_FEATURES: int = 16
HARD_MIN_FEATURES: int = 4
HARD_MAX_K: int = 16
HARD_MAX_DISTANCE_ENTRIES: int = 33554432
HARD_MAX_NEIGHBOR_SLOTS: int = 131072
HARD_MAX_REPORT_BYTES: int = 16777216
MAX_ABS_VALUE: float = 1_000_000.0
MAX_ABS_INT: int = 1_000_000
MAX_SAFE_INT: int = (1 << 53) - 1

_IDENTIFIER_RE = re.compile(r"\A[A-Za-z0-9_][A-Za-z0-9_-]{0,31}\Z", re.ASCII)
_HEX64_RE = re.compile(r"\A[0-9a-f]{64}\Z", re.ASCII)
_FIXED_FLAGS_ORDER = (
    "CUTOFF_NEAR_TIE",
    "RETAINED_AXES_NEAR_TIE",
    "RANK_BELOW_3_POLICY",
)

# Module-level test monkeypatch seams (never exposed as public API hooks)
PCA: Any = None
pairwise_distances: Any = None
threadpool_limits: Any = None


def _is_strict_int(val: Any) -> bool:
    return type(val) is int


def _is_strict_float_or_int(val: Any) -> bool:
    return type(val) in (int, float)


def _is_valid_identifier(val: Any) -> bool:
    return type(val) is str and bool(_IDENTIFIER_RE.match(val))


def _is_valid_version_str(val: Any) -> bool:
    if type(val) is not str or not (1 <= len(val) <= 64):
        return False
    return all(0x20 <= ord(ch) <= 0x7E for ch in val)


def _is_sized_sequence(obj: Any, np_ndarray_type: type | tuple[type, ...] = ()) -> bool:
    if isinstance(obj, (str, bytes, bytearray, memoryview, dict, set, frozenset)):
        return False
    if np_ndarray_type and isinstance(obj, np_ndarray_type):
        return False
    return hasattr(obj, "__len__") and hasattr(obj, "__getitem__")


def _clean_zero(val: float) -> float:
    return 0.0 if val == 0.0 else val


def _compute_input_digest(
    row_ids: tuple[str, ...],
    feature_names: tuple[str, ...],
    values: tuple[tuple[float, ...], ...],
) -> str:
    n = len(row_ids)
    d = len(feature_names)
    parts: list[bytes] = [b"NPSinput1\x00", struct.pack("<IH", n, d)]
    for fname in feature_names:
        fb = fname.encode("ascii")
        parts.append(struct.pack("<H", len(fb)))
        parts.append(fb)
    row_pack_fmt = f"<{d}d"
    for rid, row_vals in zip(row_ids, values, strict=True):
        rb = rid.encode("ascii")
        parts.append(struct.pack("<H", len(rb)))
        parts.append(rb)
        norm_vals = tuple(0.0 if v == 0.0 else float(v) for v in row_vals)
        parts.append(struct.pack(row_pack_fmt, *norm_vals))
    return hashlib.sha256(b"".join(parts)).hexdigest()


def _validate_budget(budget: Any) -> bool:
    if type(budget) is not Budget:
        return False
    if not _is_strict_int(budget.max_rows) or not (0 <= budget.max_rows <= HARD_MAX_ROWS):
        return False
    if not _is_strict_int(budget.max_distance_entries) or not (
        0 <= budget.max_distance_entries <= HARD_MAX_DISTANCE_ENTRIES
    ):
        return False
    if not _is_strict_int(budget.max_neighbor_slots) or not (
        0 <= budget.max_neighbor_slots <= HARD_MAX_NEIGHBOR_SLOTS
    ):
        return False
    if not _is_strict_int(budget.max_report_bytes) or not (
        0 <= budget.max_report_bytes <= HARD_MAX_REPORT_BYTES
    ):
        return False
    return True


def analyze_projection(
    row_ids: Any,
    values: Any,
    feature_names: Any,
    plan: Any,
    *,
    budget: Any = Budget(),
) -> ProjectionResult:
    """Validate inputs, run maintained full-spectrum PCA and block neighborhood analysis."""
    try:
        if not _validate_budget(budget):
            return ProjectionResult(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                report=None,
            )

        if type(plan) is not ProjectionPlan or not _is_strict_int(plan.k):
            return ProjectionResult(
                status=Status.INVALID_INPUT,
                reason="PLAN_K",
                report=None,
            )
        k = plan.k
        if k < 1 or k > HARD_MAX_K:
            return ProjectionResult(
                status=Status.INVALID_INPUT,
                reason="PLAN_K",
                report=None,
            )

        import importlib.metadata
        import numpy as np
        import scipy  # noqa: F401
        import sklearn  # noqa: F401
        import sklearn.decomposition
        import sklearn.metrics
        import threadpoolctl as tpc

        def allowed_numeric_dtype(dtype: Any) -> bool:
            return (
                dtype.kind in ("i", "u") and dtype.itemsize in (1, 2, 4, 8)
            ) or (dtype.kind == "f" and dtype.itemsize in (4, 8))

        is_ndarray_values = isinstance(values, np.ndarray)
        if is_ndarray_values:
            if (
                np.ma.isMaskedArray(values)
                or values.ndim != 2
                or not allowed_numeric_dtype(values.dtype)
            ):
                return ProjectionResult(
                    status=Status.INVALID_INPUT,
                    reason="INPUT_SCHEMA",
                    report=None,
                )
            n, d_values = int(values.shape[0]), int(values.shape[1])
        elif _is_sized_sequence(values, np.ndarray):
            n = len(values)
            d_values = -1
        else:
            return ProjectionResult(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                report=None,
            )

        if not _is_sized_sequence(feature_names, np.ndarray) or not _is_sized_sequence(
            row_ids, np.ndarray
        ):
            return ProjectionResult(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                report=None,
            )

        d = len(feature_names)
        n_ids = len(row_ids)

        if not (HARD_MIN_ROWS <= n <= HARD_MAX_ROWS) or not (
            HARD_MIN_FEATURES <= d <= HARD_MAX_FEATURES
        ):
            return ProjectionResult(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                report=None,
            )
        if n_ids != n or (is_ndarray_values and d_values != d):
            return ProjectionResult(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                report=None,
            )

        max_k_for_n = min(HARD_MAX_K, (n - 1) // 2)
        if k < 1 or k > max_k_for_n:
            return ProjectionResult(
                status=Status.INVALID_INPUT,
                reason="PLAN_K",
                report=None,
            )

        # Pre-copy caller row, work, and zero-report budget admission
        planned_distance_entries = 2 * n * n
        planned_neighbor_slots = 2 * n * k
        if (
            n > budget.max_rows
            or planned_distance_entries > budget.max_distance_entries
            or planned_neighbor_slots > budget.max_neighbor_slots
        ):
            return ProjectionResult(
                status=Status.UNKNOWN_BUDGET,
                reason="ADMISSION_BUDGET",
                report=None,
            )
        if budget.max_report_bytes == 0:
            return ProjectionResult(
                status=Status.UNKNOWN_BUDGET,
                reason="JSON_BUDGET",
                report=None,
            )

        # After admission, check every row width before the first float conversion
        rows_seq: list[Any] = []
        if not is_ndarray_values:
            for i in range(n):
                row_obj = values[i]
                if not _is_sized_sequence(row_obj, np.ndarray) or len(row_obj) != d:
                    return ProjectionResult(
                        status=Status.INVALID_INPUT,
                        reason="INPUT_SCHEMA",
                        report=None,
                    )
                rows_seq.append(row_obj)

        # Validate feature_names and row_ids
        fname_list: list[str] = []
        fname_seen: set[str] = set()
        for j in range(d):
            fn = feature_names[j]
            if not _is_valid_identifier(fn) or fn in fname_seen:
                return ProjectionResult(
                    status=Status.INVALID_INPUT,
                    reason="INPUT_SCHEMA",
                    report=None,
                )
            fname_seen.add(fn)
            fname_list.append(fn)

        rid_list: list[str] = []
        rid_seen: set[str] = set()
        for i in range(n):
            rid = row_ids[i]
            if not _is_valid_identifier(rid) or rid in rid_seen:
                return ProjectionResult(
                    status=Status.INVALID_INPUT,
                    reason="INPUT_SCHEMA",
                    report=None,
                )
            rid_seen.add(rid)
            rid_list.append(rid)

        # Validate scalars and capture one owned float64 matrix
        raw_mat = np.empty((n, d), dtype=np.float64)
        if is_ndarray_values:
            np.copyto(raw_mat, values, casting="safe")
            if not bool(np.all(np.isfinite(raw_mat))) or bool(
                np.any(np.abs(raw_mat) > MAX_ABS_VALUE)
            ):
                return ProjectionResult(
                    status=Status.INVALID_INPUT,
                    reason="INPUT_SCHEMA",
                    report=None,
                )
            raw_mat[raw_mat == 0.0] = 0.0
        else:
            for i in range(n):
                row_obj = rows_seq[i]
                for j in range(d):
                    cell = row_obj[j]
                    cell_type = type(cell)
                    if cell_type is int:
                        if cell < -MAX_ABS_INT or cell > MAX_ABS_INT:
                            return ProjectionResult(
                                status=Status.INVALID_INPUT,
                                reason="INPUT_SCHEMA",
                                report=None,
                            )
                        fval = float(cell)
                    elif cell_type is float:
                        if not math.isfinite(cell) or cell < -MAX_ABS_VALUE or cell > MAX_ABS_VALUE:
                            return ProjectionResult(
                                status=Status.INVALID_INPUT,
                                reason="INPUT_SCHEMA",
                                report=None,
                            )
                        fval = _clean_zero(cell)
                    else:
                        return ProjectionResult(
                            status=Status.INVALID_INPUT,
                            reason="INPUT_SCHEMA",
                            report=None,
                        )
                    raw_mat[i, j] = fval

        # Canonical ASCII row ordering before fitting
        perm = sorted(range(n), key=lambda idx: rid_list[idx])
        canon_row_ids = tuple(rid_list[idx] for idx in perm)
        canon_feature_names = tuple(fname_list)
        owned_mat = np.ascontiguousarray(raw_mat[perm, :], dtype=np.float64)
        owned_mat[owned_mat == 0.0] = 0.0
        canon_values = tuple(
            tuple(_clean_zero(float(owned_mat[i, j])) for j in range(d)) for i in range(n)
        )
        digest_sha256 = _compute_input_digest(canon_row_ids, canon_feature_names, canon_values)

        is_constant = bool(np.all(owned_mat == owned_mat[0:1, :]))
        signal_state = "CONSTANT_INPUT" if is_constant else "NONCONSTANT_INPUT"

        # Collect observed runtime versions
        observed_versions = FitVersions(
            python=platform.python_version(),
            numpy=importlib.metadata.version("numpy"),
            scipy=importlib.metadata.version("scipy"),
            scikit_learn=importlib.metadata.version("scikit-learn"),
            threadpoolctl=importlib.metadata.version("threadpoolctl"),
        )
        for v_str in (
            observed_versions.python,
            observed_versions.numpy,
            observed_versions.scipy,
            observed_versions.scikit_learn,
            observed_versions.threadpoolctl,
        ):
            if not _is_valid_version_str(v_str):
                raise RuntimeError("Invalid runtime version metadata string")

        pca_cls = PCA if PCA is not None else sklearn.decomposition.PCA
        pdist_fn = (
            pairwise_distances
            if pairwise_distances is not None
            else sklearn.metrics.pairwise_distances
        )
        tpc_fn = threadpool_limits if threadpool_limits is not None else tpc.threadpool_limits

        with tpc_fn(limits=1):
            estimator = pca_cls(
                n_components=None,
                svd_solver="full",
                whiten=False,
                copy=True,
            )
            try:
                with warnings.catch_warnings():
                    if is_constant:
                        warnings.filterwarnings("ignore", category=RuntimeWarning)
                    scores_full = estimator.fit_transform(owned_mat)
            except np.linalg.LinAlgError:
                return ProjectionResult(
                    status=Status.NUMERICALLY_INDETERMINATE,
                    reason="SVD_UNRESOLVED",
                    report=None,
                )
            except ValueError:
                return ProjectionResult(
                    status=Status.FIT_FAILED,
                    reason="FIT_VALUE_ERROR",
                    report=None,
                )

            k_spec = min(n, d)
            mean_raw = getattr(estimator, "mean_", None)
            comp_raw = getattr(estimator, "components_", None)
            sv_raw = getattr(estimator, "singular_values_", None)

            if (
                not isinstance(scores_full, np.ndarray)
                or scores_full.shape != (n, k_spec)
                or not isinstance(mean_raw, np.ndarray)
                or mean_raw.shape != (d,)
                or not isinstance(comp_raw, np.ndarray)
                or comp_raw.shape != (k_spec, d)
                or not isinstance(sv_raw, np.ndarray)
                or sv_raw.shape != (k_spec,)
            ):
                raise RuntimeError("Unexpected PCA output shape")

            scores3_arr = np.ascontiguousarray(scores_full[:, :3], dtype=np.float64)
            mean_arr = np.ascontiguousarray(mean_raw, dtype=np.float64)
            comp3_arr = np.ascontiguousarray(comp_raw[:3, :], dtype=np.float64)
            sv_arr = np.ascontiguousarray(sv_raw, dtype=np.float64)

            if (
                not bool(np.all(np.isfinite(scores3_arr)))
                or not bool(np.all(np.isfinite(mean_arr)))
                or not bool(np.all(np.isfinite(comp3_arr)))
                or not bool(np.all(np.isfinite(sv_arr)))
                or bool(np.any(sv_arr < 0.0))
                or bool(np.any(np.diff(sv_arr) > 0.0))
            ):
                return ProjectionResult(
                    status=Status.NUMERICALLY_INDETERMINATE,
                    reason="NUMERIC_RESULT",
                    report=None,
                )

            scores3_arr[scores3_arr == 0.0] = 0.0
            mean_arr[mean_arr == 0.0] = 0.0
            comp3_arr[comp3_arr == 0.0] = 0.0
            sv_arr[sv_arr == 0.0] = 0.0

            sv_tuple = tuple(_clean_zero(float(x)) for x in sv_arr)
            s0, s1, s2, s3 = sv_tuple[0], sv_tuple[1], sv_tuple[2], sv_tuple[3]
            tau = _clean_zero(64.0 * math.ldexp(1.0, -52) * float(max(n, d)) * s0)
            gap12 = _clean_zero(s0 - s1)
            gap23 = _clean_zero(s1 - s2)
            gap34 = _clean_zero(s2 - s3)

            if (
                not math.isfinite(tau)
                or tau < 0.0
                or not math.isfinite(gap12)
                or gap12 < 0.0
                or not math.isfinite(gap23)
                or gap23 < 0.0
                or not math.isfinite(gap34)
                or gap34 < 0.0
            ):
                return ProjectionResult(
                    status=Status.NUMERICALLY_INDETERMINATE,
                    reason="NUMERIC_RESULT",
                    report=None,
                )

            rank_screen_count = sum(1 for s in sv_tuple if s > tau)
            flags_list: list[str] = []
            if gap34 <= tau:
                flags_list.append("CUTOFF_NEAR_TIE")
            if gap12 <= tau or gap23 <= tau:
                flags_list.append("RETAINED_AXES_NEAR_TIE")
            if rank_screen_count < 3:
                flags_list.append("RANK_BELOW_3_POLICY")

            if is_constant:
                retained_variance_fraction: float | None = None
                neighborhood_sec = NeighborhoodSection(
                    state="UNAVAILABLE_CONSTANT_INPUT",
                    k=k,
                    trustworthiness_fraction=None,
                    retention_fraction=None,
                    total_penalty=None,
                    total_retained=None,
                    receipts=(),
                )
                actual_distance_entries = 0
            else:
                try:
                    sq_all = [s * s for s in sv_tuple]
                    if not all(math.isfinite(x) for x in sq_all):
                        return ProjectionResult(
                            status=Status.NUMERICALLY_INDETERMINATE,
                            reason="NUMERIC_RESULT",
                            report=None,
                        )
                    denom = math.fsum(sq_all)
                    numer = math.fsum(sq_all[:3])
                    if not math.isfinite(denom) or denom <= 0.0 or not math.isfinite(numer):
                        return ProjectionResult(
                            status=Status.NUMERICALLY_INDETERMINATE,
                            reason="NUMERIC_RESULT",
                            report=None,
                        )
                    rvf = _clean_zero(numer / denom)
                    if not math.isfinite(rvf) or rvf < 0.0:
                        return ProjectionResult(
                            status=Status.NUMERICALLY_INDETERMINATE,
                            reason="NUMERIC_RESULT",
                            report=None,
                        )
                    retained_variance_fraction = rvf
                except OverflowError:
                    return ProjectionResult(
                        status=Status.NUMERICALLY_INDETERMINATE,
                        reason="NUMERIC_RESULT",
                        report=None,
                    )

                try:
                    neighborhood_sec, actual_distance_entries = compute_block_neighborhood(
                        input_mat=owned_mat,
                        scores3_mat=scores3_arr,
                        row_ids=canon_row_ids,
                        k=k,
                        pairwise_distances_fn=pdist_fn,
                        np_mod=np,
                    )
                except NonFiniteDistanceError:
                    return ProjectionResult(
                        status=Status.NUMERICALLY_INDETERMINATE,
                        reason="NUMERIC_RESULT",
                        report=None,
                    )

        scores3_tuple = tuple(
            tuple(_clean_zero(float(scores3_arr[i, j])) for j in range(3)) for i in range(n)
        )
        mean_tuple = tuple(_clean_zero(float(mean_arr[j])) for j in range(d))
        comp3_tuple = tuple(
            tuple(_clean_zero(float(comp3_arr[i, j])) for j in range(d)) for i in range(3)
        )

        report = ProjectionReport(
            schema="neighborhood-projection-study/1",
            producer=ProducerInfo(package="neighborhood-projection-studio", version="0.1.0"),
            input=InputSection(
                row_ids=canon_row_ids,
                feature_names=canon_feature_names,
                values=canon_values,
                digest_sha256=digest_sha256,
                canonical_order="ASCII_ID",
                unit_policy="UNSCALED_INPUT",
            ),
            plan=ProjectionPlan(k=k),
            pca=PcaSection(
                scores3=scores3_tuple,
                mean=mean_tuple,
                components3=comp3_tuple,
                singular_values=sv_tuple,
                tau=tau,
                rank_screen_count=rank_screen_count,
                gap12=gap12,
                gap23=gap23,
                gap34=gap34,
                flags=tuple(flags_list),
                signal_state=signal_state,
                retained_variance_fraction=retained_variance_fraction,
                fit_receipt=FitReceipt(
                    estimator="sklearn.decomposition.PCA",
                    params=FitParams(
                        n_components=None,
                        svd_solver="full",
                        whiten=False,
                        copy=True,
                    ),
                    versions=observed_versions,
                    native_threads=1,
                ),
            ),
            neighborhood=neighborhood_sec,
            work=WorkSection(
                planned_distance_entries=planned_distance_entries,
                planned_neighbor_slots=planned_neighbor_slots,
                actual_distance_entries=actual_distance_entries,
                fit_count=1,
            ),
        )

        wire_dict = _validate_and_convert_report(report)
        if wire_dict is None:
            return ProjectionResult(
                status=Status.NUMERICALLY_INDETERMINATE,
                reason="NUMERIC_RESULT",
                report=None,
            )
        json_bytes = _encode_canonical_json_bytes(wire_dict)
        if len(json_bytes) > budget.max_report_bytes:
            return ProjectionResult(
                status=Status.UNKNOWN_BUDGET,
                reason="JSON_BUDGET",
                report=None,
            )

        return ProjectionResult(
            status=Status.COMPLETE,
            reason=None,
            report=report,
        )
    except MemoryError:
        return ProjectionResult(
            status=Status.INCOMPLETE,
            reason="MEMORY_FAILURE",
            report=None,
        )
    except ImportError:
        return ProjectionResult(
            status=Status.INCOMPLETE,
            reason="DEPENDENCY_UNAVAILABLE",
            report=None,
        )
    except TimeoutError:
        return ProjectionResult(
            status=Status.INCOMPLETE,
            reason="TIMEOUT",
            report=None,
        )
    except OSError:
        return ProjectionResult(
            status=Status.INCOMPLETE,
            reason="IO_FAILURE",
            report=None,
        )
    except Exception:
        return ProjectionResult(
            status=Status.INCOMPLETE,
            reason="UNEXPECTED_OPERATIONAL",
            report=None,
        )


def _extract_documented_object(
    obj: Any,
    expected_cls: type,
    expected_keys: set[str],
    key_to_attr: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    if type(obj) is expected_cls:
        mapping = key_to_attr or {k: k for k in expected_keys}
        return {k: getattr(obj, attr) for k, attr in mapping.items()}
    if type(obj) in (dict, MappingProxyType):
        if any(type(k) is not str for k in obj.keys()) or set(obj.keys()) != expected_keys:
            return None
        return dict(obj)
    return None


def _is_seq_list_or_tuple(obj: Any) -> bool:
    return type(obj) in (tuple, list)


def _validate_finite_float(
    val: Any,
    *,
    min_val: float | None = None,
    max_val: float | None = None,
    forbid_neg_zero: bool = False,
) -> float | None:
    if not _is_strict_float_or_int(val):
        return None
    try:
        fval = float(val)
    except OverflowError:
        return None
    if not math.isfinite(fval):
        return None
    if forbid_neg_zero and fval == 0.0 and math.copysign(1.0, fval) < 0.0:
        return None
    if min_val is not None and fval < min_val:
        return None
    if max_val is not None and fval > max_val:
        return None
    return _clean_zero(fval)


def _validate_and_convert_report(report: Any) -> dict[str, Any] | None:
    """Validate every DTO type, scalar bound, rank/receipt relation, and constant-state invariant."""
    top = _extract_documented_object(
        report,
        ProjectionReport,
        {"schema", "producer", "input", "plan", "pca", "neighborhood", "work"},
    )
    if top is None or top["schema"] != "neighborhood-projection-study/1":
        return None

    prod = _extract_documented_object(
        top["producer"],
        ProducerInfo,
        {"package", "version"},
    )
    if (
        prod is None
        or prod["package"] != "neighborhood-projection-studio"
        or prod["version"] != "0.1.0"
    ):
        return None

    inp = _extract_documented_object(
        top["input"],
        InputSection,
        {
            "row_ids",
            "feature_names",
            "values",
            "digest_sha256",
            "canonical_order",
            "unit_policy",
        },
    )
    if (
        inp is None
        or inp["canonical_order"] != "ASCII_ID"
        or inp["unit_policy"] != "UNSCALED_INPUT"
    ):
        return None

    row_ids_raw = inp["row_ids"]
    feature_names_raw = inp["feature_names"]
    values_raw = inp["values"]
    digest_raw = inp["digest_sha256"]

    if (
        not _is_seq_list_or_tuple(row_ids_raw)
        or not _is_seq_list_or_tuple(feature_names_raw)
        or not _is_seq_list_or_tuple(values_raw)
        or type(digest_raw) is not str
        or not _HEX64_RE.match(digest_raw)
    ):
        return None

    n = len(row_ids_raw)
    d = len(feature_names_raw)
    if (
        not (HARD_MIN_ROWS <= n <= HARD_MAX_ROWS)
        or not (HARD_MIN_FEATURES <= d <= HARD_MAX_FEATURES)
        or len(values_raw) != n
    ):
        return None

    row_ids: list[str] = []
    for i, rid in enumerate(row_ids_raw):
        if not _is_valid_identifier(rid):
            return None
        if i > 0 and not (row_ids[-1] < rid):
            return None
        row_ids.append(rid)
    row_id_set = set(row_ids)

    feature_names: list[str] = []
    fname_seen: set[str] = set()
    for fn in feature_names_raw:
        if not _is_valid_identifier(fn) or fn in fname_seen:
            return None
        fname_seen.add(fn)
        feature_names.append(fn)

    values: list[list[float]] = []
    for row in values_raw:
        if not _is_seq_list_or_tuple(row) or len(row) != d:
            return None
        conv_row: list[float] = []
        for cell in row:
            if type(cell) is int and (cell < -MAX_ABS_INT or cell > MAX_ABS_INT):
                return None
            fval = _validate_finite_float(
                cell,
                min_val=-MAX_ABS_VALUE,
                max_val=MAX_ABS_VALUE,
                forbid_neg_zero=True,
            )
            if fval is None:
                return None
            conv_row.append(fval)
        values.append(conv_row)

    expected_digest = _compute_input_digest(
        tuple(row_ids),
        tuple(feature_names),
        tuple(tuple(r) for r in values),
    )
    if digest_raw != expected_digest:
        return None

    actual_is_constant = all(
        values[i][j] == values[0][j] for i in range(1, n) for j in range(d)
    )

    plan = _extract_documented_object(top["plan"], ProjectionPlan, {"k"})
    if plan is None or not _is_strict_int(plan["k"]):
        return None
    k = plan["k"]
    if k < 1 or k > min(HARD_MAX_K, (n - 1) // 2):
        return None

    pca = _extract_documented_object(
        top["pca"],
        PcaSection,
        {
            "scores3",
            "mean",
            "components3",
            "singular_values",
            "tau",
            "rank_screen_count",
            "gap12",
            "gap23",
            "gap34",
            "flags",
            "signal_state",
            "retained_variance_fraction",
            "fit_receipt",
        },
    )
    if pca is None:
        return None

    expected_signal_state = "CONSTANT_INPUT" if actual_is_constant else "NONCONSTANT_INPUT"
    if pca["signal_state"] != expected_signal_state:
        return None

    scores3_raw = pca["scores3"]
    mean_raw = pca["mean"]
    comp3_raw = pca["components3"]
    sv_raw = pca["singular_values"]
    k_spec = min(n, d)

    if (
        not _is_seq_list_or_tuple(scores3_raw)
        or len(scores3_raw) != n
        or not _is_seq_list_or_tuple(mean_raw)
        or len(mean_raw) != d
        or not _is_seq_list_or_tuple(comp3_raw)
        or len(comp3_raw) != 3
        or not _is_seq_list_or_tuple(sv_raw)
        or len(sv_raw) != k_spec
    ):
        return None

    scores3: list[list[float]] = []
    for srow in scores3_raw:
        if not _is_seq_list_or_tuple(srow) or len(srow) != 3:
            return None
        c_srow: list[float] = []
        for val in srow:
            fval = _validate_finite_float(val)
            if fval is None:
                return None
            c_srow.append(fval)
        scores3.append(c_srow)

    mean_list: list[float] = []
    for val in mean_raw:
        fval = _validate_finite_float(val)
        if fval is None:
            return None
        mean_list.append(fval)

    comp3: list[list[float]] = []
    for crow in comp3_raw:
        if not _is_seq_list_or_tuple(crow) or len(crow) != d:
            return None
        c_crow: list[float] = []
        for val in crow:
            fval = _validate_finite_float(val)
            if fval is None:
                return None
            c_crow.append(fval)
        comp3.append(c_crow)

    sv_list: list[float] = []
    for idx, val in enumerate(sv_raw):
        fval = _validate_finite_float(val, min_val=0.0)
        if fval is None:
            return None
        if idx > 0 and fval > sv_list[-1]:
            return None
        sv_list.append(fval)

    s0, s1, s2, s3 = sv_list[0], sv_list[1], sv_list[2], sv_list[3]
    expected_tau = _clean_zero(64.0 * math.ldexp(1.0, -52) * float(max(n, d)) * s0)
    tau = _validate_finite_float(pca["tau"], min_val=0.0)
    gap12 = _validate_finite_float(pca["gap12"], min_val=0.0)
    gap23 = _validate_finite_float(pca["gap23"], min_val=0.0)
    gap34 = _validate_finite_float(pca["gap34"], min_val=0.0)
    if (
        tau is None
        or gap12 is None
        or gap23 is None
        or gap34 is None
        or tau != expected_tau
        or gap12 != _clean_zero(s0 - s1)
        or gap23 != _clean_zero(s1 - s2)
        or gap34 != _clean_zero(s2 - s3)
    ):
        return None

    rank_screen_count = pca["rank_screen_count"]
    expected_rsc = sum(1 for s in sv_list if s > tau)
    if not _is_strict_int(rank_screen_count) or rank_screen_count != expected_rsc:
        return None

    expected_flags: list[str] = []
    if gap34 <= tau:
        expected_flags.append("CUTOFF_NEAR_TIE")
    if gap12 <= tau or gap23 <= tau:
        expected_flags.append("RETAINED_AXES_NEAR_TIE")
    if rank_screen_count < 3:
        expected_flags.append("RANK_BELOW_3_POLICY")

    flags_raw = pca["flags"]
    if (
        not _is_seq_list_or_tuple(flags_raw)
        or any(type(f) is not str or f not in _FIXED_FLAGS_ORDER for f in flags_raw)
        or list(flags_raw) != expected_flags
    ):
        return None

    rvf_raw = pca["retained_variance_fraction"]
    if actual_is_constant:
        if rvf_raw is not None:
            return None
        rvf_val: float | None = None
    else:
        rvf_val = _validate_finite_float(rvf_raw, min_val=0.0)
        if rvf_val is None:
            return None
        try:
            sq_all = [s * s for s in sv_list]
            denom = math.fsum(sq_all)
            numer = math.fsum(sq_all[:3])
            if denom <= 0.0 or not math.isfinite(denom) or not math.isfinite(numer):
                return None
            expected_rvf = numer / denom
        except OverflowError:
            return None
        if not math.isclose(rvf_val, expected_rvf, rel_tol=1e-12, abs_tol=1e-15):
            return None

    fr = _extract_documented_object(
        pca["fit_receipt"],
        FitReceipt,
        {"estimator", "params", "versions", "native_threads"},
    )
    if (
        fr is None
        or fr["estimator"] != "sklearn.decomposition.PCA"
        or not _is_strict_int(fr["native_threads"])
        or fr["native_threads"] != 1
    ):
        return None

    fp = _extract_documented_object(
        fr["params"],
        FitParams,
        {"n_components", "svd_solver", "whiten", "copy"},
    )
    if (
        fp is None
        or fp["n_components"] is not None
        or fp["svd_solver"] != "full"
        or fp["whiten"] is not False
        or fp["copy"] is not True
    ):
        return None

    fv = _extract_documented_object(
        fr["versions"],
        FitVersions,
        {"python", "numpy", "scipy", "scikit-learn", "threadpoolctl"},
        {
            "python": "python",
            "numpy": "numpy",
            "scipy": "scipy",
            "scikit-learn": "scikit_learn",
            "threadpoolctl": "threadpoolctl",
        },
    )
    if fv is None or not all(_is_valid_version_str(v) for v in fv.values()):
        return None

    nb = _extract_documented_object(
        top["neighborhood"],
        NeighborhoodSection,
        {
            "state",
            "k",
            "trustworthiness_fraction",
            "retention_fraction",
            "total_penalty",
            "total_retained",
            "receipts",
        },
    )
    if nb is None or not _is_strict_int(nb["k"]) or nb["k"] != k:
        return None

    receipts_raw = nb["receipts"]
    if not _is_seq_list_or_tuple(receipts_raw):
        return None

    if actual_is_constant:
        if (
            nb["state"] != "UNAVAILABLE_CONSTANT_INPUT"
            or nb["trustworthiness_fraction"] is not None
            or nb["retention_fraction"] is not None
            or nb["total_penalty"] is not None
            or nb["total_retained"] is not None
            or len(receipts_raw) != 0
        ):
            return None
        nb_wire: dict[str, Any] = {
            "k": k,
            "receipts": [],
            "retention_fraction": None,
            "state": "UNAVAILABLE_CONSTANT_INPUT",
            "total_penalty": None,
            "total_retained": None,
            "trustworthiness_fraction": None,
        }
    else:
        if nb["state"] != "AVAILABLE" or len(receipts_raw) != n:
            return None

        tw_obj = _extract_documented_object(
            nb["trustworthiness_fraction"],
            FractionValue,
            {"numerator", "denominator"},
        )
        ret_obj = _extract_documented_object(
            nb["retention_fraction"],
            FractionValue,
            {"numerator", "denominator"},
        )
        if tw_obj is None or ret_obj is None:
            return None

        tw_num, tw_den = tw_obj["numerator"], tw_obj["denominator"]
        ret_num, ret_den = ret_obj["numerator"], ret_obj["denominator"]
        tot_pen = nb["total_penalty"]
        tot_ret = nb["total_retained"]
        if (
            not _is_strict_int(tw_num)
            or not _is_strict_int(tw_den)
            or not _is_strict_int(ret_num)
            or not _is_strict_int(ret_den)
            or not _is_strict_int(tot_pen)
            or not _is_strict_int(tot_ret)
            or tw_num < 0
            or tw_den <= 0
            or tw_num > MAX_SAFE_INT
            or tw_den > MAX_SAFE_INT
            or math.gcd(tw_num, tw_den) != 1
            or ret_num < 0
            or ret_den <= 0
            or ret_num > ret_den
            or ret_den > MAX_SAFE_INT
            or math.gcd(ret_num, ret_den) != 1
            or tot_pen < 0
            or tot_pen > MAX_SAFE_INT
            or tot_ret < 0
            or tot_ret > n * k
        ):
            return None

        wire_receipts: list[dict[str, Any]] = []
        validated_row_receipts: list[RowReceipt] = []

        for row_idx, r_raw in enumerate(receipts_raw):
            r_obj = _extract_documented_object(
                r_raw,
                RowReceipt,
                {
                    "id",
                    "input_neighbors",
                    "projected_neighbors",
                    "retained_count",
                    "penalty",
                    "relations",
                },
            )
            if r_obj is None:
                return None
            rid = row_ids[row_idx]
            if r_obj["id"] != rid:
                return None

            in_nb_raw = r_obj["input_neighbors"]
            proj_nb_raw = r_obj["projected_neighbors"]
            rels_raw = r_obj["relations"]
            ret_cnt = r_obj["retained_count"]
            pen_val = r_obj["penalty"]

            if (
                not _is_seq_list_or_tuple(in_nb_raw)
                or len(in_nb_raw) != k
                or not _is_seq_list_or_tuple(proj_nb_raw)
                or len(proj_nb_raw) != k
                or not _is_seq_list_or_tuple(rels_raw)
                or not _is_strict_int(ret_cnt)
                or not _is_strict_int(pen_val)
                or pen_val < 0
                or pen_val > MAX_SAFE_INT
            ):
                return None

            in_nb: list[str] = []
            in_seen: set[str] = set()
            for nid in in_nb_raw:
                if type(nid) is not str or nid == rid or nid not in row_id_set or nid in in_seen:
                    return None
                in_seen.add(nid)
                in_nb.append(nid)

            proj_nb: list[str] = []
            proj_seen: set[str] = set()
            for nid in proj_nb_raw:
                if type(nid) is not str or nid == rid or nid not in row_id_set or nid in proj_seen:
                    return None
                proj_seen.add(nid)
                proj_nb.append(nid)

            expected_retained = len(in_seen & proj_seen)
            expected_union = sorted(in_seen | proj_seen)
            if ret_cnt != expected_retained or len(rels_raw) != len(expected_union):
                return None

            in_pos_map = {nid: pos for pos, nid in enumerate(in_nb, start=1)}
            proj_pos_map = {nid: pos for pos, nid in enumerate(proj_nb, start=1)}

            seen_in_ranks: set[int] = set()
            seen_proj_ranks: set[int] = set()
            wire_rels: list[dict[str, Any]] = []
            dto_rels: list[NeighborRelation] = []
            pen_sum = 0

            for expected_uid, rel_raw in zip(expected_union, rels_raw, strict=True):
                rel_obj = _extract_documented_object(
                    rel_raw,
                    NeighborRelation,
                    {
                        "id",
                        "input_rank",
                        "projected_rank",
                        "category",
                        "penalty",
                        "input_distance",
                        "projected_distance",
                    },
                )
                if rel_obj is None or rel_obj["id"] != expected_uid:
                    return None

                in_rk = rel_obj["input_rank"]
                proj_rk = rel_obj["projected_rank"]
                cat = rel_obj["category"]
                r_pen = rel_obj["penalty"]
                in_dist = _validate_finite_float(rel_obj["input_distance"], min_val=0.0)
                proj_dist = _validate_finite_float(rel_obj["projected_distance"], min_val=0.0)

                if (
                    not _is_strict_int(in_rk)
                    or not (1 <= in_rk <= n - 1)
                    or in_rk in seen_in_ranks
                    or not _is_strict_int(proj_rk)
                    or not (1 <= proj_rk <= n - 1)
                    or proj_rk in seen_proj_ranks
                    or not _is_strict_int(r_pen)
                    or in_dist is None
                    or proj_dist is None
                ):
                    return None
                seen_in_ranks.add(in_rk)
                seen_proj_ranks.add(proj_rk)

                in_member = expected_uid in in_pos_map
                proj_member = expected_uid in proj_pos_map
                if in_member:
                    if in_rk != in_pos_map[expected_uid]:
                        return None
                elif in_rk <= k:
                    return None

                if proj_member:
                    if proj_rk != proj_pos_map[expected_uid]:
                        return None
                elif proj_rk <= k:
                    return None

                if in_member and proj_member:
                    if cat != "RETAINED" or r_pen != 0:
                        return None
                elif in_member:
                    if cat != "LOST" or r_pen != 0:
                        return None
                else:
                    if cat != "INTRODUCED" or r_pen != in_rk - k:
                        return None

                pen_sum += r_pen
                wire_rels.append(
                    {
                        "category": cat,
                        "id": expected_uid,
                        "input_distance": in_dist,
                        "input_rank": in_rk,
                        "penalty": r_pen,
                        "projected_distance": proj_dist,
                        "projected_rank": proj_rk,
                    }
                )
                dto_rels.append(
                    NeighborRelation(
                        id=expected_uid,
                        input_rank=in_rk,
                        projected_rank=proj_rk,
                        category=cat,
                        penalty=r_pen,
                        input_distance=in_dist,
                        projected_distance=proj_dist,
                    )
                )

            if pen_val != pen_sum:
                return None

            # Verify rank-order and (distance, ID) consistency among union members
            by_in_rank = sorted(dto_rels, key=lambda r: r.input_rank)
            for idx_r in range(len(by_in_rank) - 1):
                a, b = by_in_rank[idx_r], by_in_rank[idx_r + 1]
                if (a.input_distance, a.id) > (b.input_distance, b.id):
                    return None

            by_proj_rank = sorted(dto_rels, key=lambda r: r.projected_rank)
            for idx_r in range(len(by_proj_rank) - 1):
                a, b = by_proj_rank[idx_r], by_proj_rank[idx_r + 1]
                if (a.projected_distance, a.id) > (b.projected_distance, b.id):
                    return None

            wire_receipts.append(
                {
                    "id": rid,
                    "input_neighbors": in_nb,
                    "penalty": pen_val,
                    "projected_neighbors": proj_nb,
                    "relations": wire_rels,
                    "retained_count": ret_cnt,
                }
            )
            validated_row_receipts.append(
                RowReceipt(
                    id=rid,
                    input_neighbors=tuple(in_nb),
                    projected_neighbors=tuple(proj_nb),
                    retained_count=ret_cnt,
                    penalty=pen_val,
                    relations=tuple(dto_rels),
                )
            )

        exp_tw, exp_ret, exp_tot_pen, exp_tot_ret = summarize_receipts(
            validated_row_receipts, n, k
        )
        if (
            tot_pen != exp_tot_pen
            or tot_ret != exp_tot_ret
            or tw_num != exp_tw.numerator
            or tw_den != exp_tw.denominator
            or ret_num != exp_ret.numerator
            or ret_den != exp_ret.denominator
        ):
            return None

        nb_wire = {
            "k": k,
            "receipts": wire_receipts,
            "retention_fraction": {"denominator": ret_den, "numerator": ret_num},
            "state": "AVAILABLE",
            "total_penalty": tot_pen,
            "total_retained": tot_ret,
            "trustworthiness_fraction": {"denominator": tw_den, "numerator": tw_num},
        }

    work = _extract_documented_object(
        top["work"],
        WorkSection,
        {
            "planned_distance_entries",
            "planned_neighbor_slots",
            "actual_distance_entries",
            "fit_count",
        },
    )
    if work is None:
        return None

    expected_actual_dist = 0 if actual_is_constant else 2 * n * n
    if (
        not _is_strict_int(work["planned_distance_entries"])
        or work["planned_distance_entries"] != 2 * n * n
        or not _is_strict_int(work["planned_neighbor_slots"])
        or work["planned_neighbor_slots"] != 2 * n * k
        or not _is_strict_int(work["actual_distance_entries"])
        or work["actual_distance_entries"] != expected_actual_dist
        or not _is_strict_int(work["fit_count"])
        or work["fit_count"] != 1
    ):
        return None

    return {
        "input": {
            "canonical_order": "ASCII_ID",
            "digest_sha256": digest_raw,
            "feature_names": feature_names,
            "row_ids": row_ids,
            "unit_policy": "UNSCALED_INPUT",
            "values": values,
        },
        "neighborhood": nb_wire,
        "pca": {
            "components3": comp3,
            "fit_receipt": {
                "estimator": "sklearn.decomposition.PCA",
                "native_threads": 1,
                "params": {
                    "copy": True,
                    "n_components": None,
                    "svd_solver": "full",
                    "whiten": False,
                },
                "versions": {
                    "numpy": fv["numpy"],
                    "python": fv["python"],
                    "scikit-learn": fv["scikit-learn"],
                    "scipy": fv["scipy"],
                    "threadpoolctl": fv["threadpoolctl"],
                },
            },
            "flags": expected_flags,
            "gap12": gap12,
            "gap23": gap23,
            "gap34": gap34,
            "mean": mean_list,
            "rank_screen_count": rank_screen_count,
            "retained_variance_fraction": rvf_val,
            "scores3": scores3,
            "signal_state": expected_signal_state,
            "singular_values": sv_list,
            "tau": tau,
        },
        "plan": {"k": k},
        "producer": {
            "package": "neighborhood-projection-studio",
            "version": "0.1.0",
        },
        "schema": "neighborhood-projection-study/1",
        "work": {
            "actual_distance_entries": expected_actual_dist,
            "fit_count": 1,
            "planned_distance_entries": 2 * n * n,
            "planned_neighbor_slots": 2 * n * k,
        },
    }


def _encode_canonical_json_bytes(wire_dict: dict[str, Any]) -> bytes:
    text = (
        json.dumps(
            wire_dict,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        )
        + "\n"
    )
    return text.encode("utf-8")


def _encode_point_csv_bytes(wire_dict: dict[str, Any]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, dialect="excel", lineterminator="\n")
    writer.writerow(
        [
            "id",
            "pc1",
            "pc2",
            "pc3",
            "k",
            "neighborhood_state",
            "retained_count",
            "penalty",
        ]
    )
    row_ids: list[str] = wire_dict["input"]["row_ids"]
    scores3: list[list[float]] = wire_dict["pca"]["scores3"]
    nb = wire_dict["neighborhood"]
    k_val: int = nb["k"]
    nb_state: str = nb["state"]
    receipts: list[dict[str, Any]] = nb["receipts"]
    is_avail = nb_state == "AVAILABLE"

    for idx, (rid, coords) in enumerate(zip(row_ids, scores3, strict=True)):
        pc1_s = json.dumps(float(coords[0]), allow_nan=False)
        pc2_s = json.dumps(float(coords[1]), allow_nan=False)
        pc3_s = json.dumps(float(coords[2]), allow_nan=False)
        if is_avail:
            rec = receipts[idx]
            ret_cell = str(rec["retained_count"])
            pen_cell = str(rec["penalty"])
        else:
            ret_cell = ""
            pen_cell = ""
        writer.writerow([rid, pc1_s, pc2_s, pc3_s, str(k_val), nb_state, ret_cell, pen_cell])

    return buf.getvalue().encode("utf-8")


def _check_result_envelope(result: Any) -> tuple[Status | None, ProjectionReport | None]:
    if type(result) is not ProjectionResult:
        return Status.INVALID_INPUT, None
    if type(result.status) is not Status:
        return Status.INVALID_INPUT, None
    failure_reasons = {
        Status.INVALID_INPUT: frozenset({"INPUT_SCHEMA", "PLAN_K"}),
        Status.UNKNOWN_BUDGET: frozenset({"ADMISSION_BUDGET", "JSON_BUDGET"}),
        Status.FIT_FAILED: frozenset({"FIT_VALUE_ERROR"}),
        Status.NUMERICALLY_INDETERMINATE: frozenset({"SVD_UNRESOLVED", "NUMERIC_RESULT"}),
        Status.INCOMPLETE: frozenset({
            "MEMORY_FAILURE", "DEPENDENCY_UNAVAILABLE", "TIMEOUT", "IO_FAILURE",
            "UNEXPECTED_OPERATIONAL",
        }),
    }
    if result.status != Status.COMPLETE:
        if (
            result.status not in failure_reasons
            or result.report is not None
            or type(result.reason) is not str
            or result.reason not in failure_reasons[result.status]
        ):
            return Status.INVALID_INPUT, None
        return Status.NOT_COMPLETE, None
    if result.reason is not None or type(result.report) is not ProjectionReport:
        return Status.INVALID_INPUT, None
    return None, result.report


def serialize_json(result: Any, *, max_bytes: Any = HARD_MAX_REPORT_BYTES) -> EncodedReport:
    """Validate a complete ProjectionResult and encode canonical UTF-8 JSON bytes."""
    try:
        if not _is_strict_int(max_bytes) or not (0 <= max_bytes <= HARD_MAX_REPORT_BYTES):
            return EncodedReport(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                data=None,
                required_bytes=None,
            )
        err_status, report = _check_result_envelope(result)
        if err_status is Status.INVALID_INPUT:
            return EncodedReport(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                data=None,
                required_bytes=None,
            )
        if err_status is Status.NOT_COMPLETE:
            return EncodedReport(
                status=Status.NOT_COMPLETE,
                reason="SOURCE_NOT_COMPLETE",
                data=None,
                required_bytes=None,
            )

        wire_dict = _validate_and_convert_report(report)
        if wire_dict is None:
            return EncodedReport(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                data=None,
                required_bytes=None,
            )

        encoded = _encode_canonical_json_bytes(wire_dict)
        req_bytes = len(encoded)
        if req_bytes > max_bytes:
            return EncodedReport(
                status=Status.UNKNOWN_BUDGET,
                reason="JSON_BUDGET",
                data=None,
                required_bytes=req_bytes,
            )
        return EncodedReport(
            status=Status.COMPLETE,
            reason=None,
            data=encoded,
            required_bytes=req_bytes,
        )
    except MemoryError:
        return EncodedReport(
            status=Status.INCOMPLETE,
            reason="MEMORY_FAILURE",
            data=None,
            required_bytes=None,
        )
    except ImportError:
        return EncodedReport(
            status=Status.INCOMPLETE,
            reason="DEPENDENCY_UNAVAILABLE",
            data=None,
            required_bytes=None,
        )
    except TimeoutError:
        return EncodedReport(
            status=Status.INCOMPLETE,
            reason="TIMEOUT",
            data=None,
            required_bytes=None,
        )
    except OSError:
        return EncodedReport(
            status=Status.INCOMPLETE,
            reason="IO_FAILURE",
            data=None,
            required_bytes=None,
        )
    except Exception:
        return EncodedReport(
            status=Status.INCOMPLETE,
            reason="UNEXPECTED_OPERATIONAL",
            data=None,
            required_bytes=None,
        )


def serialize_point_csv(result: Any, *, max_bytes: Any = HARD_MAX_REPORT_BYTES) -> EncodedReport:
    """Validate a complete ProjectionResult and encode UTF-8 point summary CSV bytes."""
    try:
        if not _is_strict_int(max_bytes) or not (0 <= max_bytes <= HARD_MAX_REPORT_BYTES):
            return EncodedReport(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                data=None,
                required_bytes=None,
            )
        err_status, report = _check_result_envelope(result)
        if err_status is Status.INVALID_INPUT:
            return EncodedReport(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                data=None,
                required_bytes=None,
            )
        if err_status is Status.NOT_COMPLETE:
            return EncodedReport(
                status=Status.NOT_COMPLETE,
                reason="SOURCE_NOT_COMPLETE",
                data=None,
                required_bytes=None,
            )

        wire_dict = _validate_and_convert_report(report)
        if wire_dict is None:
            return EncodedReport(
                status=Status.INVALID_INPUT,
                reason="INPUT_SCHEMA",
                data=None,
                required_bytes=None,
            )

        encoded = _encode_point_csv_bytes(wire_dict)
        req_bytes = len(encoded)
        if req_bytes > max_bytes:
            return EncodedReport(
                status=Status.UNKNOWN_BUDGET,
                reason="CSV_BUDGET",
                data=None,
                required_bytes=req_bytes,
            )
        return EncodedReport(
            status=Status.COMPLETE,
            reason=None,
            data=encoded,
            required_bytes=req_bytes,
        )
    except MemoryError:
        return EncodedReport(
            status=Status.INCOMPLETE,
            reason="MEMORY_FAILURE",
            data=None,
            required_bytes=None,
        )
    except ImportError:
        return EncodedReport(
            status=Status.INCOMPLETE,
            reason="DEPENDENCY_UNAVAILABLE",
            data=None,
            required_bytes=None,
        )
    except TimeoutError:
        return EncodedReport(
            status=Status.INCOMPLETE,
            reason="TIMEOUT",
            data=None,
            required_bytes=None,
        )
    except OSError:
        return EncodedReport(
            status=Status.INCOMPLETE,
            reason="IO_FAILURE",
            data=None,
            required_bytes=None,
        )
    except Exception:
        return EncodedReport(
            status=Status.INCOMPLETE,
            reason="UNEXPECTED_OPERATIONAL",
            data=None,
            required_bytes=None,
        )
