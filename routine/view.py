"""The day as a readable markdown sheet. A view of the events, never edited by hand."""
from __future__ import annotations

STATUS_MARK = {"pending": "[ ]", "active": "[>]", "paused": "[~]", "waiting": "[…]", "done": "[x]",
               "dropped": "[-]"}


def render(st: dict) -> str:
    out = [f"# {st['day']}", ""]
    if st.get("mode"):
        hours = f" · {st['hours']} h" if st.get("hours") else ""
        out += [f"Mode: {st['mode']}{hours}", ""]
    out.append("## Tasks")
    for tid in st["order"]:
        t = st["tasks"][tid]
        carried = f" · carried {t['carried']}x" if t.get("carried") else ""
        out.append(f"- {STATUS_MARK[t['status']]} {t.get('title', tid)}{carried}")
        for key in ("done_when", "first_step", "perimeter"):
            if t.get(key):
                out.append(f"  - {key.replace('_', ' ')}: {t[key]}")
        if t.get("tokens"):
            out.append(f"  - tokens: {t['tokens']['input']} in / {t['tokens']['output']} out")
        if t.get("notes"):
            out.append(f"  - last note: {t['notes'][-1]}")
    if st["inbox"]:
        out += ["", "## Inbox"]
        out += [f"- {item['text']}" for item in st["inbox"].values()]
    if st.get("closed"):
        out += ["", "## Close", f"Tomorrow: {st.get('tomorrow') or '-'}"]
    return "\n".join(out) + "\n"
