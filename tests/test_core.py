"""Codex support tests; primary Argon generation supplied ZERO complete test files.

Literal ranks/bytes were frozen before product generation. Native fits are real;
exception probes are separate controlled tests and never native-fit evidence.
"""
from dataclasses import FrozenInstanceError, fields, is_dataclass, replace
from fractions import Fraction
from contextlib import contextmanager
from pathlib import Path
import hashlib
import importlib.metadata
import json
import math
import platform
import struct

import numpy as np
import pytest
from sklearn.decomposition import PCA
from sklearn.metrics import pairwise_distances
from threadpoolctl import threadpool_info, threadpool_limits

import neighborhood_projection_studio as sdk
from neighborhood_projection_studio import core, types as dto, _ranks

DATA = Path(__file__).parent / "data"


@pytest.fixture(autouse=True)
def reset_test_seams(monkeypatch):
    monkeypatch.setattr(core, "PCA", None)
    monkeypatch.setattr(core, "pairwise_distances", None)
    monkeypatch.setattr(core, "threadpool_limits", None)


@pytest.fixture
def table():
    return ([f"p{i:04d}" for i in range(64)],
            np.random.default_rng(42).normal(size=(64, 8)) * np.arange(1, 9),
            [f"f{j}" for j in range(8)])


def run(table, **kwargs):
    return sdk.analyze_projection(*table, sdk.ProjectionPlan(5), **kwargs)


@pytest.fixture(scope="module")
def moderate():
    data = ([f"p{i:04d}" for i in range(64)],
            np.random.default_rng(42).normal(size=(64, 8)) * np.arange(1, 9),
            [f"f{j}" for j in range(8)])
    result = sdk.analyze_projection(*data, sdk.ProjectionPlan(5))
    assert result.status is sdk.Status.COMPLETE
    return result


@pytest.fixture
def constant_dto():
    # This literal DTO is NOT evidence of actual model execution/unique basis.
    report = dto.ProjectionReport.from_dict(json.loads((DATA / "constant-dto.json").read_text()))
    return sdk.ProjectionResult(sdk.Status.COMPLETE, None, report)


def test_real_fixed_full_spectrum_fit_threads_versions_and_input_ownership(table, monkeypatch):
    calls = []
    class ObservedPCA(PCA):
        def fit_transform(self, X, y=None):
            calls.append((self.get_params(), [x["num_threads"] for x in threadpool_info()], X.copy()))
            return super().fit_transform(X, y=y)
    monkeypatch.setattr(core, "PCA", ObservedPCA)
    original = table[1].copy()
    result = run(table)
    assert result.status is sdk.Status.COMPLETE
    assert len(calls) == 1
    params, threads, captured = calls[0]
    assert {k: params[k] for k in ["n_components", "svd_solver", "whiten", "copy"]} == {
        "n_components": None, "svd_solver": "full", "whiten": False, "copy": True}
    assert threads and all(t == 1 for t in threads)
    np.testing.assert_array_equal(captured, original)
    np.testing.assert_array_equal(table[1], original)
    assert len(result.report.pca.singular_values) == 8
    wire = json.loads(sdk.serialize_json(result).data)
    assert wire["pca"]["fit_receipt"]["versions"] == {"python": platform.python_version(), **{
        name: importlib.metadata.version(name) for name in ["numpy", "scipy", "scikit-learn", "threadpoolctl"]}}
    assert wire["work"] == {"fit_count": 1, "planned_distance_entries": 8192,
        "actual_distance_entries": 8192, "planned_neighbor_slots": 640}


