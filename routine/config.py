"""Read the user's configuration files (TOML, in <data>/config/)."""
from __future__ import annotations

import tomllib
from pathlib import Path

from . import paths

FIELD_KINDS = {"buttons", "yesno", "text"}


class ConfigError(ValueError):
    """A configuration file is missing or invalid."""


def _load(root: Path, name: str) -> dict:
    path = paths.config_dir(root) / name
    if not path.exists():
        raise ConfigError(f"missing config file: {path}")
    try:
        with path.open("rb") as fh:
            return tomllib.load(fh)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"invalid TOML in {path}: {exc}") from exc


def done_fields(root: Path) -> list[dict]:
    """The fields of the done step (D52), validated."""
    fields = _load(root, "done_fields.toml").get("field", [])
    if not fields:
        raise ConfigError("done_fields.toml defines no [[field]]")
    seen = set()
    for f in fields:
        fid, kind = f.get("id"), f.get("kind")
        if not fid or fid in seen:
            raise ConfigError(f"each field needs a unique id: {fid!r}")
        if kind not in FIELD_KINDS:
            raise ConfigError(f"field {fid}: kind must be one of {sorted(FIELD_KINDS)}")
        if kind == "buttons" and not f.get("options"):
            raise ConfigError(f"field {fid}: buttons need options")
        seen.add(fid)
    return fields


# Settings the user may change in <data>/config/routine.toml; the file is optional.
SETTINGS_DEFAULTS = {"idle_pause_minutes": 20}   # D59; 0 turns the automatic pause off


def settings(root: Path) -> dict:
    """routine.toml merged over the defaults. A missing file means the defaults."""
    path = paths.config_dir(root) / "routine.toml"
    raw = _load(root, "routine.toml") if path.exists() else {}
    unknown = sorted(set(raw) - set(SETTINGS_DEFAULTS))
    if unknown:
        raise ConfigError(f"unknown settings in routine.toml: {', '.join(unknown)}")
    out = {**SETTINGS_DEFAULTS, **raw}
    m = out["idle_pause_minutes"]
    if not isinstance(m, int) or isinstance(m, bool) or m < 0:
        raise ConfigError("idle_pause_minutes must be a whole number of minutes, 0 or more")
    return out
