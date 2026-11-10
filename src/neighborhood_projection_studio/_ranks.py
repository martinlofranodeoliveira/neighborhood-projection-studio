"""Internal exact neighbor ranking, union receipt construction, and fraction reduction kernel."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from fractions import Fraction
import math
from typing import Any

from .types import (
    FractionValue,
    NeighborRelation,
    NeighborhoodSection,
    RowReceipt,
)

BLOCK_ROWS: int = 128


def _clean_zero(val: float) -> float:
    return 0.0 if val == 0.0 else val


def assemble_row_receipt(
    row_index: int,
    row_ids: Sequence[str],
    in_order_non_self: Sequence[int],
    proj_order_non_self: Sequence[int],
    in_ranks_by_index: Sequence[int],
    proj_ranks_by_index: Sequence[int],
    in_dists_row: Sequence[float],
    proj_dists_row: Sequence[float],
    k: int,
) -> RowReceipt:
    """Build one canonical RowReceipt from pre-ranked neighbor index lists."""
    in_top_indices = tuple(int(idx) for idx in in_order_non_self[:k])
    proj_top_indices = tuple(int(idx) for idx in proj_order_non_self[:k])

    in_top_set = set(in_top_indices)
    proj_top_set = set(proj_top_indices)

    # Because row_ids are sorted in ascending ASCII order, sorting member indices
    # in ascending order produces the exact ascending ASCII ID order.
    union_indices = sorted(in_top_set | proj_top_set, key=lambda idx: row_ids[idx])

    relations: list[NeighborRelation] = []
    retained_count = 0
    row_penalty = 0

    for member_idx in union_indices:
        in_rank = int(in_ranks_by_index[member_idx])
        proj_rank = int(proj_ranks_by_index[member_idx])
        in_n = member_idx in in_top_set
        proj_n = member_idx in proj_top_set

        if in_n and proj_n:
            category = "RETAINED"
            pen = 0
            retained_count += 1
        elif in_n:
            category = "LOST"
            pen = 0
        else:
            category = "INTRODUCED"
            pen = in_rank - k
            row_penalty += pen

        in_dist = _clean_zero(float(in_dists_row[member_idx]))
        proj_dist = _clean_zero(float(proj_dists_row[member_idx]))
        relations.append(
            NeighborRelation(
                id=row_ids[member_idx],
                input_rank=in_rank,
                projected_rank=proj_rank,
                category=category,
                penalty=pen,
                input_distance=in_dist,
                projected_distance=proj_dist,
            )
        )

    return RowReceipt(
        id=row_ids[row_index],
        input_neighbors=tuple(row_ids[idx] for idx in in_top_indices),
        projected_neighbors=tuple(row_ids[idx] for idx in proj_top_indices),
        retained_count=retained_count,
        penalty=row_penalty,
        relations=tuple(relations),
    )


def rank_single_row_from_distances(
    row_index: int,
    row_ids: Sequence[str],
    input_distances: Sequence[float | int],
    projected_distances: Sequence[float | int],
    k: int,
) -> RowReceipt:
    """Rank all non-self observations for one row using exact (distance, ASCII ID) order."""
    n = len(row_ids)
    other_indices = [j for j in range(n) if j != row_index]

    in_order = sorted(other_indices, key=lambda j: (input_distances[j], row_ids[j]))
    proj_order = sorted(other_indices, key=lambda j: (projected_distances[j], row_ids[j]))

    in_ranks = [0] * n
    proj_ranks = [0] * n
    for rank_pos, idx in enumerate(in_order, start=1):
        in_ranks[idx] = rank_pos
    for rank_pos, idx in enumerate(proj_order, start=1):
        proj_ranks[idx] = rank_pos

    return assemble_row_receipt(
        row_index=row_index,
        row_ids=row_ids,
        in_order_non_self=in_order,
        proj_order_non_self=proj_order,
        in_ranks_by_index=in_ranks,
        proj_ranks_by_index=proj_ranks,
        in_dists_row=[float(x) for x in input_distances],
        proj_dists_row=[float(x) for x in projected_distances],
        k=k,
    )


def summarize_receipts(
    receipts: Sequence[RowReceipt],
    n: int,
    k: int,
) -> tuple[FractionValue, FractionValue, int, int]:
    """Recompute global reduced trustworthiness and retention fractions from row receipts."""
    total_penalty = sum(int(r.penalty) for r in receipts)
    total_retained = sum(int(r.retained_count) for r in receipts)

    tw_denom_raw = n * k * (2 * n - 3 * k - 1)
    tw_numer_raw = tw_denom_raw - 2 * total_penalty
    tw_frac = Fraction(tw_numer_raw, tw_denom_raw)

    ret_frac = Fraction(total_retained, n * k)

    return (
        FractionValue(numerator=int(tw_frac.numerator), denominator=int(tw_frac.denominator)),
        FractionValue(numerator=int(ret_frac.numerator), denominator=int(ret_frac.denominator)),
        total_penalty,
        total_retained,
    )


def evaluate_literal_projection_ranks(
    row_ids: Sequence[str],
    input_coords: Sequence[Sequence[int | float]],
    projected_coords: Sequence[Sequence[int | float]],
    k: int,
    *,
    use_squared_distances: bool = True,
) -> NeighborhoodSection:
    """Evaluate the rank and receipt kernel directly on literal coordinates without PCA."""
    n = len(row_ids)
    if len(input_coords) != n or len(projected_coords) != n:
        raise ValueError("Coordinate length mismatch")
    if k < 1 or k > min(16, (n - 1) // 2):
        raise ValueError("Invalid k for literal rank evaluation")

    # Canonically sort by ASCII row_id
    perm = sorted(range(n), key=lambda i: row_ids[i])
    canon_ids = tuple(row_ids[i] for i in perm)
    canon_in = [tuple(input_coords[i]) for i in perm]
    canon_proj = [tuple(projected_coords[i]) for i in perm]

    receipts: list[RowReceipt] = []
    for i in range(n):
        in_dists: list[float | int] = []
        proj_dists: list[float | int] = []
        xi = canon_in[i]
        zi = canon_proj[i]
        for j in range(n):
            if i == j:
                in_dists.append(0)
                proj_dists.append(0)
                continue
            xj = canon_in[j]
            zj = canon_proj[j]
            d_in_sq = sum((a - b) * (a - b) for a, b in zip(xi, xj, strict=True))
            d_proj_sq = sum((a - b) * (a - b) for a, b in zip(zi, zj, strict=True))
            if use_squared_distances:
                in_dists.append(d_in_sq)
                proj_dists.append(d_proj_sq)
            else:
                in_dists.append(math.sqrt(float(d_in_sq)))
                proj_dists.append(math.sqrt(float(d_proj_sq)))

        receipts.append(
            rank_single_row_from_distances(
                row_index=i,
                row_ids=canon_ids,
                input_distances=in_dists,
                projected_distances=proj_dists,
                k=k,
            )
        )

    tw_frac, ret_frac, total_penalty, total_retained = summarize_receipts(receipts, n, k)
    return NeighborhoodSection(
        state="AVAILABLE",
        k=k,
        trustworthiness_fraction=tw_frac,
        retention_fraction=ret_frac,
        total_penalty=total_penalty,
        total_retained=total_retained,
        receipts=tuple(receipts),
    )


class NonFiniteDistanceError(Exception):
    """Raised when pairwise distances contain negative or nonfinite numbers."""


def compute_block_neighborhood(
    input_mat: Any,
    scores3_mat: Any,
    row_ids: Sequence[str],
    k: int,
    pairwise_distances_fn: Callable[..., Any],
    np_mod: Any,
    block_size: int = BLOCK_ROWS,
) -> tuple[NeighborhoodSection, int]:
    """Compute exact neighborhood receipts in bounded row blocks of at most 128 rows."""
    n = len(row_ids)
    actual_distance_entries = 0
    receipts: list[RowReceipt] = []

    in_rank_scratch = np_mod.empty(n, dtype=np_mod.int64)
    proj_rank_scratch = np_mod.empty(n, dtype=np_mod.int64)
    rank_positions = np_mod.arange(1, n + 1, dtype=np_mod.int64)

    for start in range(0, n, block_size):
        end = min(start + block_size, n)
        b_rows = end - start

        d_in_raw = pairwise_distances_fn(
            input_mat[start:end],
            input_mat,
            metric="euclidean",
            n_jobs=1,
        )
        if not isinstance(d_in_raw, np_mod.ndarray) or d_in_raw.shape != (b_rows, n):
            raise RuntimeError("Unexpected input pairwise_distances shape")
        d_in = np_mod.array(d_in_raw, dtype=np_mod.float64, copy=True, order="C")
        if not bool(np_mod.all(np_mod.isfinite(d_in))) or bool(np_mod.any(d_in < 0.0)):
            raise NonFiniteDistanceError("Nonfinite or negative input distance")
        actual_distance_entries += b_rows * n

        d_proj_raw = pairwise_distances_fn(
            scores3_mat[start:end],
            scores3_mat,
            metric="euclidean",
            n_jobs=1,
        )
        if not isinstance(d_proj_raw, np_mod.ndarray) or d_proj_raw.shape != (b_rows, n):
            raise RuntimeError("Unexpected projected pairwise_distances shape")
        d_proj = np_mod.array(d_proj_raw, dtype=np_mod.float64, copy=True, order="C")
        if not bool(np_mod.all(np_mod.isfinite(d_proj))) or bool(np_mod.any(d_proj < 0.0)):
            raise NonFiniteDistanceError("Nonfinite or negative projected distance")
        actual_distance_entries += b_rows * n

        # Mask self index with +inf so stable argsort places self at position n - 1
        # while preserving canonical ASCII index order on ties.
        d_in_sort = d_in.copy()
        d_proj_sort = d_proj.copy()
        for local_i in range(b_rows):
            global_i = start + local_i
            d_in_sort[local_i, global_i] = np_mod.inf
            d_proj_sort[local_i, global_i] = np_mod.inf

        in_order_block = np_mod.argsort(d_in_sort, axis=1, kind="stable")
        proj_order_block = np_mod.argsort(d_proj_sort, axis=1, kind="stable")

        for local_i in range(b_rows):
            global_i = start + local_i
            in_row_order = in_order_block[local_i]
            proj_row_order = proj_order_block[local_i]

            in_rank_scratch[in_row_order] = rank_positions
            proj_rank_scratch[proj_row_order] = rank_positions

            receipts.append(
                assemble_row_receipt(
                    row_index=global_i,
                    row_ids=row_ids,
                    in_order_non_self=in_row_order[: n - 1],
                    proj_order_non_self=proj_row_order[: n - 1],
                    in_ranks_by_index=in_rank_scratch,
                    proj_ranks_by_index=proj_rank_scratch,
                    in_dists_row=d_in[local_i],
                    proj_dists_row=d_proj[local_i],
                    k=k,
                )
            )

    tw_frac, ret_frac, total_penalty, total_retained = summarize_receipts(receipts, n, k)
    section = NeighborhoodSection(
        state="AVAILABLE",
        k=k,
        trustworthiness_fraction=tw_frac,
        retention_fraction=ret_frac,
        total_penalty=total_penalty,
        total_retained=total_retained,
        receipts=tuple(receipts),
    )
    return section, actual_distance_entries