def test_independent_scalar_native_fraction_and_all_row_receipts(table, moderate):
    wire = json.loads(sdk.serialize_json(moderate).data)
    projected = wire["pca"]["scores3"]
    ids, values, _ = table
    P = R = 0
    for i in range(64):
        def ordered(matrix):
            ds = sorted((math.fsum((float(a)-float(b))**2 for a, b in zip(matrix[i], matrix[j])), ids[j])
                        for j in range(64) if j != i)
            assert all(ds[j+1][0]-ds[j][0] > 1e-10 for j in range(len(ds)-1))
            return [id_ for _, id_ in ds]
        original, output = ordered(values), ordered(projected)
        ranks = {id_: pos for pos, id_ in enumerate(original, 1)}
        p = sum(max(0, ranks[id_]-5) for id_ in output[:5])
        retained = len(set(original[:5]) & set(output[:5]))
        row = wire["neighborhood"]["receipts"][i]
        assert row["id"] == ids[i]
        assert row["input_neighbors"] == original[:5]
        assert row["projected_neighbors"] == output[:5]
        assert row["penalty"] == p and row["retained_count"] == retained
        P += p; R += retained
    tw = 1-Fraction(2*P, 64*5*(128-15-1))
    retention = Fraction(R, 64*5)
    assert tw == Fraction(115, 128)
    assert wire["neighborhood"]["trustworthiness_fraction"] == {"numerator": tw.numerator, "denominator": tw.denominator}
    assert wire["neighborhood"]["retention_fraction"] == {"numerator": retention.numerator, "denominator": retention.denominator}


@pytest.mark.parametrize("k", [1, 2, 3])
def test_frozen_independent_integer_rank_literal(k):
    literal = json.loads((DATA / "rank-literal.json").read_text())
    case = next(x for x in literal["cases"] if x["k"] == k)
    rows = literal["rows"]
    got = _ranks.evaluate_literal_projection_ranks([r["id"] for r in rows],
        [r["input"] for r in rows], [r["projection"] for r in rows], k)
    assert [got.trustworthiness_fraction.numerator, got.trustworthiness_fraction.denominator] == case["trustworthiness_fraction"]
    assert [got.retention_fraction.numerator, got.retention_fraction.denominator] == case["neighbor_retention_fraction"]
    assert got.total_penalty == case["rank_penalty"]
    for actual, expected in zip(got.receipts, case["receipts"], strict=True):
        assert actual.id == expected["id"]
        assert list(actual.input_neighbors) == expected["input_neighbors"]
        assert list(actual.projected_neighbors) == expected["output_neighbors"]
        assert actual.penalty == expected["penalty"]
        assert actual.retained_count == expected["retained"]
        assert [{"id": r.id, "input_rank": r.input_rank, "penalty": r.penalty}
                for r in actual.relations if r.category == "INTRODUCED"] == expected["intruders"]
        assert actual.id not in actual.input_neighbors + actual.projected_neighbors


def test_weighted_native_spectrum_retained_variance_and_reconstruction():
    rows = json.loads((DATA / "rank-literal.json").read_text())["rows"]
    values = np.array([r["input"] for r in rows], dtype=np.float64)
    result = sdk.analyze_projection([r["id"] for r in rows], values, ["a", "b", "c", "d"], sdk.ProjectionPlan(2))
    assert result.status is sdk.Status.COMPLETE
    pca = result.report.pca
    np.testing.assert_allclose(pca.singular_values, [24, 16, 8, 4], rtol=1e-12, atol=1e-12)
    assert math.isclose(pca.retained_variance_fraction, 56/57, rel_tol=1e-12)
    reconstruction = np.asarray(pca.scores3) @ np.asarray(pca.components3) + np.asarray(pca.mean)
    sse = math.fsum((float(a)-float(b))**2 for a, b in zip(values.flat, reconstruction.flat))
    assert math.isclose(sse, 16, rel_tol=1e-12, abs_tol=1e-12)
    assert pca.flags == ()


