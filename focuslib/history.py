"""Session log and history formatting for the focus command."""

import math
import os
import shutil
import sys
from datetime import date, datetime, timedelta

from .account import ApiError, api, as_row, aware, local_log, signed_in

ACCENT = "\033[38;2;99;102;241m"
AMBER = "\033[38;2;245;158;11m"
GREEN = "\033[38;2;34;197;94m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def colours_on():
    return sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def read_log(since=None, until=None, limit=None):
    """Blocks, oldest first, in the CSV's shape whatever the source.

    Signed in, the account is the record and this asks it; signed out it is
    ~/focus/sessions.csv, exactly as before. `since` and `until` are local
    wall-clock datetimes, `until` is exclusive so a day and the next never
    both claim a block on the boundary, and `limit` takes the most recent N.
    """
    if not signed_in():
        return local_log(since, until, limit)

    params = {}
    if since is not None:
        params["since"] = aware(since).isoformat()
    if until is not None:
        params["until"] = aware(until).isoformat()
    if limit is not None:
        # The API refuses more than a thousand in one go, and a terminal that
        # wanted to print more than that was not going to be read anyway.
        params["limit"] = min(limit, 1000)
    answer = api("GET", "/focus/sessions", params=params)
    return [as_row(session) for session in answer["sessions"]]


def summary():
    """Minutes today, minutes over the last seven days, blocks ever.

    The three numbers --log prints above its tail. Both window edges are
    worked out here, from this machine's clock, because "today" is a local
    question and the server has no business guessing the answer.
    """
    midnight = datetime.combine(date.today(), datetime.min.time())
    week = midnight - timedelta(days=6)
    if signed_in():
        answer = api("GET", "/focus/sessions/summary", params={
            "day_since": aware(midnight).isoformat(),
            "week_since": aware(week).isoformat(),
        })
        return (answer["today_minutes"], answer["week_minutes"],
                answer["total_sessions"])

    rows = local_log()
    today_min = week_min = 0.0
    for row in rows:
        started = datetime.fromisoformat(row["started"])
        minutes = float(row["actual_minutes"])
        if started >= midnight:
            today_min += minutes
        if started >= week:
            week_min += minutes
    return today_min, week_min, len(rows)


def paint(text, tint, colour=True):
    return (tint + text + RESET) if (colour and tint) else text


def spell(minutes):
    """95 minutes reads better as 1 h 35 min."""
    minutes = int(round(minutes))
    hours, rest = divmod(minutes, 60)
    if not hours:
        return "%d min" % rest
    return "%d h" % hours if not rest else "%d h %d min" % (hours, rest)


def stamp(moment, day, width=5):
    """23:50-00:15 is one block, not a span running backwards, so an end that
    falls on the next day says so."""
    clock = moment.strftime("%H:%M")
    if moment.date() == day or clock == "00:00":   # midnight belongs to both
        return "%-*s" % (width, clock)
    return "%-*s" % (width, clock + "+1")


def parse_when(text):
    """A day, written as it comes to mind.

    today, yesterday, a weekday name for the most recent one, a bare number
    for that day of this month, or a date — day first, as parse_birthday reads
    it: 14-9, 14/09/2026, or ISO. Returns None if it cannot be read.
    """
    today = date.today()
    word = text.strip().lower()
    if word in ("", "today"):
        return today
    if word in ("yesterday", "yday"):
        return today - timedelta(days=1)
    if len(word) >= 3 and word.isalpha():
        for back in range(7):                  # the most recent Tuesday, etc.
            day = today - timedelta(days=back)
            if day.strftime("%A").lower().startswith(word):
                return day
        return None

    for separator in "-/.,":
        word = word.replace(separator, " ")
    parts = [part for part in word.split() if part.isdigit()]
    try:
        if len(parts) == 3 and len(parts[0]) == 4:
            return date(int(parts[0]), int(parts[1]), int(parts[2]))
        if len(parts) == 3:
            year = int(parts[2])
            return date(year + 2000 if year < 100 else year, int(parts[1]), int(parts[0]))
        # A day with no year, or no month, means the most recent one that has
        # already happened — nobody asks what they did next Thursday.
        if len(parts) == 2:
            day = date(today.year, int(parts[1]), int(parts[0]))
            return day if day <= today else date(today.year - 1, int(parts[1]), int(parts[0]))
        if len(parts) == 1:
            day = date(today.year, today.month, int(parts[0]))
            if day > today:
                month = today.month - 1 or 12
                day = date(today.year - (today.month == 1), month, int(parts[0]))
            return day
    except ValueError:
        return None
    return None


def blocks_on(rows, day):
    """Every session that started on that day, in the order it happened."""
    blocks = []
    for row in rows:
        started = datetime.fromisoformat(row["started"])
        if started.date() != day:
            continue
        minutes = float(row["actual_minutes"])
        blocks.append((started, started + timedelta(minutes=minutes), minutes,
                       row["goal"], row["completed"] == "yes"))
    return sorted(blocks)


