"""Frozen public data transfer objects and status enumerations."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class Status(StrEnum):
    """Operation and serialization terminal status codes."""

    COMPLETE = "COMPLETE"
    INVALID_INPUT = "INVALID_INPUT"
    NOT_COMPLETE = "NOT_COMPLETE"
    UNKNOWN_BUDGET = "UNKNOWN_BUDGET"
    FIT_FAILED = "FIT_FAILED"
    NUMERICALLY_INDETERMINATE = "NUMERICALLY_INDETERMINATE"
    INCOMPLETE = "INCOMPLETE"


class _WireMappingMixin:
    """Read-only mapping access to frozen DTO fields using wire property names."""

    _WIRE_FIELD_MAP: dict[str, str] = {}

    def _field_map(self) -> dict[str, str]:
        if self._WIRE_FIELD_MAP:
            return self._WIRE_FIELD_MAP
        return {name: name for name in self.__dataclass_fields__}  # type: ignore[attr-defined]

    def keys(self) -> tuple[str, ...]:
        return tuple(self._field_map().keys())

    def __iter__(self) -> Iterator[str]:
        return iter(self._field_map().keys())

    def __len__(self) -> int:
        return len(self._field_map())

    def __getitem__(self, key: str) -> Any:
        fmap = self._field_map()
        if key not in fmap:
            raise KeyError(key)
        return getattr(self, fmap[key])


@dataclass(frozen=True)
class ProjectionPlan(_WireMappingMixin):
    """Passive frozen neighborhood analysis plan."""

    k: int


@dataclass(frozen=True)
class Budget(_WireMappingMixin):
    """Passive frozen admission and report size caps."""

    max_rows: int = 4096
    max_distance_entries: int = 33554432
    max_neighbor_slots: int = 131072
    max_report_bytes: int = 16777216


@dataclass(frozen=True)
class ProducerInfo(_WireMappingMixin):
    """Report producer metadata."""

    package: str = "neighborhood-projection-studio"
    version: str = "0.1.0"


@dataclass(frozen=True)
class InputSection(_WireMappingMixin):
    """Canonicalized admitted input dataset section."""

    row_ids: tuple[str, ...]
    feature_names: tuple[str, ...]
    values: tuple[tuple[float, ...], ...]
    digest_sha256: str
    canonical_order: str = "ASCII_ID"
    unit_policy: str = "UNSCALED_INPUT"


@dataclass(frozen=True)
class FitParams(_WireMappingMixin):
    """Fixed maintained PCA estimator parameters."""

    n_components: None = None
    svd_solver: str = "full"
    whiten: bool = False
    copy: bool = True


@dataclass(frozen=True)
class FitVersions(_WireMappingMixin):
    """Observed runtime package versions."""

    python: str
    numpy: str
    scipy: str
    scikit_learn: str
    threadpoolctl: str

    _WIRE_FIELD_MAP = {
        "python": "python",
        "numpy": "numpy",
        "scipy": "scipy",
        "scikit-learn": "scikit_learn",
        "threadpoolctl": "threadpoolctl",
    }


@dataclass(frozen=True)
class FitReceipt(_WireMappingMixin):
    """Maintained PCA execution receipt."""

    estimator: str
    params: FitParams
    versions: FitVersions
    native_threads: int = 1


@dataclass(frozen=True)
class PcaSection(_WireMappingMixin):
    """Observed PCA coordinates, spectrum, and degeneracy screening facts."""

    scores3: tuple[tuple[float, ...], ...]
    mean: tuple[float, ...]
    components3: tuple[tuple[float, ...], ...]
    singular_values: tuple[float, ...]
    tau: float
    rank_screen_count: int
    gap12: float
    gap23: float
    gap34: float
    flags: tuple[str, ...]
    signal_state: str
    retained_variance_fraction: float | None
    fit_receipt: FitReceipt


@dataclass(frozen=True)
class FractionValue(_WireMappingMixin):
    """Exact reduced rational number without floating approximation field."""

    numerator: int
    denominator: int


@dataclass(frozen=True)
class NeighborRelation(_WireMappingMixin):
    """Per-neighbor union membership record for a single observation."""

    id: str
    input_rank: int
    projected_rank: int
    category: str
    penalty: int
    input_distance: float
    projected_distance: float


@dataclass(frozen=True)
class RowReceipt(_WireMappingMixin):
    """Per-observation neighborhood comparison receipt."""

    id: str
    input_neighbors: tuple[str, ...]
    projected_neighbors: tuple[str, ...]
    retained_count: int
    penalty: int
    relations: tuple[NeighborRelation, ...]


@dataclass(frozen=True)
class NeighborhoodSection(_WireMappingMixin):
    """Global and per-row neighborhood preservation metrics."""

    state: str
    k: int
    trustworthiness_fraction: FractionValue | None
    retention_fraction: FractionValue | None
    total_penalty: int | None
    total_retained: int | None
    receipts: tuple[RowReceipt, ...]


@dataclass(frozen=True)
class WorkSection(_WireMappingMixin):
    """Planned admission bounds and actual work counters."""

    planned_distance_entries: int
    planned_neighbor_slots: int
    actual_distance_entries: int
    fit_count: int = 1


@dataclass(frozen=True)
class ProjectionReport(_WireMappingMixin):
    """Complete detached immutable neighborhood projection study report."""

    schema: str
    producer: ProducerInfo
    input: InputSection
    plan: ProjectionPlan
    pca: PcaSection
    neighborhood: NeighborhoodSection
    work: WorkSection

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ProjectionReport:
        """Construct a frozen ProjectionReport from a wire-compatible mapping."""
        if not isinstance(data, Mapping) or set(data.keys()) != {
            "schema",
            "producer",
            "input",
            "plan",
            "pca",
            "neighborhood",
            "work",
        }:
            raise ValueError("Invalid top-level report keys")

        prod_raw = data["producer"]
        if not isinstance(prod_raw, Mapping) or set(prod_raw.keys()) != {"package", "version"}:
            raise ValueError("Invalid producer section")
        producer = ProducerInfo(package=prod_raw["package"], version=prod_raw["version"])

        inp_raw = data["input"]
        if not isinstance(inp_raw, Mapping) or set(inp_raw.keys()) != {
            "row_ids",
            "feature_names",
            "values",
            "digest_sha256",
            "canonical_order",
            "unit_policy",
        }:
            raise ValueError("Invalid input section")
        input_sec = InputSection(
            row_ids=tuple(inp_raw["row_ids"]),
            feature_names=tuple(inp_raw["feature_names"]),
            values=tuple(tuple(r) for r in inp_raw["values"]),
            digest_sha256=inp_raw["digest_sha256"],
            canonical_order=inp_raw["canonical_order"],
            unit_policy=inp_raw["unit_policy"],
        )

        plan_raw = data["plan"]
        if not isinstance(plan_raw, Mapping) or set(plan_raw.keys()) != {"k"}:
            raise ValueError("Invalid plan section")
        plan_sec = ProjectionPlan(k=plan_raw["k"])

        pca_raw = data["pca"]
        if not isinstance(pca_raw, Mapping) or set(pca_raw.keys()) != {
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
        }:
            raise ValueError("Invalid pca section")
        fr_raw = pca_raw["fit_receipt"]
        if not isinstance(fr_raw, Mapping) or set(fr_raw.keys()) != {
            "estimator",
            "params",
            "versions",
            "native_threads",
        }:
            raise ValueError("Invalid fit_receipt section")
        fp_raw = fr_raw["params"]
        if not isinstance(fp_raw, Mapping) or set(fp_raw.keys()) != {
            "n_components",
            "svd_solver",
            "whiten",
            "copy",
        }:
            raise ValueError("Invalid fit_receipt.params section")
        fv_raw = fr_raw["versions"]
        if not isinstance(fv_raw, Mapping) or set(fv_raw.keys()) != {
            "python",
            "numpy",
            "scipy",
            "scikit-learn",
            "threadpoolctl",
        }:
            raise ValueError("Invalid fit_receipt.versions section")
        fit_receipt = FitReceipt(
            estimator=fr_raw["estimator"],
            params=FitParams(
                n_components=fp_raw["n_components"],
                svd_solver=fp_raw["svd_solver"],
                whiten=fp_raw["whiten"],
                copy=fp_raw["copy"],
            ),
            versions=FitVersions(
                python=fv_raw["python"],
                numpy=fv_raw["numpy"],
                scipy=fv_raw["scipy"],
                scikit_learn=fv_raw["scikit-learn"],
                threadpoolctl=fv_raw["threadpoolctl"],
            ),
            native_threads=fr_raw["native_threads"],
        )
        pca_sec = PcaSection(
            scores3=tuple(tuple(r) for r in pca_raw["scores3"]),
            mean=tuple(pca_raw["mean"]),
            components3=tuple(tuple(r) for r in pca_raw["components3"]),
            singular_values=tuple(pca_raw["singular_values"]),
            tau=pca_raw["tau"],
            rank_screen_count=pca_raw["rank_screen_count"],
            gap12=pca_raw["gap12"],
            gap23=pca_raw["gap23"],
            gap34=pca_raw["gap34"],
            flags=tuple(pca_raw["flags"]),
            signal_state=pca_raw["signal_state"],
            retained_variance_fraction=pca_raw["retained_variance_fraction"],
            fit_receipt=fit_receipt,
        )

        nb_raw = data["neighborhood"]
        if not isinstance(nb_raw, Mapping) or set(nb_raw.keys()) != {
            "state",
            "k",
            "trustworthiness_fraction",
            "retention_fraction",
            "total_penalty",
            "total_retained",
            "receipts",
        }:
            raise ValueError("Invalid neighborhood section")

        def _parse_frac(f_raw: Any) -> FractionValue | None:
            if f_raw is None:
                return None
            if not isinstance(f_raw, Mapping) or set(f_raw.keys()) != {"numerator", "denominator"}:
                raise ValueError("Invalid fraction object keys")
            return FractionValue(numerator=f_raw["numerator"], denominator=f_raw["denominator"])

        receipts_list: list[RowReceipt] = []
        for r_raw in nb_raw["receipts"]:
            if not isinstance(r_raw, Mapping) or set(r_raw.keys()) != {
                "id",
                "input_neighbors",
                "projected_neighbors",
                "retained_count",
                "penalty",
                "relations",
            }:
                raise ValueError("Invalid row receipt keys")
            rels_list: list[NeighborRelation] = []
            for rel_raw in r_raw["relations"]:
                if not isinstance(rel_raw, Mapping) or set(rel_raw.keys()) != {
                    "id",
                    "input_rank",
                    "projected_rank",
                    "category",
                    "penalty",
                    "input_distance",
                    "projected_distance",
                }:
                    raise ValueError("Invalid relation keys")
                rels_list.append(
                    NeighborRelation(
                        id=rel_raw["id"],
                        input_rank=rel_raw["input_rank"],
                        projected_rank=rel_raw["projected_rank"],
                        category=rel_raw["category"],
                        penalty=rel_raw["penalty"],
                        input_distance=rel_raw["input_distance"],
                        projected_distance=rel_raw["projected_distance"],
                    )
                )
            receipts_list.append(
                RowReceipt(
                    id=r_raw["id"],
                    input_neighbors=tuple(r_raw["input_neighbors"]),
                    projected_neighbors=tuple(r_raw["projected_neighbors"]),
                    retained_count=r_raw["retained_count"],
                    penalty=r_raw["penalty"],
                    relations=tuple(rels_list),
                )
            )

        nb_sec = NeighborhoodSection(
            state=nb_raw["state"],
            k=nb_raw["k"],
            trustworthiness_fraction=_parse_frac(nb_raw["trustworthiness_fraction"]),
            retention_fraction=_parse_frac(nb_raw["retention_fraction"]),
            total_penalty=nb_raw["total_penalty"],
            total_retained=nb_raw["total_retained"],
            receipts=tuple(receipts_list),
        )

        work_raw = data["work"]
        if not isinstance(work_raw, Mapping) or set(work_raw.keys()) != {
            "planned_distance_entries",
            "planned_neighbor_slots",
            "actual_distance_entries",
            "fit_count",
        }:
            raise ValueError("Invalid work section")
        work_sec = WorkSection(
            planned_distance_entries=work_raw["planned_distance_entries"],
            planned_neighbor_slots=work_raw["planned_neighbor_slots"],
            actual_distance_entries=work_raw["actual_distance_entries"],
            fit_count=work_raw["fit_count"],
        )

        return cls(
            schema=data["schema"],
            producer=producer,
            input=input_sec,
            plan=plan_sec,
            pca=pca_sec,
            neighborhood=nb_sec,
            work=work_sec,
        )


@dataclass(frozen=True)
class ProjectionResult:
    """Typed outcome of analyze_projection."""

    status: Status
    reason: str | None
    report: ProjectionReport | None


@dataclass(frozen=True)
class EncodedReport:
    """Typed outcome of serialize_json and serialize_point_csv."""

    status: Status
    reason: str | None
    data: bytes | None
    required_bytes: int | None
