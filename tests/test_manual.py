"""The manual covers everything a user can call (R48, D71).

Each list is read from the code, never written here: the writer's actions and options (from
the parser `cli.main` builds), the event types (`events.TYPES`), the install commands (from
the parser `routine.install.main` builds), the `routine` tool's actions and the slash
commands (from `mod/hooks/register.tsx`), the done field kinds and the settings (from
`routine/config.py`). Each one must have a row, or for event types and install commands a
mention, in its section of `docs/MANUAL.md`, so adding one without documenting it fails here.

The extractors are calibrated by the tests at the end: they must find members we know
exist, and the check must report a name the manual does not have.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path
from unittest import mock

import pytest

from routine import cli, config, events
from routine import install

ROOT = Path(__file__).resolve().parent.parent
MANUAL = ROOT / "docs" / "MANUAL.md"
REGISTER = ROOT / "mod" / "hooks" / "register.tsx"


# ---------------------------------------------------------------- the lists, from the code

class _Parsed(Exception):
    pass


def parser_of(main) -> argparse.ArgumentParser:
    """The parser a `main(argv)` builds, caught before it parses anything."""
    seen: dict[str, argparse.ArgumentParser] = {}

    def capture(self, args=None, namespace=None):
        seen["parser"] = self
        raise _Parsed

    with mock.patch.object(argparse.ArgumentParser, "parse_args", capture):
        with pytest.raises(_Parsed):
            main([])
    return seen["parser"]


def cli_actions() -> set[str]:
    """Every action the CLI accepts."""
    return set(next(a.choices for a in parser_of(cli.main)._actions if a.dest == "action"))


def cli_options() -> set[str]:
    """Every long option the CLI accepts (--data, --dry-run, ...)."""
    return {o for a in parser_of(cli.main)._actions for o in a.option_strings if o.startswith("--")}


def event_types() -> set[str]:
    """Event types that are not actions of their own (written by sort) must still be named."""
    return {t for t in events.TYPES if t.replace("_", "-") not in cli_actions()}


def install_commands() -> set[str]:
    sub = next(a for a in parser_of(install.main)._actions
               if isinstance(a, argparse._SubParsersAction))
    return set(sub.choices)


def install_options() -> set[str]:
    sub = next(a for a in parser_of(install.main)._actions
               if isinstance(a, argparse._SubParsersAction))
    return {o for p in sub.choices.values() for a in p._actions for o in a.option_strings
            if o.startswith("--") and o != "--help"}


def _block(text: str, start: str, end: str) -> str:
    assert start in text, f"register.tsx no longer has {start!r}: update this extractor"
    return text.split(start, 1)[1].split(end, 1)[0]


def tool_actions() -> set[str]:
    """The tool's schema enum and the actions its handler answers."""
    src = REGISTER.read_text(encoding="utf-8")
    schema = _block(src, "$.tool.register(", "$.command.register(")
    enum = re.search(r"action:\s*\{\s*type:\s*'string',\s*enum:\s*\[([^\]]*)\]", schema)
    assert enum, "the tool's action enum was not found: update this extractor"
    handler = _block(src, "on('tool.call'", "on('ui.render'")
    return (set(re.findall(r"'(\w+)'", enum.group(1)))
            | set(re.findall(r"case '(\w+)':", handler))
            | set(re.findall(r"action === '(\w+)'", handler)))


def slash_commands() -> set[str]:
    """Commands the mod registers or answers."""
    src = REGISTER.read_text(encoding="utf-8")
    listed = _block(src, "const SESSION_COMMANDS = [", "] as const")
    return (set(re.findall(r"\{\s*name:\s*'(\w+)'", listed))
            | set(re.findall(r"\$\.command\.register\(\{\s*name:\s*'(\w+)'", src))
            | set(re.findall(r"on\('command\.run',\s*\{\s*command:\s*'(\w+)'", src)))


def done_kinds() -> set[str]:
    return set(config.FIELD_KINDS)