def strip(blocks, width):
    """The day as one row of cells, from the hour the first block started to
    the hour the last one ended: filled where you were working, dots between."""
    first = blocks[0][0].replace(minute=0, second=0, microsecond=0)
    last = max(block[1] for block in blocks)
    ceiling = last.replace(minute=0, second=0, microsecond=0)
    if ceiling < last:
        ceiling += timedelta(hours=1)
    span = max((ceiling - first).total_seconds(), 3600.0)
    cells = ["·"] * width
    for started, ended, _, _, completed in blocks:
        start = int((started - first).total_seconds() / span * width)
        stop = int(math.ceil((ended - first).total_seconds() / span * width))
        for cell in range(max(0, start), min(width, max(stop, start + 1))):
            cells[cell] = "█" if completed else "▒"
    return first, ceiling, "".join(cells)


def show_day(rows, day, colour, cols):
    """One day: what each block was for, when it started, when it stopped."""
    title = day.strftime("%A %-d %B")
    if day.year != date.today().year:
        title += day.strftime(" %Y")
    blocks = blocks_on(rows, day)
    if not blocks:
        print("%s — nothing logged." % paint(title, BOLD, colour))
        return 0.0

    focused = sum(block[2] for block in blocks)
    # Wider columns only on a day that needs them: most days end before midnight.
    width = 7 if any(block[1].date() != day for block in blocks) else 5
    last = max(block[1] for block in blocks)
    summary = ("%d block%s · %s focused · %s to %s"
               % (len(blocks), "" if len(blocks) == 1 else "s", spell(focused),
                  blocks[0][0].strftime("%H:%M"), stamp(last, day).strip()))
    heading = paint(title, BOLD + ACCENT, colour)
    if len(title) + len(summary) + 3 <= cols:
        print("%s — %s" % (heading, summary))
    else:                                      # too narrow for one line
        print(heading)
        print("  %s" % paint(summary, DIM, colour))
    print()

    room = max(20, cols - 38)
    for index, (started, ended, minutes, goal, completed) in enumerate(blocks):
        if index:
            gap = (started - blocks[index - 1][1]).total_seconds() / 60.0
            if gap >= 5:
                print(paint("    ⋯  %s away" % spell(gap), DIM, colour))
        if len(goal) > room - (width - 5):
            goal = goal[: room - 1] + "…"
        # Pad before colouring: the escape codes would count towards a width.
        state = paint("%-7s" % ("done" if completed else "stopped"),
                      GREEN if completed else AMBER, colour)
        print("  %s–%s  %6s min  %s  %s"
              % (started.strftime("%H:%M"), stamp(ended, day, width),
                 "%.1f" % minutes, state, goal))

    print()
    start, end, cells = strip(blocks, max(12, min(cols - 16, 60)))
    print("  %s %s %s" % (paint(start.strftime("%H:%M"), DIM, colour),
                          paint(cells, ACCENT, colour),
                          paint(stamp(end, day).strip(), DIM, colour)))
    return focused


def show_history(when):
    """--history: a day at a time, or the last seven days at once."""
    colour = colours_on()
    cols = shutil.get_terminal_size((80, 24)).columns
    today = date.today()

    word = (when or "today").strip().lower()
    a_week = word in ("week", "7", "7d")
    if a_week:
        days = [today - timedelta(days=back) for back in range(6, -1, -1)]
    else:
        day = parse_when(word)
        if day is None:
            print("I could not read \"%s\" as a day. Try today, yesterday, "
                  "monday, 14-9 or 2026-09-14." % when, file=sys.stderr)
            return 1
        days = [day]

    # One read for the whole span however many days it covers: the account is
    # a network hop away, and seven of them to draw one week would be silly.
    start = datetime.combine(days[0], datetime.min.time())
    end = datetime.combine(days[-1] + timedelta(days=1), datetime.min.time())
    try:
        rows = read_log(since=start, until=end)
        if not rows and not summary()[2]:
            print("No sessions yet. Run: focus \"your focus\"")
            return 0

        if a_week:
            days = [day for day in days if blocks_on(rows, day)]
            if not days:
                print("Nothing logged in the last seven days.")
                return 0

        total = 0.0
        for index, day in enumerate(days):
            if index:
                print()
            total += show_day(rows, day, colour, cols)

        if len(days) > 1:
            print("\n%s across %d days." % (paint(spell(total), BOLD, colour), len(days)))
        elif not total:
            earlier = read_log(until=start, limit=1)
            if earlier:
                seen = datetime.fromisoformat(earlier[0]["started"]).date()
                print("The last block before that was %s."
                      % seen.strftime("%A %-d %B"))
    except ApiError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


def show_log(limit):
    try:
        today_min, week_min, total = summary()
        rows = read_log(limit=limit)
    except ApiError as error:
        print(error, file=sys.stderr)
        return 1
    if not rows:
        print("No sessions yet. Run: focus \"your focus\"")
        return 0

    print("Today %d min · last 7 days %d min · %d sessions logged\n"
          % (today_min, week_min, total))

    goal_width = max(20, min(50, max(len(r["goal"]) for r in rows)))
    for row in rows:
        when = datetime.fromisoformat(row["started"])
        goal = row["goal"]
        if len(goal) > goal_width:
            goal = goal[: goal_width - 1] + "…"
        print("%s  %-*s  %5s min  %s"
              % (when.strftime("%a %d %b %H:%M"), goal_width, goal,
                 row["actual_minutes"],
                 "done" if row["completed"] == "yes" else "stopped"))
    return 0
