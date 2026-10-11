"""Where the user's data lives.

The code is public and the data is private, so the data folder lives OUTSIDE this
repository (D46). Nothing here assumes a default location: if the folder cannot be
found, every command fails loudly instead of writing somewhere unexpected (R30).

Resolution order:
1. the ROUTINE_DATA_DIR environment variable;
2. `data_dir` in `routine.local.toml` at the repository root (git-ignored).
"""
from __future__ import annotations

import os
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCAL_SETTINGS = REPO_ROOT / "routine.local.toml"


class DataDirError(RuntimeError):
    """The data folder is not configured, or does not exist."""


def data_dir() -> Path:
    raw = os.environ.get("ROUTINE_DATA_DIR")
    source = "ROUTINE_DATA_DIR"
    if not raw and LOCAL_SETTINGS.exists():
        with LOCAL_SETTINGS.open("rb") as fh:
            raw = tomllib.load(fh).get("data_dir")
        source = str(LOCAL_SETTINGS)
    if not raw:
        raise DataDirError(
            "no data folder: set ROUTINE_DATA_DIR or data_dir in routine.local.toml"
        )
    path = Path(raw).expanduser().resolve()
    if not path.is_dir():
        raise DataDirError(f"data folder from {source} does not exist: {path}")
    if path == REPO_ROOT or REPO_ROOT in path.parents:
        raise DataDirError("the data folder must live outside the code repository")
    return path


def diary_file(root: Path, day: str) -> Path:
    """One append-only event file per day: diary/YYYY-MM/YYYY-MM-DD.jsonl."""
    return root / "diary" / day[:7] / f"{day}.jsonl"


def state_file(root: Path) -> Path:
    return root / "state" / "today.json"


def lock_file(root: Path) -> Path:
    return root / "state" / ".writer.lock"


def config_dir(root: Path) -> Path:
    return root / "config"
