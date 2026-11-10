"""Bounded local JSON input and complete-output adapters for the accepted SDK."""
from __future__ import annotations

import argparse
from fractions import Fraction
import json
import math
import os
import re
import stat
import sys

from . import Budget, ProjectionPlan, Status, analyze_projection, serialize_json, serialize_point_csv

MAX_INPUT_BYTES = 4194304
MAX_OUTPUT_BYTES = 16777216
INPUT_SCHEMA = "neighborhood-projection-input/1"
PROGRAM = "neighborhood-projection-studio"
VERSION = "0.1.0"
_BUDGET_KEYS = frozenset({"max_rows", "max_distance_entries", "max_neighbor_slots", "max_report_bytes"})
_EXIT_CODES = {"INVALID_INPUT": 2, "UNKNOWN_BUDGET": 3, "FIT_FAILED": 4,
               "NUMERICALLY_INDETERMINATE": 5, "INCOMPLETE": 4}
_REASONS = frozenset({"INPUT_SCHEMA", "PLAN_K", "ADMISSION_BUDGET", "JSON_BUDGET", "CSV_BUDGET",
    "SOURCE_NOT_COMPLETE", "FIT_VALUE_ERROR", "SVD_UNRESOLVED", "NUMERIC_RESULT", "MEMORY_FAILURE",
    "DEPENDENCY_UNAVAILABLE", "IO_FAILURE", "TIMEOUT", "UNEXPECTED_OPERATIONAL", "INPUT_BYTES",
    "INPUT_JSON", "CLI_USAGE", "INPUT_IO", "OUTPUT_IO", "DEMO_ASSERTION"})


class InputFailure(Exception):
    def __init__(self, status, reason):
        self.status, self.reason = status, reason


class OutputFailure(Exception):
    pass


class UsageFailure(Exception):
    pass


class ParserExit(Exception):
    def __init__(self, status):
        self.status = status


class Parser(argparse.ArgumentParser):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("allow_abbrev", False)
        super().__init__(*args, **kwargs)

    def error(self, message):
        # argparse's message can contain caller paths/values; expose a fixed code.
        raise UsageFailure()

    def _print_message(self, message, file=None):
        if message:
            stream = file if file is not None else sys.stderr
            try:
                stream.write(message)
                stream.flush()
            except (OSError, ValueError, TypeError, AttributeError):
                _quiet_failed_stream(stream)
                raise OutputFailure() from None

    def exit(self, status=0, message=None):
        if message:
            self._print_message(message, sys.stderr)
        raise ParserExit(status)


def _quiet_failed_stream(stream):
    """Only silence the already-failed standard FD, preventing finalizer exit120."""
    try:
        failed = stream.fileno()
        if type(failed) is not int or failed not in (1, 2):
            return
        owned = os.open(os.devnull, os.O_WRONLY | os.O_CLOEXEC)
        try:
            os.dup2(owned, failed)
        finally:
            if owned != failed:
                os.close(owned)
    except (AttributeError, OSError, ValueError):
        pass


def _binary_stream(name):
    stream = getattr(sys, name, None)
    binary = getattr(stream, "buffer", None)
    if binary is None:
        if name == "stdin":
            raise InputFailure("INCOMPLETE", "INPUT_IO")
        raise OutputFailure()
    return binary


