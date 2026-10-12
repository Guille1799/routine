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


# What an entry command may ask for; anything else in braces is a mistake in projects.toml.
ENTRY_FIELDS = ("title", "what", "date", "project")


def projects(root: Path) -> dict[str, dict]:
    """Each project's folder and entry command (D27), from projects.toml.

    `entry` is optional: a project without one is not a valid destination, so the close
    sends its items to the holding list (D34). Placeholders are checked here, so a typo in
    the file fails when it is read, not halfway through a close.
    """
    out: dict[str, dict] = {}
    for p in _load(root, "projects.toml").get("project", []):
        pid, path = p.get("id"), p.get("path")
        if not pid or pid in out:
            raise ConfigError(f"each project needs a unique id: {pid!r}")
        if not path:
            raise ConfigError(f"project {pid}: path is missing")
        entry = p.get("entry")
        if entry is not None:
            try:
                entry.format_map({f: "" for f in ENTRY_FIELDS})
            except (KeyError, IndexError, ValueError) as exc:
                raise ConfigError(f"project {pid}: entry may use only "
                                  f"{', '.join('{' + f + '}' for f in ENTRY_FIELDS)}: {exc}") from exc
        out[pid] = {"id": pid, "path": Path(path).expanduser(), "entry": entry}
    return out
