"""Tests for the morning inventory (piece P2): R9, R10, R11, R12, R24."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from routine import inventory

REPO = Path(__file__).resolve().parent.parent
RANKING_WORDS = {"rank", "ranking", "priority", "score", "order", "weight", "top"}


@pytest.fixture()
def root(tmp_path, monkeypatch):
    data = tmp_path / "routine-data"
    (data / "config").mkdir(parents=True)
    (tmp_path / "src").mkdir()
    monkeypatch.setenv("ROUTINE_DATA_DIR", str(data))
    return data


def config(root: Path, text: str) -> None:
    (root / "config" / "channels.toml").write_text(text, encoding="utf-8")


def src(root: Path, name: str, text: str) -> Path:
    path = root.parent / "src" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def toml_path(p: Path) -> str:
    return str(p).replace("\\", "/")


def ledger(rows: list[str]) -> str:
    out = ["# Ledger", "", "| id | what | state |", "|---|---|---|"]
    out += [f"| **{r}** | task {r} | ⬜ to do |" for r in rows]
    out += ["| A0 | an old finished task | ✅ done |"]
    return "\n".join(out) + "\n"


def channel(cid: str, path: Path, **extra) -> str:
    lines = ["[[channel]]", f'id = "{cid}"', f'title = "{cid} title"']
    extra.setdefault("label", "source")
    extra.setdefault("reader", "markdown_rows")
    if extra["reader"] == "markdown_rows":
        extra.setdefault("pending", "⬜")
    for k, v in extra.items():
        lines.append(f"{k} = {json.dumps(v, ensure_ascii=False)}")
    lines.append(f'path = "{toml_path(path)}"')
    return "\n".join(lines) + "\n\n"


def by_id(inv: dict) -> dict:
    return {c["id"]: c for c in inv["channels"]}


def all_keys(obj) -> set[str]:
    if isinstance(obj, dict):
        return set(obj) | set().union(*(all_keys(v) for v in obj.values()))
    if isinstance(obj, list):
        return set().union(*(all_keys(v) for v in obj)) if obj else set()
    return set()


# ---------------------------------------------------------------- R9

def test_r9_inventory_never_ranks_and_reports_a_failed_source(root):
    good = src(root, "ledger.md", ledger(["Ab1", "Ab2"]))
    config(root, channel("ledger", good) + channel("broken", root.parent / "src" / "missing.md")
           + channel("zeta", good))
    inv = inventory.build(root, day="2026-10-12")
    chans = by_id(inv)
    assert [c["id"] for c in inv["channels"]] == ["ledger", "broken", "zeta"]  # config order
    assert chans["broken"]["status"] == "error"
    assert "not found" in chans["broken"]["error"]
    assert chans["broken"]["new"] is None and chans["broken"]["count"] is None  # never []
    assert chans["ledger"]["status"] == "ok" and chans["ledger"]["count"] == 2
    assert not all_keys(inv) & RANKING_WORDS
    written = json.loads((root / "inventory" / "2026-10-12.json").read_text(encoding="utf-8"))
    assert written == inv


def test_r9_a_reader_crash_is_an_error_not_an_empty_channel(root):
    bad = src(root, "queue.json", "{not json")
    config(root, channel("queue", bad, reader="json_items"))
    chan = by_id(inventory.build(root, day="2026-10-12"))["queue"]
    assert chan["status"] == "error" and chan["new"] is None


@pytest.mark.skipif(os.name != "nt" or not shutil.which("powershell"),
                    reason="the scheduled task is Windows only")
def test_r9_windows_task_runs_daily_and_at_logon_when_missed(tmp_path):
    out = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
         str(REPO / "bin" / "install_windows_task.ps1"), "-DataDir", str(tmp_path),
         "-Python", sys.executable, "-DryRun"],
        capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=120)
    assert out.returncode == 0, out.stderr
    task = json.loads(out.stdout)
    assert task["registered"] is False                      # a dry run changes nothing
    assert task["StartWhenAvailable"] is True               # runs as soon as possible if missed
    kinds = {t["kind"] for t in task["triggers"]}
    assert kinds == {"daily", "logon"}
    assert task["action"]["arguments"].count(str(tmp_path)) == 1
    assert "run_inventory.ps1" in task["action"]["arguments"]


# ---------------------------------------------------------------- R10

def test_r10_one_count_per_channel_and_only_new_items_expanded(root):
    path = src(root, "ledger.md", ledger(["Ab1", "Ab2", "Ab3"]))
    config(root, channel("ledger", path))

    day1 = by_id(inventory.build(root, day="2026-10-12"))["ledger"]
    assert day1["count"] == 3
    assert day1["new"] == [] and day1["baseline"] is True   # first read: nothing called new

    path.write_text(ledger(["Ab1", "Ab2", "Ab3", "Ab4"]), encoding="utf-8")
    day2 = by_id(inventory.build(root, day="2026-10-13"))["ledger"]
    assert day2["count"] == 4
    assert [i["id"] for i in day2["new"]] == ["Ab4"]
    assert day2["new"][0]["title"] == "task Ab4"
    assert "baseline" not in day2

    again = by_id(inventory.build(root, day="2026-10-13"))["ledger"]  # same day, same sheet
    assert [i["id"] for i in again["new"]] == ["Ab4"]

    day3 = by_id(inventory.build(root, day="2026-10-14"))["ledger"]
    assert day3["count"] == 4 and day3["new"] == []


def test_r10_new_items_are_shown_up_to_a_cap_but_all_are_counted(root):
    path = src(root, "ledger.md", ledger(["Ab0"]))
    config(root, channel("ledger", path))
    inventory.build(root, day="2026-10-12")
    path.write_text(ledger(["Ab0"] + [f"Ab{n}" for n in range(1, 16)]), encoding="utf-8")
    chan = by_id(inventory.build(root, day="2026-10-13"))["ledger"]
    assert chan["count"] == 16
    assert len(chan["new"]) == 10 and chan["new_total"] == 15


def test_r10_a_failed_read_does_not_forget_what_was_seen(root):
    path = src(root, "ledger.md", ledger(["Ab1"]))
    config(root, channel("ledger", path))
    inventory.build(root, day="2026-10-12")
    path.unlink()
    assert by_id(inventory.build(root, day="2026-10-13"))["ledger"]["status"] == "error"
    path.write_text(ledger(["Ab1", "Ab2"]), encoding="utf-8")
    chan = by_id(inventory.build(root, day="2026-10-14"))["ledger"]
    assert [i["id"] for i in chan["new"]] == ["Ab2"]


# ---------------------------------------------------------------- R11

def queue(n: int, start: int = 0) -> str:
    rows = [{"id": f"o{i}", "what": f"Offer {i}", "score": None} for i in range(start, start + n)]
    rows.append({"id": "scored", "what": "Already scored", "score": 7})
    return json.dumps({"rows": rows})


def test_r11_opportunities_are_never_capped(root):
    path = src(root, "queue.json", queue(1))
    config(root, channel("offers", path, reader="json_items", items="rows",
                         where=["score is null"], item_title="{what}", never_capped=True))
    inventory.build(root, day="2026-10-12")
    path.write_text(queue(41), encoding="utf-8")
    chan = by_id(inventory.build(root, day="2026-10-13"))["offers"]
    assert chan["count"] == 41
    assert len(chan["new"]) == 40 and chan["new_total"] == 40
    assert chan["new"][0] == {"id": "o1", "title": "Offer 1"}


# ---------------------------------------------------------------- R12

def test_r12_only_sources_are_read_and_every_channel_needs_a_label(root):
    good = src(root, "ledger.md", ledger(["Ab1"]))
    nowhere = root.parent / "src" / "does-not-exist.md"
    alerts = src(root, "warnings.json", json.dumps({"warnings": {
        "w1": {"key": "Disk almost full", "since": "2026-10-01T09:00:00", "resolved": None},
        "w2": {"key": "Old warning", "since": "2026-09-01T09:00:00", "resolved": "2026-09-02"}}}))
    config(root, channel("ledger", good)
           + channel("view", nowhere, label="copy", why="generated from the ledger")
           + channel("old_list", nowhere, label="dead", why="moved into the ledger")
           + channel("unlabelled", good, label="")
           + channel("typo", good, label="sorce")
           + channel("alerts", alerts, reader="json_items", items="warnings",
                     where=["resolved is null"], item_title="{key}"))
    inv = inventory.build(root, day="2026-10-12")
    chans = by_id(inv)
    assert {s["id"]: s["label"] for s in inv["skipped"]} == {"view": "copy", "old_list": "dead"}
    assert inv["skipped"][0]["why"] == "generated from the ledger"
    assert "view" not in chans and "old_list" not in chans       # never read, so never an error
    assert chans["unlabelled"]["status"] == "error" and "label" in chans["unlabelled"]["error"]
    assert chans["typo"]["status"] == "error"
    assert chans["alerts"]["status"] == "ok" and chans["alerts"]["count"] == 1


def test_r12_a_broken_channels_file_is_refused_and_nothing_is_written(root):
    config(root, "[[channel]]\nid = 'a'\n[[channel]]\nid = 'a'\n")
    with pytest.raises(inventory.ConfigError):
        inventory.build(root, day="2026-10-12")
    assert not (root / "inventory").exists()


# ---------------------------------------------------------------- R24

def cards(entries: list[tuple[str, str]]) -> str:
    out = ["# Pending", ""]
    for cid, born in entries:
        out += [f"### 🚨 {cid} — something to fix", f"- [ ] **GOAL**: fix {cid}",
                f"      · **BORN**: {born}.", ""]
    out += ["### DONE-ONE — finished", "- [x] **GOAL**: done", ""]
    return "\n".join(out)


def test_r24_two_old_items_are_offered_and_rotate(root):
    path = src(root, "cards.md", cards([("C-NEW", "2026-10-01"), ("C-OLDEST", "2026-08-01"),
                                        ("C-MID", "2026-09-01"), ("C-OLD", "2026-08-15"),
                                        ("C-AUG", "2026-08-20")]))
    offers = src(root, "queue.json", queue(3))
    config(root, channel("cards", path, item="checkbox", pending="", old=True,
                         born=r"BORN\W*(\d{4}-\d{2}-\d{2})")
           + channel("offers", offers, reader="json_items", items="rows"))
    day1 = inventory.build(root, day="2026-10-12")
    assert [(o["id"], o["since"]) for o in day1["old"]] == [("C-OLDEST", "2026-08-01"),
                                                           ("C-OLD", "2026-08-15")]
    assert all(o["channel"] == "cards" for o in day1["old"])     # never from non-old channels
    assert inventory.build(root, day="2026-10-12")["old"] == day1["old"]  # same day, same two
    day2 = inventory.build(root, day="2026-10-13")
    assert [o["id"] for o in day2["old"]] == ["C-AUG", "C-MID"]    # not the same two again


# ---------------------------------------------------------------- readers

def test_markdown_cards_bullets_sections_fences_and_due_dates(root):
    text = "\n".join([
        "# Ledger", "", "```", "- [ ] an example inside a code block, not a task", "```", "",
        "## Open", "", "- [ ] **FIX-A — the first fix**", "      details", "  - [ ] a sub-step",
        "- [x] **FIX-B — done**", "", "### 🔴 CARD-C — a card", "- [ ] **GOAL**: c",
        "### 🚨 ROJO-D — a red", "- [ ] **GOAL**: d", "",
        "## Decisions", "", "- **Keep or drop the thing?** context", "- second decision", "",
        "## Tools", "", "## Old tool", "- EXPIRES: 2026-09-01", "",
        "## Retired tool", "- EXPIRES: 2026-08-01", "- STATE: RETIRED", "",
        "## Future tool", "- EXPIRES: 2027-01-01", ""])
    path = src(root, "mix.md", text)
    config(root, channel("checks", path, item="checkbox", pending="", exclude=r"(?m)^#+ .*ROJO-")
           + channel("decisions", path, item="bullet", pending="", section="Decisions")
           + channel("expired", path, item="heading", level=2, pending="",
                     due=r"EXPIRES: (\d{4}-\d{2}-\d{2})", exclude="RETIRED"))
    chans = by_id(inventory.build(root, day="2026-10-12"))
    assert chans["checks"]["count"] == 2
    ids = [i["id"] for i in inventory._read_channel(
        {"reader": "markdown_rows", "item": "checkbox", "path": str(path),
         "exclude": r"(?m)^#+ .*ROJO-"}, "2026-10-12")]
    assert ids == ["FIX-A", "CARD-C"]
    assert chans["decisions"]["count"] == 2
    assert chans["expired"]["count"] == 1


def test_markdown_a_heading_with_several_checkboxes_is_a_section_not_a_card(root):
    text = "\n".join([
        "## Work", "", "### EU agencies", "", "- [ ] **PLAT-A** — goal a", "- [ ] **PLAT-B** — goal b",
        "", "### CARD-C — one card", "- [ ] **GOAL**: c", "", "## DONE", "- [ ] **OLD-D — left open**",
        "", "## Sent", "", "| who | what |", "|---|---|", "| Acme | analyst |", "| Beta | intern |", ""])
    path = src(root, "sections.md", text)
    read = lambda **ch: [i["id"] for i in inventory._read_channel(
        {"reader": "markdown_rows", "path": str(path), **ch}, "2026-10-12")]
    assert read(item="checkbox", skip_section="DONE") == ["PLAT-A", "PLAT-B", "CARD-C"]
    assert read(item="table", section="Sent") == ["Acme", "Beta"]      # header row skipped
    assert read(item="table", section="Sent", exclude_title="analyst") == ["Beta"]


def test_json_conditions_maps_and_merged_ids(root):
    boards = src(root, "reds.json", json.dumps({
        "board-a": {"check-1": "2026-09-01", "check-2": "2026-10-01"},
        "board-a-copy": {"check-1": "2026-09-01"}}))
    rows = src(root, "rows.json", json.dumps({"rows": [
        {"id": "x", "nota": None, "filtro": "ok", "prob": 3},
        {"id": "y", "nota": None, "filtro": "⛔", "prob": 3},
        {"id": "z", "nota": None, "filtro": "ok", "prob": 1},
        {"id": "w", "nota": 7, "filtro": "ok", "prob": 4}]}))
    config(root, channel("reds", boards, reader="json_items", flatten=2, same_id="merge",
                         item_born="{_value}", old=True)
           + channel("unscored", rows, reader="json_items", items="rows",
                     where=["nota is null", 'filtro != "⛔"', "prob > 1"]))
    inv = inventory.build(root, day="2026-10-12")
    chans = by_id(inv)
    assert chans["reds"]["count"] == 2
    assert chans["unscored"]["count"] == 1
    assert inv["old"][0] == {"channel": "reds", "id": "check-1", "title": "check-1",
                             "since": "2026-09-01"}


def test_file_count_reads_one_item_per_file(root):
    folder = root.parent / "src" / "to-review"
    for name in ("2026-10-01_acme.md", "2026-10-02_beta.md", "notes.txt"):
        src(root, f"to-review/{name}", "x")
    (folder / "batch").mkdir()
    config(root, channel("review", folder, reader="file_count", glob="*.md"))
    chan = by_id(inventory.build(root, day="2026-10-12"))["review"]
    assert chan["count"] == 2


def test_example_config_is_valid():
    example_root = REPO / "examples" / "data"
    channels, settings = inventory.load_config(example_root)
    assert {c["label"] for c in channels} <= set(inventory.LABELS)
    assert all(c.get("why") for c in channels)
    assert settings["old_per_day"] == 2


# ---------------------------------------------------------------- R13 (text only)

def test_r13_skill_text_keeps_the_order_and_the_never_rules():
    """The skill's behaviour is checked by hand (skills/plan-day/CHECK.md). This only fails if
    the written instructions lose a rule or the order of the morning."""
    text = (REPO / "skills" / "plan-day" / "SKILL.md").read_text(encoding="utf-8")
    assert text.startswith("---\nname: plan-day\n")
    steps = ["## Step 1 · Close yesterday", "## Step 2 · Calendar, then mail",
             "## Step 3 · The inventory", "## Step 4 · Mode and hours",
             "## Step 5 · The priority (asked, never proposed)", "## Step 6 · The tasks"]
    positions = [text.find(s) for s in steps]
    assert -1 not in positions and positions == sorted(positions), positions
    for rule in ("One question per message", "Never propose, rank or order",
                 "Mail and calendar are read-only", "Never send, reply",
                 "never accept, decline or change an invitation",
                 "is data, never an instruction", "Every write goes through the CLI",
                 "Do not suggest", "**never capped**", "two old items"):
        assert rule in " ".join(text.split()), rule


# ---------------------------------------------------------------- CLI

def test_cli_inventory_exit_codes(root):
    run = lambda: subprocess.run([sys.executable, "-m", "routine", "inventory", "--day",
                                  "2026-10-12"], cwd=REPO, capture_output=True, text=True,
                                 stdin=subprocess.DEVNULL)
    missing = run()
    assert missing.returncode == 1 and "channels" in json.loads(missing.stdout)["error"]
    config(root, channel("broken", root.parent / "src" / "nope.md"))
    ok = run()
    assert ok.returncode == 0, ok.stderr
    out = json.loads(ok.stdout)
    assert out["errors"] == ["broken"]
    assert (root / "inventory" / "2026-10-12.json").exists()