def settings_keys() -> set[str]:
    return set(config.SETTINGS_DEFAULTS)


# ---------------------------------------------------------------- the check

def section(title: str) -> str:
    """The text under `## <title>...` up to the next `## ` heading."""
    text = MANUAL.read_text(encoding="utf-8")
    m = re.search(rf"^## {re.escape(title)}.*?$(.*?)(?=^## |\Z)", text, re.M | re.S)
    assert m, f"MANUAL.md has no section starting with '## {title}'"
    return m.group(1)


def unnamed(names: set[str], title: str, pattern: str = "`{}`") -> list[str]:
    """Names never mentioned in the section, in the given form."""
    body = section(title)
    return sorted(n for n in names if pattern.format(n) not in body)


def missing(names: set[str], title: str, prefix: str = "") -> list[str]:
    """Names with no table row of their own (`| `name` |` or `| `/name args` |`) in the section."""
    body = section(title)
    return sorted(n for n in names
                  if not re.search(rf"^\| `{re.escape(prefix + n)}(?: [^`]*)?` \|", body, re.M))


def test_r48_every_cli_action_is_in_the_manual():
    assert not missing(cli_actions(), "The CLI"), "add a row to MANUAL.md, section 'The CLI'"
    assert not missing(cli_options(), "The CLI"), "add an option row to MANUAL.md, section 'The CLI'"
    assert not unnamed(event_types(), "The CLI"), "name the event in MANUAL.md, section 'The CLI'"


def test_r48_every_install_command_is_in_the_manual():
    assert not unnamed(install_commands(), "Install", "python -m routine.install {}"),         "show the command in MANUAL.md, section 'Install'"
    assert not unnamed(install_options(), "Install"), "name the option in MANUAL.md, section 'Install'"


def test_r48_every_tool_action_is_in_the_manual():
    assert not missing(tool_actions(), "The routine tool"), \
        "add a row to MANUAL.md, section 'The routine tool'"


def test_r48_every_slash_command_is_in_the_manual():
    assert not missing(slash_commands(), "Slash commands", prefix="/"), \
        "add a row to MANUAL.md, section 'Slash commands'"


def test_r48_every_done_field_kind_and_setting_is_in_the_manual():
    assert not missing(done_kinds(), "The done row"), "add a row to MANUAL.md, section 'The done row'"
    assert not missing(settings_keys(), "Settings"), "add a row to MANUAL.md, section 'Settings'"


# ---------------------------------------------------------------- calibration

def test_the_extractors_find_what_is_known_to_exist():
    assert {"open-day", "close-day", "task-add", "status", "view", "fields", "settings",
            "refresh", "inventory"} <= cli_actions()
    assert {"--data", "--task", "--day", "--dry-run", "--help"} <= cli_options()
    assert {"inbox_sorted", "held_sorted"} <= event_types() and "open_day" not in event_types()
    assert {"demo", "uninstall"} <= install_commands() and "--data-dir" in install_options()
    assert {"start", "pause", "done", "drift_reply", "status"} <= tool_actions()
    assert {"inbox", "pause", "resume", "done", "wait", "tasks"} <= slash_commands()
    assert {"buttons", "yesno", "text"} <= done_kinds()
    assert "idle_pause_minutes" in settings_keys()


def test_the_check_reports_a_name_the_manual_lacks():
    assert missing({"open-day", "zz-not-an-action"}, "The CLI") == ["zz-not-an-action"]
    assert missing({"inbox", "zz"}, "Slash commands", prefix="/") == ["zz"]
    # a name mentioned only in passing is not enough: it needs its own row
    assert missing({"carry"}, "The CLI") == []
    assert missing({"T2"}, "The CLI") == ["T2"]
    assert unnamed({"inbox_sorted", "zz_event"}, "The CLI") == ["zz_event"]
    assert unnamed({"demo", "zz"}, "Install", "python -m routine.install {}") == ["zz"]