def test_tied_and_rank_screen_states_are_descriptive_not_unique_axes():
    values = np.array([[1. if (i >> bit) & 1 else -1. for bit in range(4)] for i in range(16)])
    result = sdk.analyze_projection([f"p{i:02d}" for i in range(16)], values, ["a", "b", "c", "d"], sdk.ProjectionPlan(2))
    assert result.status is sdk.Status.COMPLETE
    np.testing.assert_allclose(result.report.pca.singular_values, [4, 4, 4, 4], atol=1e-12)
    assert result.report.pca.flags == ("CUTOFF_NEAR_TIE", "RETAINED_AXES_NEAR_TIE")
    assert result.report.pca.gap34 <= result.report.pca.tau


def test_constant_real_fit_has_unavailable_not_perfect_neighbor_score(monkeypatch):
    calls = []
    class ObservedPCA(PCA):
        def fit_transform(self, X, y=None):
            calls.append(True)
            return super().fit_transform(X, y=y)
    monkeypatch.setattr(core, "PCA", ObservedPCA)
    result = sdk.analyze_projection([f"p{i:02d}" for i in range(16)], np.full((16, 4), 7.),
        ["a", "b", "c", "d"], sdk.ProjectionPlan(2))
    assert result.status is sdk.Status.COMPLETE and len(calls) == 1
    nb = result.report.neighborhood
    assert result.report.pca.signal_state == "CONSTANT_INPUT"
    assert result.report.pca.retained_variance_fraction is None
    assert nb.state == "UNAVAILABLE_CONSTANT_INPUT"
    assert nb.trustworthiness_fraction is nb.retention_fraction is None
    assert nb.total_penalty is nb.total_retained is None and nb.receipts == ()
    assert result.report.work.actual_distance_entries == 0
    assert result.report.work.planned_distance_entries == 512


def test_canonical_order_and_detached_immutable_public_data(table, moderate):
    reordered = (list(reversed(table[0])), table[1][::-1], table[2])
    assert sdk.serialize_json(run(reordered)).data == sdk.serialize_json(moderate).data
    with pytest.raises(FrozenInstanceError):
        moderate.report.pca.tau = 0
    with pytest.raises(TypeError):
        moderate.report.input.values[0][0] = 0
    def assert_detached(value):
        assert not isinstance(value, np.ndarray)
        assert not isinstance(value, (list, dict))
        if is_dataclass(value):
            for f in fields(value): assert_detached(getattr(value, f.name))
        elif isinstance(value, tuple):
            for item in value: assert_detached(item)
    assert_detached(moderate.report)
    result = run(table)
    original = sdk.serialize_json(result).data
    table[1][:] = 99
    table[0][0] = "changed"
    assert sdk.serialize_json(result).data == original


@pytest.mark.parametrize("serializer,file", [(sdk.serialize_json, "constant-dto.json"),
    (sdk.serialize_point_csv, "constant-points.csv")])
def test_exact_preproduct_DTO_bytes_and_separate_format_caps(constant_dto, serializer, file):
    expected = (DATA / file).read_bytes()
    assert serializer(constant_dto).data == expected
    for cap in [0, len(expected)-1, len(expected)]:
        result = serializer(constant_dto, max_bytes=cap)
        assert result.required_bytes == len(expected)
        if cap < len(expected):
            assert result.status is sdk.Status.UNKNOWN_BUDGET and result.data is None
        else:
            assert result.status is sdk.Status.COMPLETE and result.data == expected
    assert expected.endswith(b"\n") and b"\r" not in expected


