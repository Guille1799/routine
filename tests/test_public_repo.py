"""The repository is public: nothing private may be committed (R2).

The list of private terms is itself private, so it lives in the data folder
(`config/private_terms.txt`, one term per line), never in this repository. Without a data
folder the term check is skipped, but the personal-path check always runs.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PERSONAL_PATH = re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+|/home/[a-z][\w-]*/", re.I)


def tracked_files() -> list[Path]:
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=ROOT, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    return [ROOT / f for f in out.stdout.splitlines() if f]


def private_terms() -> list[str]:
    data = os.environ.get("ROUTINE_DATA_DIR")
    terms = Path(data, "config", "private_terms.txt") if data else None
    if not terms or not terms.exists():
        return []
    return [t.strip() for t in terms.read_text(encoding="utf-8").splitlines()
            if t.strip() and not t.startswith("#")]


def test_r2_no_private_terms_or_paths():
    terms = private_terms()
    hits = []
    for f in tracked_files():
        if f.suffix in {".png", ".jpg", ".gif", ".woff2"} or not f.is_file():
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        if PERSONAL_PATH.search(text):
            hits.append(f"{f.relative_to(ROOT)}: personal path")
        for term in terms:
            if re.search(rf"\b{re.escape(term)}\b", text, re.I):
                hits.append(f"{f.relative_to(ROOT)}: private term")
    assert not hits, hits
    if not terms:
        pytest.skip("no private_terms.txt in the data folder: only personal paths were checked")
