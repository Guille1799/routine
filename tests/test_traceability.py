"""Nothing in the plan can be silently skipped.

Every decision in DESIGN.md's index must be covered by a requirement or listed with a
reason; every requirement must name a test that exists, or say which piece owns it.
"""
from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
ROOT = DOCS.parent


def design_decisions() -> set[str]:
    index = DOCS.joinpath("DESIGN.md").read_text(encoding="utf-8").split("## Decision index", 1)[1]
    return set(re.findall(r"^\| (D\d+) \|", index, flags=re.M))


def requirement_rows() -> list[tuple[str, set[str], str]]:
    rows = []
    for line in DOCS.joinpath("REQUIREMENTS.md").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\| (R\d+) \| .+? \| (D[\d, D]+) \| (.+?) \|$", line)
        if m:
            rows.append((m.group(1), set(re.findall(r"D\d+", m.group(2))), m.group(3).strip()))
    return rows


def exempt_decisions() -> set[str]:
    text = DOCS.joinpath("REQUIREMENTS.md").read_text(encoding="utf-8")
    section = text.split("## Decisions without a requirement", 1)[1].split("##", 1)[0]
    return set(re.findall(r"^- (D\d+): \S", section, flags=re.M))


def test_every_decision_is_covered_or_exempt_with_a_reason():
    covered = set().union(*(ds for _, ds, _ in requirement_rows()))
    missing = design_decisions() - covered - exempt_decisions()
    assert not missing, f"decisions with no requirement and no reason: {sorted(missing)}"


def test_requirements_only_cite_known_decisions():
    unknown = set().union(*(ds for _, ds, _ in requirement_rows())) - design_decisions()
    assert not unknown, f"requirements cite decisions not in DESIGN.md: {sorted(unknown)}"


def test_every_named_test_exists():
    for rid, _, test in requirement_rows():
        if test.startswith("pending: P"):
            continue
        path, _, func = test.partition("::")
        source = ROOT.joinpath(path)
        assert source.exists(), f"{rid}: {path} does not exist"
        assert re.search(rf"^def {re.escape(func)}\(", source.read_text(encoding="utf-8"), re.M), \
            f"{rid}: {func} not found in {path}"