@pytest.mark.parametrize("serializer", [sdk.serialize_json, sdk.serialize_point_csv])
def test_invalid_run_status_reason_envelopes_are_rejected(serializer):
    for status, reason, report in [(sdk.Status.NOT_COMPLETE, "SOURCE_NOT_COMPLETE", None),
        ("COMPLETE", None, None), (True, None, None), (sdk.Status.COMPLETE, "INPUT_SCHEMA", None),
        (sdk.Status.INVALID_INPUT, "arbitrary marker", None), (sdk.Status.INCOMPLETE, "", None),
        (sdk.Status.FIT_FAILED, "MEMORY_FAILURE", None), (sdk.Status.UNKNOWN_BUDGET, "CSV_BUDGET", None)]:
        result = serializer(sdk.ProjectionResult(status, reason, report))
        assert result.status is sdk.Status.INVALID_INPUT and result.data is None
    for status, reason in [(sdk.Status.INVALID_INPUT, "INPUT_SCHEMA"), (sdk.Status.UNKNOWN_BUDGET, "ADMISSION_BUDGET"),
        (sdk.Status.FIT_FAILED, "FIT_VALUE_ERROR"), (sdk.Status.NUMERICALLY_INDETERMINATE, "SVD_UNRESOLVED"),
        (sdk.Status.INCOMPLETE, "MEMORY_FAILURE")]:
        result = serializer(sdk.ProjectionResult(status, reason, None))
        assert result.status is sdk.Status.NOT_COMPLETE and result.data is None


@pytest.mark.parametrize("serializer", [sdk.serialize_json, sdk.serialize_point_csv])
def test_tiny_native_own_metadata_cannot_change_policy_with_absolute_tolerance(table, serializer):
    table[1][:] *= 1e-18
    result = run(table)
    assert result.status is sdk.Status.COMPLETE
    assert result.report.pca.flags == ()
    assert result.report.pca.gap34 > result.report.pca.tau > 0
    bad_pca = replace(result.report.pca, tau=0., gap12=0., gap23=0., gap34=0.,
        flags=("CUTOFF_NEAR_TIE", "RETAINED_AXES_NEAR_TIE"))
    bad = replace(result, report=replace(result.report, pca=bad_pca))
    encoded = serializer(bad)
    assert encoded.status is sdk.Status.INVALID_INPUT and encoded.data is None


@pytest.mark.parametrize("serializer", [sdk.serialize_json, sdk.serialize_point_csv])
def test_ordinary_unrepresentable_integer_DTO_is_input_error(constant_dto, serializer):
    scores = list(constant_dto.report.pca.scores3)
    scores[0] = (1 << 1100, 0., 0.)
    bad = replace(constant_dto, report=replace(constant_dto.report,
        pca=replace(constant_dto.report.pca, scores3=tuple(scores))))
    encoded = serializer(bad)
    assert encoded.status is sdk.Status.INVALID_INPUT and encoded.data is None


@pytest.mark.parametrize("dtype", ["i1", "i2", "i4", "i8", "u1", "u2", "u4", "u8", "f4", "f8", ">i2", ">i4", ">i8", ">u4", ">f4", ">f8"])
def test_declared_numeric_widths_support_normal_byte_orders(dtype):
    values = np.arange(32).reshape(8, 4).astype(np.dtype(dtype))
    result = sdk.analyze_projection([f"p{i}" for i in range(8)], values,
        ["a", "b", "c", "d"], sdk.ProjectionPlan(2))
    assert result.status is sdk.Status.COMPLETE
    assert result.report.input.values == tuple(tuple(float(x) for x in row) for row in values)


@pytest.mark.parametrize("mask", [False, True])
def test_ordinary_masked_arrays_are_explicitly_unsupported(mask):
    values = np.ma.array(np.arange(32.).reshape(8, 4), mask=False)
    if mask: values.mask[0, 0] = True
    result = sdk.analyze_projection([f"p{i}" for i in range(8)], values,
        ["a", "b", "c", "d"], sdk.ProjectionPlan(2))
    assert result.status is sdk.Status.INVALID_INPUT and result.report is None


@pytest.mark.parametrize("values", [np.array(1.), np.zeros(8), np.zeros((8, 4, 1)),
    np.zeros((8, 4), dtype=bool), np.zeros((8, 4), dtype=np.float16),
    np.zeros((8, 4), dtype=np.complex64), np.zeros((8, 4), dtype=object),
    np.zeros((8, 4), dtype="U2")])