def _read_input(name):
    if name == "-":
        try:
            stream = _binary_stream("stdin")
            raw = bytearray()
            while len(raw) <= MAX_INPUT_BYTES:
                part = stream.read(min(65536, MAX_INPUT_BYTES + 1 - len(raw)))
                if type(part) is not bytes:
                    raise InputFailure("INCOMPLETE", "INPUT_IO")
                if not part:
                    return bytes(raw)
                raw.extend(part)
            raise InputFailure("UNKNOWN_BUDGET", "INPUT_BYTES")
        except (OSError, ValueError):
            raise InputFailure("INCOMPLETE", "INPUT_IO") from None

    def snapshot(metadata):
        return (metadata.st_dev, metadata.st_ino, metadata.st_size,
                metadata.st_mtime_ns, metadata.st_ctime_ns)

    try:
        fd = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            before = os.fstat(fd)
            leaf_before = os.stat(name, follow_symlinks=False)
            if not stat.S_ISREG(before.st_mode) or not stat.S_ISREG(leaf_before.st_mode):
                raise InputFailure("INCOMPLETE", "INPUT_IO")
            if snapshot(before) != snapshot(leaf_before):
                raise InputFailure("INCOMPLETE", "INPUT_IO")
            if before.st_size > MAX_INPUT_BYTES:
                raise InputFailure("UNKNOWN_BUDGET", "INPUT_BYTES")
            raw = bytearray()
            while len(raw) <= MAX_INPUT_BYTES:
                part = os.read(fd, min(65536, MAX_INPUT_BYTES + 1 - len(raw)))
                if not part:
                    break
                raw.extend(part)
            if len(raw) > MAX_INPUT_BYTES:
                raise InputFailure("UNKNOWN_BUDGET", "INPUT_BYTES")
            after = os.fstat(fd)
            leaf_after = os.stat(name, follow_symlinks=False)
            if (not stat.S_ISREG(leaf_after.st_mode)
                    or snapshot(before) != snapshot(after)
                    or snapshot(before) != snapshot(leaf_after)
                    or len(raw) != before.st_size):
                raise InputFailure("INCOMPLETE", "INPUT_IO")
            return bytes(raw)
        finally:
            os.close(fd)
    except (OSError, ValueError):
        raise InputFailure("INCOMPLETE", "INPUT_IO") from None


def _decode(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    def finite(token):
        value = float(token)
        if not math.isfinite(value):
            raise ValueError("nonfinite JSON number")
        return value

    def constant(token):
        raise ValueError("nonfinite JSON constant")

    try:
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=unique,
                          parse_float=finite, parse_constant=constant)
    except (UnicodeError, ValueError, RecursionError):
        raise InputFailure("INVALID_INPUT", "INPUT_JSON") from None
    required = {"schema", "row_ids", "feature_names", "values", "plan"}
    if (type(data) is not dict or not required <= data.keys()
            or data.keys() - (required | {"budget"})
            or data["schema"] != INPUT_SCHEMA
            or type(data["row_ids"]) is not list
            or type(data["feature_names"]) is not list
            or type(data["values"]) is not list):
        raise InputFailure("INVALID_INPUT", "INPUT_SCHEMA")
    plan = data["plan"]
    budget = data.get("budget", {})
    if type(plan) is not dict or set(plan) != {"k"}:
        raise InputFailure("INVALID_INPUT", "INPUT_SCHEMA")
    if type(budget) is not dict or budget.keys() - _BUDGET_KEYS:
        raise InputFailure("INVALID_INPUT", "INPUT_SCHEMA")
    # The core owns counts, identifiers, scalar types, bounds and metadata rules.
    return (data["row_ids"], data["values"], data["feature_names"],
            ProjectionPlan(k=plan["k"]), Budget(**budget))


def _demo():
    import numpy as np
    return ([f"p{i:04d}" for i in range(64)],
            np.random.default_rng(42).normal(size=(64, 8)) * np.arange(1, 9),
            [f"f{j}" for j in range(8)], ProjectionPlan(k=5), Budget())


def _assert_demo(result):
    """Independent scalar/Fraction receipts; explicit checks survive python -O."""
    report = result.report
    ids, original, projected = report.input.row_ids, report.input.values, report.pca.scores3
    n, k = len(ids), report.plan.k
    if n != 64 or k != 5 or len(report.neighborhood.receipts) != n:
        raise InputFailure("INCOMPLETE", "DEMO_ASSERTION")
    P = R = 0
    for i in range(n):
        def ordered(matrix):
            pairs = sorted((math.fsum((a-b)**2 for a, b in zip(matrix[i], matrix[j])), ids[j])
                           for j in range(n) if i != j)
            if any(pairs[j+1][0] - pairs[j][0] <= 1e-10 for j in range(len(pairs)-1)):
                raise InputFailure("INCOMPLETE", "DEMO_ASSERTION")
            return [id_ for _, id_ in pairs]
        input_order, output_order = ordered(original), ordered(projected)
        ranks = {id_: rank for rank, id_ in enumerate(input_order, 1)}
        penalty = sum(max(0, ranks[id_] - k) for id_ in output_order[:k])
        retained = len(set(input_order[:k]) & set(output_order[:k]))
        receipt = report.neighborhood.receipts[i]
        if (receipt.id != ids[i] or receipt.input_neighbors != tuple(input_order[:k])
                or receipt.projected_neighbors != tuple(output_order[:k])
                or receipt.penalty != penalty or receipt.retained_count != retained):
            raise InputFailure("INCOMPLETE", "DEMO_ASSERTION")
        P += penalty
        R += retained
    trust = 1 - Fraction(2*P, n*k*(2*n-3*k-1))
    retained = Fraction(R, n*k)
    actual_t, actual_r = report.neighborhood.trustworthiness_fraction, report.neighborhood.retention_fraction
    if (report.neighborhood.total_penalty != P or report.neighborhood.total_retained != R
            or trust != Fraction(115, 128)
            or (actual_t.numerator, actual_t.denominator) != (trust.numerator, trust.denominator)
            or (actual_r.numerator, actual_r.denominator) != (retained.numerator, retained.denominator)):
        raise InputFailure("INCOMPLETE", "DEMO_ASSERTION")


