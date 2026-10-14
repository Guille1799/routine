"""The morning inventory (piece P2).

Runs before the user arrives, from a Windows scheduled task (D38), and writes
`<data>/inventory/YYYY-MM-DD.json` for the morning skill (INTERFACES §6):

- **one count per channel**, and only the items that are **new** since the previous
  inventory are expanded (D29). Opportunities are never truncated (D5);
- it **never ranks or proposes** (D19): channels keep the order of `channels.toml` and
  items the order of their source. There is no priority or score field, on purpose;
- a channel that cannot be read says so, `status: "error"`, and never shows as an empty
  list (a blank sheet must mean "nothing there", never "not consulted");
- only channels labelled `source` are read; `copy` and `dead` ones are listed as skipped
  (D20, D40). Alerts from other projects are channels like any other (D30);
- it offers **two old items** a day, the oldest pending ones from channels marked
  `old = true` (ledgers and alerts, D31), never the same ones two days running.

To know what is new, it keeps `inventory/seen.json`: the day each item was first seen.
An item is new when it was first seen today, so running the inventory twice in one day
gives the same sheet. The first time a channel is read nothing can be called new; the
channel is marked `baseline` instead of pretending everything is.

Readers are generic and configured per channel: `markdown_rows`, `json_items` and
`file_count`. Each reader's docstring lists its options; `examples/data/config/channels.toml`
shows them in use.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tomllib
from datetime import date, datetime, timedelta
from pathlib import Path

from . import gitrepos

LABELS = ("source", "copy", "dead")
DEFAULTS = {"max_new": 10, "old_per_day": 2, "old_cooldown_days": 7, "forget_after_days": 30}
TITLE_MAX = 200
ID_MAX = 80


class ConfigError(ValueError):
    """channels.toml cannot be used at all. Nothing is written."""


class ReadError(RuntimeError):
    """One channel could not be read. It is reported, the others go on."""


# ---------------------------------------------------------------- text helpers

def clean(text: str) -> str:
    """Markdown and decoration out, plain words in."""
    t = re.sub(r"<!--.*?-->", "", text)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    for mark in ("**", "__", "~~", "`"):
        t = t.replace(mark, "")
    t = t.replace("\\|", "|")
    t = re.sub(r"\s+", " ", t).strip()
    return re.sub(r"^[^\w«\"'¿¡(]+", "", t)


def short(text: str, limit: int = TITLE_MAX) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def row_id(title: str) -> str:
    """The house convention is `SHORT-ID — what happens`: the id is the part before the dash."""
    head = title.split(" — ", 1)[0].strip()
    return short(head or title, ID_MAX)


def text_id(title: str) -> str:
    return hashlib.sha1(title.encode("utf-8")).hexdigest()[:12]


def _find_date(pattern: str | None, text: str) -> str | None:
    if not pattern:
        return None
    m = re.search(pattern, text)
    return m.group(1) if m else None


# ---------------------------------------------------------------- readers

_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_CHECKBOX = re.compile(r"^- \[ \]\s*(.*)$")
_BULLET = re.compile(r"^[-*]\s+(?!\[[ xX]\])(.*)$")
_FENCE = re.compile(r"^\s*(```|~~~)")


def read_markdown_rows(ch: dict, path: Path, today: str) -> list[dict]:
    """Items in a markdown file: table rows, open checkboxes, top-level bullets or headings.

    item     table | checkbox | bullet | heading
    pending  text an item's line must contain to count (e.g. "⬜"); header and separator
             rows of a table never count
    level    heading level of an item when item = "heading" (default 2)
    section  regex: only items under a heading that matches
    skip_section  regex: items under a heading that matches are left out
    exclude  regex: items whose text (title + body) matches are left out
    exclude_title  regex: items whose title matches are left out (e.g. a title marked done)
    born     regex with one group: the item's date (YYYY-MM-DD), used for old items
    due      regex with one group: only items whose date is today or earlier count
    parked   regex with one group: an item whose text matches with a date after today is
             parked until that date: not counted, never new, never offered as old. The
             channel says how many with `parked`. Without a date it counts as open.

    An open checkbox that is the only checkbox under its nearest heading of level 3 or more
    is a card: that heading is its title (`### FIX-ID — what`, then notes or quotes, then
    `- [ ] **GOAL**: ...`).
    """
    kind = ch.get("item", "table")
    if kind not in ("table", "checkbox", "bullet", "heading"):
        raise ReadError(f"config: unknown item kind {kind!r}")
    pending = ch.get("pending")
    level = int(ch.get("level", 2))
    section = re.compile(ch["section"]) if ch.get("section") else None
    skip_section = re.compile(ch["skip_section"]) if ch.get("skip_section") else None
    exclude = re.compile(ch["exclude"], re.M) if ch.get("exclude") else None
    exclude_title = re.compile(ch["exclude_title"]) if ch.get("exclude_title") else None

    lines = path.read_text(encoding="utf-8").splitlines()
    in_fence = [False] * len(lines)
    fenced = False
    for i, line in enumerate(lines):
        if _FENCE.match(line):
            fenced = not fenced
            in_fence[i] = True
        else:
            in_fence[i] = fenced

    def heading_at(i: int):
        m = None if in_fence[i] else _HEADING.match(lines[i])
        return (len(m.group(1)), m.group(2)) if m else None

    def block_end(i: int) -> int:
        """Where the item that starts at line i stops."""
        h = heading_at(i)
        j = i + 1
        while j < len(lines):
            hj = heading_at(j)
            if h:
                if hj and hj[0] <= h[0]:
                    break
            elif kind == "table":
                break
            elif hj or (lines[j][:1] not in ("", " ", "\t") and not in_fence[j]):
                break
            j += 1
        return j

    def checkboxes_under(h_line: int) -> int:
        n, j = 0, h_line + 1
        while j < len(lines) and not heading_at(j):
            n += bool(not in_fence[j] and re.match(r"^- \[[ xX]\]", lines[j]))
            j += 1
        return n

    def is_table_rule(text: str) -> bool:
        return bool(re.match(r"^\|[\s:|-]+\|?\s*$", text))

    items = []
    stack: list[tuple[int, str, int]] = []   # (level, text, line) of the headings above
    for i, line in enumerate(lines):
        if in_fence[i]:
            continue
        h = heading_at(i)
        if h:
            while stack and stack[-1][0] >= h[0]:
                stack.pop()
            stack.append((*h, i))
        if section and not any(section.search(text) for _, text, _ in stack):
            continue
        if skip_section and any(skip_section.search(text) for _, text, _ in stack):
            continue
        title, start = None, i
        if (kind == "table" and line.startswith("|") and (not pending or pending in line)
                and not is_table_rule(line)
                and not (i + 1 < len(lines) and is_table_rule(lines[i + 1]))):
            cells = [c.strip() for c in re.split(r"(?<!\\)\|", line.strip())[1:-1]]
            first = clean(cells[0]) if cells else ""
            title = clean(cells[1]) if len(cells) > 1 else first
            item_id = short(first, ID_MAX) if first else row_id(title)
        elif kind == "checkbox" and (m := _CHECKBOX.match(line)):
            title = clean(m.group(1))
            if stack and stack[-1][0] >= 3 and checkboxes_under(stack[-1][2]) == 1:  # a card
                title, start = clean(stack[-1][1]), stack[-1][2]
            item_id = row_id(title)
        elif kind == "bullet" and (m := _BULLET.match(line)):
            if pending and pending not in line:
                continue
            title = clean(m.group(1))
            item_id = row_id(title)
        elif kind == "heading" and h and h[0] == level:
            title = clean(h[1])
            item_id = row_id(title)
        if title is None:
            continue
        end = block_end(i)
        body = "\n".join(lines[start:end])
        if exclude and exclude.search(body):
            continue
        if exclude_title and exclude_title.search(title):
            continue
        if ch.get("due"):
            due = _find_date(ch["due"], body)
            if not due or due > today:
                continue
        item = {"id": item_id, "title": short(title), "born": _find_date(ch.get("born"), body),
                "link": f"{path}:{i + 1}", "_text": title}
        until = _find_date(ch.get("parked"), body)
        if until and until > today:
            item["_parked_until"] = until
        items.append(item)
    return items


_WHERE = re.compile(r"^\s*([\w.]+)\s+(is not null|is null|==|!=|>=|<=|>|<)\s*(.*?)\s*$")


def _get(obj, dotted: str):
    for part in dotted.split("."):
        if not isinstance(obj, dict):
            return None
        obj = obj.get(part)
    return obj


def _template(tpl: str, obj: dict) -> str:
    return re.sub(r"\{([\w.]+)\}", lambda m: "" if _get(obj, m.group(1)) is None
                  else str(_get(obj, m.group(1))), tpl)


def _condition(rule: str):
    m = _WHERE.match(rule)
    if not m:
        raise ReadError(f"config: cannot read the condition {rule!r} (field op value)")
    field, op, raw = m.groups()
    try:
        want = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        want = raw

    def test(obj: dict) -> bool:
        v = _get(obj, field)
        if op == "is null":
            return v is None
        if op == "is not null":
            return v is not None
        if op == "==":
            return v == want
        if op == "!=":
            return v != want
        if not isinstance(v, (int, float)) or not isinstance(want, (int, float)):
            return False
        return {">": v > want, ">=": v >= want, "<": v < want, "<=": v <= want}[op]
    return test


def read_json_items(ch: dict, path: Path, today: str) -> list[dict]:
    """Items in a JSON (or JSON Lines) file.

    items    dotted path to the list or map that holds the items (default: the root)
    flatten  how many levels of nested maps to walk (default 1); each map key becomes
             `_key` and a value that is not an object becomes `_value`
    where    list of conditions, all must hold: "nota is null", "prob > 1", "filtro != \"x\""
    item_id     template for the item id (default "{id}" for lists, "{_key}" for maps)
    item_title  template for the title (default: same as the id)
    item_link   optional template for a link
    item_born   template for the item's date; its first 10 characters are used
    same_id  "keep" (default: duplicates are both counted) or "merge" (one item)
    """
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".jsonl":
        data = [json.loads(line) for line in text.splitlines() if line.strip()]
    else:
        data = json.loads(text)
    container = _get(data, ch["items"]) if ch.get("items") else data
    if container is None:
        raise ReadError(f"no {ch['items']!r} in the file")
    rows: list[dict] = []
    if isinstance(container, list):
        rows = [r if isinstance(r, dict) else {"_value": r} for r in container]
        default_id = "{id}"
    elif isinstance(container, dict):
        def walk(node: dict, depth: int, keys: list[str]):
            for k, v in node.items():
                if depth > 1 and isinstance(v, dict):
                    walk(v, depth - 1, keys + [k])
                else:
                    row = dict(v) if isinstance(v, dict) else {"_value": v}
                    row.update(_key=k, _path="/".join(keys + [k]))
                    rows.append(row)
        walk(container, int(ch.get("flatten", 1)), [])
        default_id = "{_key}"
    else:
        raise ReadError("the items are neither a list nor a map")
    conditions = [_condition(r) for r in ch.get("where", [])]
    items = []
    for row in rows:
        if not all(c(row) for c in conditions):
            continue
        id_tpl = ch.get("item_id", default_id)
        item_id = _template(id_tpl, row)
        title = clean(_template(ch.get("item_title", id_tpl), row))
        born = _template(ch["item_born"], row)[:10] if ch.get("item_born") else None
        item = {"id": short(item_id, ID_MAX), "title": short(title),
                "born": born if born and re.match(r"\d{4}-\d{2}-\d{2}$", born) else None,
                "_text": title}
        if ch.get("item_link"):
            item["link"] = _template(ch["item_link"], row)
        items.append(item)
    return items


def read_file_count(ch: dict, path: Path, today: str) -> list[dict]:
    """One item per file (or folder, with `dirs = true`) matching `glob` in a folder.

    A name that starts with YYYY-MM-DD gives the item its date.
    """
    if not path.is_dir():
        raise ReadError(f"not a folder: {path}")
    want_dirs = bool(ch.get("dirs", False))
    entries = sorted(p for p in path.glob(ch.get("glob", "*")) if p.is_dir() == want_dirs)
    return [{"id": p.name, "title": p.stem if not want_dirs else p.name,
             "born": _find_date(r"^(\d{4}-\d{2}-\d{2})", p.name), "link": str(p), "_text": p.name}
            for p in entries]


def read_git_unpushed(ch: dict, root: Path, today: str, extra: dict) -> list[dict]:
    """One item per commit not pushed, across repositories (D78).

    repos    folders to watch (default: every project in projects.toml)

    The channel also gets `repos` (one entry per repository: status ok with `ahead`, no
    remote, or error) and `summary` ("routine 0 · app 12 · notes no remote"). A repository
    that git cannot read makes the channel an error, with the other repositories still
    listed: one failure is never shown as a zero.
    """
    repos = [gitrepos.check(name, path) for name, path in gitrepos.configured(root, ch)]
    extra["repos"] = [{k: v for k, v in r.items() if k != "commits"} for r in repos]
    extra["summary"] = gitrepos.summary(repos)
    bad = [r for r in repos if r["status"] == "error"]
    if bad:
        extra["error"] = "; ".join(f"{r['repo']}: {r['error']}" for r in bad)
    return [{"id": c["sha"], "title": short(f"{r['repo']}: {c['subject']}"),
             "born": c["date"] or None, "_text": c["subject"]}
            for r in repos if r["status"] == "ok" for c in r["commits"]]


def read_command_lines(ch: dict, path: Path, today: str) -> list[dict]:
    """One item per line a command prints that matches `item`; the command runs in `path`.

    command     the program and its arguments, as a list (no shell)
    item        regex for an item line. Named groups: `title` (default: the whole match),
                `id` (default: the title) and `date` (YYYY-MM-DD: the item's date)
    count_line  regex with one group: the number of items the command says it printed. If
                it does not match what `item` found, the channel is an error: a format that
                changed is never shown as fewer items
    sort        "date": oldest date first (a deadline list); default: the command's order

    A command that fails or does not answer in 60 seconds makes the channel an error.
    """
    cmd = ch.get("command")
    if not isinstance(cmd, list) or not cmd or not all(isinstance(c, str) for c in cmd):
        raise ReadError("config: command must be a list of strings")
    if not path.is_dir():
        raise ReadError(f"not a folder: {path}")
    pattern = re.compile(ch.get("item", r"^(?P<title>.+)$"))
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    try:
        run = subprocess.run(cmd, cwd=path, capture_output=True, text=True, encoding="utf-8",
                             errors="replace", stdin=subprocess.DEVNULL, env=env, timeout=60)
    except FileNotFoundError as exc:
        raise ReadError(f"command not found: {cmd[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise ReadError("the command did not answer in 60 s") from exc
    if run.returncode != 0:
        said = " ".join((run.stderr or run.stdout).split())[:200]
        raise ReadError(f"the command failed (exit {run.returncode}): {said}")
    items = []
    for line in run.stdout.splitlines():
        m = pattern.search(line)
        if not m:
            continue
        groups = m.groupdict()
        title = clean(groups.get("title") or m.group(0))
        date_ = groups.get("date")
        items.append({"id": short(clean(groups.get("id") or title), ID_MAX), "title": short(title),
                      "born": date_ if date_ and re.match(r"\d{4}-\d{2}-\d{2}$", date_) else None,
                      "_text": title})
    if ch.get("count_line"):
        said = re.search(ch["count_line"], run.stdout, re.M)
        if not said:
            raise ReadError("the command's count line was not found: its format changed")
        if int(said.group(1)) != len(items):
            raise ReadError(f"the command says {said.group(1)} items and {len(items)} lines "
                            "matched `item`: its format changed")
    if ch.get("sort") == "date":
        items.sort(key=lambda it: it["born"] or "9999")
    return items


READERS = {"markdown_rows": read_markdown_rows, "json_items": read_json_items,
           "file_count": read_file_count, "git_unpushed": read_git_unpushed,
           "command_lines": read_command_lines}
PATHLESS = {"git_unpushed"}   # readers that take their places from the config, not `path`


# ---------------------------------------------------------------- config

def load_config(root: Path) -> tuple[list[dict], dict]:
    path = root / "config" / "channels.toml"
    if not path.exists():
        raise ConfigError(f"no channels file: {path}")
    try:
        with path.open("rb") as fh:
            raw = tomllib.load(fh)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"channels.toml is not valid TOML: {exc}") from exc
    channels = raw.get("channel", [])
    if not channels:
        raise ConfigError("channels.toml declares no [[channel]]")
    seen = set()
    for ch in channels:
        cid = ch.get("id")
        if not cid:
            raise ConfigError(f"a channel has no id: {ch.get('title') or ch}")
        if cid in seen:
            raise ConfigError(f"two channels share the id {cid!r}")
        seen.add(cid)
    settings = {**DEFAULTS, **raw.get("settings", {})}
    return channels, settings


def _read_channel(ch: dict, today: str, root: Path | None = None,
                  extra: dict | None = None) -> list[dict]:
    """The channel's items. `extra` receives what a reader says about the channel as a whole."""
    reader = READERS.get(ch.get("reader"))
    if not reader:
        raise ReadError(f"config: unknown reader {ch.get('reader')!r} "
                        f"(known: {', '.join(READERS)})")
    if ch.get("reader") in PATHLESS:
        items = reader(ch, root, today, extra if extra is not None else {})
    else:
        if not ch.get("path"):
            raise ReadError("config: no path")
        path = Path(ch["path"]).expanduser()
        if not path.exists():
            raise ReadError(f"not found: {path}")
        items = reader(ch, path, today)
    if ch.get("parked") and extra is not None:   # parked until a later date: out of the count
        extra["parked"] = sum(1 for it in items if it.get("_parked_until"))
    items = [it for it in items if not it.get("_parked_until")]
    if ch.get("new_by") == "text":
        for it in items:
            it["id"] = text_id(it["_text"])
    # same id twice: one item if the channel says so, otherwise both are kept and counted
    merged, ids = [], {}
    for it in items:
        if it["id"] in ids:
            if ch.get("same_id") == "merge":
                continue
            ids[it["id"]] += 1
            it["id"] = f"{it['id']}~{ids[it['id']]}"
        ids.setdefault(it["id"], 1)
        merged.append(it)
    return merged


# ---------------------------------------------------------------- the run

def _load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def build(root: Path, day: str | None = None, now: datetime | None = None) -> dict:
    """Read every channel and write today's inventory. Returns what was written."""
    now = now or datetime.now().astimezone()
    today = day or now.date().isoformat()
    channels, settings = load_config(root)
    inv_dir = root / "inventory"
    seen_path = inv_dir / "seen.json"
    seen = _load_json(seen_path, {"channels": {}, "offered": {}})
    forget_before = (date.fromisoformat(today) - timedelta(days=settings["forget_after_days"])).isoformat()

    out_channels, skipped, candidates = [], [], []
    for order, ch in enumerate(channels):
        label = ch.get("label")
        if label in ("copy", "dead"):
            skipped.append({"id": ch["id"], "title": ch.get("title", ch["id"]), "label": label,
                            "why": ch.get("why", "")})
            continue
        entry = {"id": ch["id"], "title": ch.get("title", ch["id"]), "label": label}
        if ch.get("note"):
            entry["note"] = ch["note"]
        extra: dict = {}
        try:
            if label not in LABELS:
                raise ReadError(f"config: label must be one of {', '.join(LABELS)}, "
                                f"not {label!r}")
            items = _read_channel(ch, today, root=root, extra=extra)
            if extra.get("error"):
                raise ReadError(extra.pop("error"))
        except Exception as exc:  # one broken channel never hides the others
            entry.update(status="error", error=str(exc) or type(exc).__name__,
                         count=None, new=None, **extra)
            out_channels.append(entry)
            continue

        state = seen["channels"].setdefault(ch["id"], {"first_read": today, "items": {}})
        known = state["items"]
        for it in items:
            first, _last = known.get(it["id"], (today, today))
            known[it["id"]] = [first, today]
            it["_first_seen"] = first
        for iid in [i for i, (_, last) in known.items() if last < forget_before]:
            del known[iid]

        baseline = state["first_read"] == today
        new = [] if baseline else [it for it in items if it["_first_seen"] == today]
        cap = None if ch.get("never_capped") else int(ch.get("max_new", settings["max_new"]))
        shown = new if cap is None else new[:cap]
        entry.update(status="ok", count=len(items),
                     new=[{k: it[k] for k in ("id", "title", "link") if it.get(k)} for it in shown],
                     new_total=len(new), **extra)
        if ch.get("show_all"):   # every item, every day: a list like deadlines is read whole
            entry["items"] = [{k: v for k, v in (("id", it["id"]), ("title", it["title"]),
                                                 ("date", it["born"]), ("link", it.get("link"))) if v}
                              for it in items]
        if baseline:
            entry["baseline"] = True
        out_channels.append(entry)
        if ch.get("old"):
            for pos, it in enumerate(items):
                candidates.append(((it["born"] or it["_first_seen"]), order, pos, ch["id"], it))

    old = _pick_old(candidates, seen["offered"], today, settings)
    inventory = {"generated": now.isoformat(timespec="seconds"), "day": today,
                 "channels": out_channels, "skipped": skipped, "old": old}
    _write_json(inv_dir / f"{today}.json", inventory)
    _write_json(seen_path, seen)
    return inventory


def _pick_old(candidates: list, offered: dict, today: str, settings: dict) -> list[dict]:
    """The oldest pending items, skipping those offered in the last few days (D31).

    Oldest is a rule of the user's (D31), not a ranking: it says nothing about which
    one matters more.
    """
    cooldown_start = (date.fromisoformat(today)
                      - timedelta(days=settings["old_cooldown_days"])).isoformat()
    picked = []
    for when, _order, _pos, cid, it in sorted(candidates, key=lambda c: c[:3]):
        key = f"{cid}/{it['id']}"
        last = offered.get(key)
        if last and cooldown_start < last < today:
            continue
        picked.append({"channel": cid, "id": it["id"], "title": it["title"],
                       "since": it["born"], **({"link": it["link"]} if it.get("link") else {})})
        offered[key] = today
        if len(picked) >= int(settings["old_per_day"]):
            break
    for key in [k for k, d in offered.items() if d <= cooldown_start]:
        del offered[key]
    return picked


def main(root: Path, day: str | None = None) -> tuple[int, dict]:
    """CLI entry: exit 0 written (even if some channels failed), 1 config refused."""
    try:
        inv = build(root, day=day)
    except ConfigError as exc:
        return 1, {"ok": False, "error": str(exc)}
    errors = [c["id"] for c in inv["channels"] if c["status"] == "error"]
    return 0, {"ok": True, "file": str(root / "inventory" / f"{inv['day']}.json"),
               "channels": len(inv["channels"]), "skipped": len(inv["skipped"]),
               "errors": errors, "new": sum(c.get("new_total") or 0 for c in inv["channels"])}