def test_unsupported_array_shapes_and_dtypes_are_typed(values):
    result = sdk.analyze_projection([f"p{i}" for i in range(8)], values,
        ["a", "b", "c", "d"], sdk.ProjectionPlan(2))
    assert result.status is sdk.Status.INVALID_INPUT and result.report is None


@pytest.mark.parametrize("field,cap,reason", [("max_rows", 63, "ADMISSION_BUDGET"),
    ("max_distance_entries", 8191, "ADMISSION_BUDGET"), ("max_neighbor_slots", 639, "ADMISSION_BUDGET"),
    ("max_report_bytes", 0, "JSON_BUDGET")])
def test_lower_budget_admission_precedes_sequence_access(table, field, cap, reason):
    class Trap:
        def __len__(self): return 64
        def __getitem__(self, index): raise AssertionError("premature value access")
    result = sdk.analyze_projection(table[0], Trap(), table[2], sdk.ProjectionPlan(5),
        budget=sdk.Budget(**{field: cap}))
    assert result.status is sdk.Status.UNKNOWN_BUDGET and result.reason == reason
    assert result.report is None


def test_every_row_width_checked_before_scalar_access(table):
    class Row:
        def __init__(self, width): self.width = width
        def __len__(self): return self.width
        def __getitem__(self, index): raise AssertionError("premature scalar access")
    rows = [Row(8) for _ in range(63)] + [Row(7)]
    result = sdk.analyze_projection(table[0], rows, table[2], sdk.ProjectionPlan(5))
    assert result.status is sdk.Status.INVALID_INPUT


def test_actual_complete_JSON_admission_exact_and_one_under(table, moderate):
    size = sdk.serialize_json(moderate).required_bytes
    accepted = run(table, budget=sdk.Budget(max_rows=64, max_distance_entries=8192,
        max_neighbor_slots=640, max_report_bytes=size))
    assert accepted.status is sdk.Status.COMPLETE
    rejected = run(table, budget=sdk.Budget(max_report_bytes=size-1))
    assert rejected.status is sdk.Status.UNKNOWN_BUDGET and rejected.reason == "JSON_BUDGET"
    assert rejected.report is None


@pytest.mark.parametrize("field", ["row", "feature"])
@pytest.mark.parametrize("value,accepted", [("-A1", False), ("=1+1", False), ("+A1", False),
    ("@A1", False), ("\tA1", False), ("001", True), ("A-1", True), ("_", True)])
def test_identifier_first_character_and_numeric_string_policy(table, field, value, accepted):
    table[0 if field == "row" else 2][0] = value
    result = run(table)
    assert result.status is (sdk.Status.COMPLETE if accepted else sdk.Status.INVALID_INPUT)
    if accepted:
        assert value in (result.report.input.row_ids if field == "row" else result.report.input.feature_names)


@pytest.mark.parametrize("failure,status,reason", [(ValueError("private marker"), sdk.Status.FIT_FAILED, "FIT_VALUE_ERROR"),
    (np.linalg.LinAlgError("private marker"), sdk.Status.NUMERICALLY_INDETERMINATE, "SVD_UNRESOLVED"),
    (MemoryError("private marker"), sdk.Status.INCOMPLETE, "MEMORY_FAILURE"),
    (ImportError("private marker"), sdk.Status.INCOMPLETE, "DEPENDENCY_UNAVAILABLE"),
    (TimeoutError("private marker"), sdk.Status.INCOMPLETE, "TIMEOUT"),
    (OSError("private marker"), sdk.Status.INCOMPLETE, "IO_FAILURE"),
    (OverflowError("private marker"), sdk.Status.INCOMPLETE, "UNEXPECTED_OPERATIONAL")])
def test_narrow_native_fit_exception_taxonomy(table, monkeypatch, failure, status, reason):
    class FailingPCA(PCA):
        def fit_transform(self, X, y=None): raise failure
    monkeypatch.setattr(core, "PCA", FailingPCA)
    result = run(table)
    assert result.status is status and result.reason == reason and result.report is None
    assert "private marker" not in repr(result)