def _cap(value):
    if not re.fullmatch(r"0|[1-9][0-9]{0,7}", value, flags=re.ASCII):
        raise UsageFailure()
    result = int(value)
    if result > MAX_OUTPUT_BYTES:
        raise UsageFailure()
    return result


def _write(stream, payload):
    try:
        view = memoryview(payload)
        while view:
            count = stream.write(view)
            if type(count) is not int or not 0 < count <= len(view):
                raise OSError("incomplete output")
            view = view[count:]
        stream.flush()
    except (OSError, ValueError, TypeError, AttributeError):
        _quiet_failed_stream(stream)
        raise OutputFailure() from None


def _error(status, reason):
    status, reason = str(status), str(reason)
    if status not in _EXIT_CODES or reason not in _REASONS:
        status, reason = "INCOMPLETE", "UNEXPECTED_OPERATIONAL"
    payload = (json.dumps({"status": status, "reason": reason, "complete": False},
                         sort_keys=True, separators=(",", ":")) + "\n").encode()
    try:
        _write(_binary_stream("stderr"), payload)
    except OutputFailure:
        pass  # Original error exit is preserved when stderr delivery also fails.
    return _EXIT_CODES[status]


def main(argv=None):
    parser = Parser(prog=PROGRAM, description="Fit bounded unscaled PCA and inspect neighborhood changes locally.")
    parser.add_argument("--version", action="version", version=f"{PROGRAM} {VERSION}")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("analyze", "demo"):
        child = commands.add_parser(name)
        child.add_argument("--format", choices=("json", "csv"), default="json")
        child.add_argument("--max-output-bytes", default=str(MAX_OUTPUT_BYTES))
        if name == "analyze":
            child.add_argument("--input", required=True, help="explicit regular local file, or - for bounded stdin")
        else:
            child.add_argument("--assert", dest="assert_demo", action="store_true")
    try:
        args = parser.parse_args(argv)
        cap = _cap(args.max_output_bytes)
        ids, values, names, plan, budget = _demo() if args.command == "demo" else _decode(_read_input(args.input))
        result = analyze_projection(ids, values, names, plan, budget=budget)
        if result.status is not Status.COMPLETE:
            return _error(result.status, result.reason)
        if args.command == "demo" and args.assert_demo:
            _assert_demo(result)
        encoded = (serialize_json if args.format == "json" else serialize_point_csv)(result, max_bytes=cap)
        if encoded.status is not Status.COMPLETE:
            return _error(encoded.status, encoded.reason)
        _write(_binary_stream("stdout"), encoded.data)
        return 0
    except ParserExit as stopped:
        return stopped.status
    except UsageFailure:
        return _error("INVALID_INPUT", "CLI_USAGE")
    except InputFailure as failure:
        return _error(failure.status, failure.reason)
    except OutputFailure:
        return _error("INCOMPLETE", "OUTPUT_IO")
    except MemoryError:
        return _error("INCOMPLETE", "MEMORY_FAILURE")
    except ImportError:
        return _error("INCOMPLETE", "DEPENDENCY_UNAVAILABLE")
    except TimeoutError:
        return _error("INCOMPLETE", "TIMEOUT")
    except Exception:
        return _error("INCOMPLETE", "UNEXPECTED_OPERATIONAL")