def test_threadpool_dependency_failure_is_not_swallowed(table, monkeypatch):
    @contextmanager
    def absent(**kwargs):
        raise ImportError("private marker")
        yield
    monkeypatch.setattr(core, "threadpool_limits", absent)
    result = run(table)
    assert result.status is sdk.Status.INCOMPLETE and result.reason == "DEPENDENCY_UNAVAILABLE"


@pytest.mark.parametrize("failure", [ValueError("private marker"), OverflowError("private marker")])
def test_unexpected_distance_failure_stays_operational(table, monkeypatch, failure):
    def fail(*args, **kwargs): raise failure
    monkeypatch.setattr(core, "pairwise_distances", fail)
    result = run(table)
    assert result.status is sdk.Status.INCOMPLETE and result.reason == "UNEXPECTED_OPERATIONAL"


def test_nonfinite_distance_is_numeric_result_after_real_fit(table, monkeypatch):
    def damaged(*args, **kwargs):
        result = pairwise_distances(*args, **kwargs)
        result[0, 1] = np.nan
        return result
    monkeypatch.setattr(core, "pairwise_distances", damaged)
    result = run(table)
    assert result.status is sdk.Status.NUMERICALLY_INDETERMINATE and result.reason == "NUMERIC_RESULT"


def test_wrong_native_shape_is_operational_and_own_fsum_overflow_is_numeric(table, monkeypatch):
    calls = []
    class WrongShape(PCA):
        def fit_transform(self, X, y=None):
            calls.append("shape")
            return super().fit_transform(X, y=y)[:, :2]
    monkeypatch.setattr(core, "PCA", WrongShape)
    result = run(table)
    assert result.status is sdk.Status.INCOMPLETE and result.reason == "UNEXPECTED_OPERATIONAL"
    class FiniteHugeSpectrum(PCA):
        def fit_transform(self, X, y=None):
            output = super().fit_transform(X, y=y)
            calls.append("spectrum")
            self.singular_values_[:] = 1e154
            return output
    monkeypatch.setattr(core, "PCA", FiniteHugeSpectrum)
    result = run(table)
    assert result.status is sdk.Status.NUMERICALLY_INDETERMINATE and result.reason == "NUMERIC_RESULT"
    assert calls == ["shape", "spectrum"]


@pytest.mark.parametrize("serializer", [sdk.serialize_json, sdk.serialize_point_csv])
def test_public_DTO_count_rank_fraction_nullability_corruption(moderate, constant_dto, serializer):
    report = moderate.report
    r0 = report.neighborhood.receipts[0]
    rel0 = r0.relations[0]
    malformed = [
        replace(report, work=replace(report.work, fit_count=True)),
        replace(report, plan=sdk.ProjectionPlan(True)),
        replace(report, neighborhood=replace(report.neighborhood, total_penalty=report.neighborhood.total_penalty+1)),
        replace(report, neighborhood=replace(report.neighborhood, trustworthiness_fraction=dto.FractionValue(1, 2))),
        replace(report, neighborhood=replace(report.neighborhood, receipts=(replace(r0, retained_count=True),)+report.neighborhood.receipts[1:])),
        replace(report, neighborhood=replace(report.neighborhood, receipts=(replace(r0, relations=(replace(rel0, input_rank=True),)+r0.relations[1:]),)+report.neighborhood.receipts[1:])),
        replace(constant_dto.report, neighborhood=replace(constant_dto.report.neighborhood, total_penalty=0)),
    ]
    for bad in malformed:
        result = serializer(sdk.ProjectionResult(sdk.Status.COMPLETE, None, bad))
        assert result.status is sdk.Status.INVALID_INPUT and result.data is None
    wire = json.loads(sdk.serialize_json(moderate).data)
    wire["neighborhood"]["trustworthiness_fraction"]["approximation"] = .98
    with pytest.raises(ValueError): dto.ProjectionReport.from_dict(wire)
