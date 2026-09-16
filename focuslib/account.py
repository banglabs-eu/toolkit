"""Account synchronization and local session persistence for focus."""

import csv
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime

DEFAULT_API_URL = "https://toolkit.bang-labs.eu"
DEFAULT_ACCOUNTS_URL = "https://accounts.bang-labs.eu"
TIMEOUT = 10
BATCH = 500
LOG_DIR = os.path.expanduser("~/focus")
LOG_FILE = os.path.join(LOG_DIR, "sessions.csv")
TOKEN_FILE = os.path.join(LOG_DIR, "token")
PENDING_FILE = os.path.join(LOG_DIR, "pending.jsonl")
LOG_FIELDS = ["started", "goal", "planned_minutes", "actual_minutes", "completed"]
CSV_NAMESPACE = uuid.UUID("c6db9b12-8780-4784-bd5a-6f9677fb3218")


def local_log(since=None, until=None, limit=None):
    """Read local sessions, optionally filtered by a local datetime range."""
    if not os.path.exists(LOG_FILE):
        return []
    with open(LOG_FILE, newline="") as handle:
        rows = list(csv.DictReader(handle))
    if since is not None or until is not None:
        rows = [
            row for row in rows
            if (since is None or datetime.fromisoformat(row["started"]) >= since)
            and (until is None or datetime.fromisoformat(row["started"]) < until)
        ]
    return rows[-limit:] if limit else rows


class ApiError(Exception):
    """Something the user needs to hear about a request, in their words."""


def api_url():
    return os.environ.get("FOCUS_API_URL", DEFAULT_API_URL).rstrip("/")


def accounts_url():
    return os.environ.get("FOCUS_ACCOUNTS_URL", DEFAULT_ACCOUNTS_URL).rstrip("/")


def load_token():
    try:
        with open(TOKEN_FILE) as fh:
            return fh.read().strip() or None
    except OSError:
        return None


def save_token(token):
    os.makedirs(LOG_DIR, exist_ok=True)
    # A 30-day session for every Bang Labs site, so it is written the way a
    # private key is: created 0600, not chmod-ed to 0600 a moment later.
    handle = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(handle, "w") as fh:
        fh.write(token + "\n")


def clear_token():
    try:
        os.remove(TOKEN_FILE)
    except OSError:
        pass


def signed_in():
    return load_token() is not None


def explain(error):
    """An HTTP failure in the words the service used, when it sent any.

    Every Bang Labs service answers an error with a `detail` — and its
    wording beats anything invented here. "Too many failed attempts. Try
    again in 15 minutes." is the whole message; "HTTP 429" is not.
    """
    try:
        detail = json.loads(error.read().decode()).get("detail")
    except (ValueError, AttributeError, OSError):
        detail = None
    if isinstance(detail, list) and detail:        # a FastAPI validation error
        first = detail[0]
        detail = first.get("msg") if isinstance(first, dict) else None
    return str(detail) if detail else "HTTP %s from %s." % (error.code, error.url)


def request(method, url, body=None, token=None, timeout=TIMEOUT):
    """One JSON request. Returns the decoded body, or raises ApiError
    carrying a sentence worth printing on its own."""
    host = urllib.parse.urlsplit(url).netloc
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token

    call = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(call, timeout=timeout) as response:
            return json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as error:        # a subclass of URLError, so first
        raise ApiError(explain(error)) from None
    except urllib.error.URLError as error:
        raise ApiError("%s is unreachable (%s)." % (host, error.reason)) from None
    except ValueError:
        raise ApiError("%s sent something that was not JSON." % host) from None
    except OSError as error:
        raise ApiError("%s did not answer (%s)." % (host, error)) from None


def api(method, path, body=None, params=None):
    """A call to the toolkit API, signed with the session on this machine."""
    token = load_token()
    if not token:
        raise ApiError("Not signed in. Run: focus --login")
    url = api_url() + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    try:
        return request(method, url, body, token)
    except ApiError as error:
        if "session" in str(error).lower():        # expired, invalid, revoked
            raise ApiError("%s Run: focus --login" % error) from None
        raise


def whoami():
    """The account this machine is signed in as, or None."""
    token = load_token()
    if not token:
        return None
    return request("GET", accounts_url() + "/me", token=token).get("username")


def device():
    """Which machine a block was done on, so a day spent across two of them
    can still be told apart later."""
    return os.uname().nodename


def aware(moment):
    """The absolute instant a local wall-clock time names.

    astimezone() reads a naive datetime as local time, which is what every
    time in this script is — the CSV has always written wall clock.
    """
    return moment.astimezone()


def local(text):
    """An instant from the API as local wall clock, the way the rest of this
    script writes and compares time."""
    moment = datetime.fromisoformat(text)
    if moment.tzinfo is not None:
        moment = moment.astimezone().replace(tzinfo=None)
    return moment


def csv_id(row):
    """A stable id for a block that predates the account.

    The CSV never carried one, so it is derived from the block itself: the
    same row uploaded twice — from a second machine, or a second run of
    --upload — comes out as the same uuid, and the server's idempotency does
    the rest. uuid5 rather than a bare hash, so it is a uuid like the ids
    every block minted since.
    """
    key = "%s|%s|%s" % (row["started"], row["goal"], row["actual_minutes"])
    return str(uuid.uuid5(CSV_NAMESPACE, key))


def as_row(session):
    """A block from the API in the shape the rest of focus reads: the CSV's.

    Keeping this one conversion at the edge is what lets blocks_on, show_day,
    strip and the rest stay exactly as they were, local and naive, whichever
    source the day came from.
    """
    return {
        "started": local(session["started_at"]).isoformat(timespec="seconds"),
        "goal": session["goal"],
        "planned_minutes": "%g" % session["planned_minutes"],
        "actual_minutes": "%.1f" % session["actual_minutes"],
        "completed": "yes" if session["completed"] else "no",
    }


def as_session(row):
    """A CSV row in the shape the API takes."""
    return {
        "client_id": csv_id(row),
        "started_at": aware(datetime.fromisoformat(row["started"])).isoformat(),
        "goal": row["goal"],
        "planned_minutes": float(row["planned_minutes"]),
        "actual_minutes": float(row["actual_minutes"]),
        "completed": row["completed"] == "yes",
    }


def queue(session):
    """Hold a block that could not be uploaded, so a later run can send it.

    The account is the record once you are signed in, but a block you sat
    through is not something to lose to a dropped connection on the way to
    it.
    """
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(PENDING_FILE, "a") as fh:
        fh.write(json.dumps(session) + "\n")


def pending():
    """Blocks waiting to go up, oldest first."""
    try:
        with open(PENDING_FILE) as fh:
            return [json.loads(line) for line in fh if line.strip()]
    except (OSError, ValueError):
        return []


def hold(sessions):
    """Rewrite the queue with what is still waiting."""
    if not sessions:
        try:
            os.remove(PENDING_FILE)
        except OSError:
            pass
        return
    with open(PENDING_FILE, "w") as fh:
        for session in sessions:
            fh.write(json.dumps(session) + "\n")


def flush(quiet=True):
    """Send whatever is waiting, in pages. Returns how many blocks landed."""
    waiting = pending()
    if not waiting:
        return 0
    sent = 0
    for start in range(0, len(waiting), BATCH):
        page = waiting[start:start + BATCH]
        try:
            answer = api("POST", "/focus/sessions/import", {"sessions": page})
        except ApiError as error:
            # Keep only what has not gone up, so a flush that fails halfway
            # still made progress instead of resending from the top forever.
            hold(waiting[start:])
            if not quiet:
                print("Could not send %d waiting block%s: %s"
                      % (len(waiting) - start, "" if len(waiting) - start == 1 else "s",
                         error), file=sys.stderr)
            return sent
        sent += answer["created"]
    hold([])
    return sent


def upload_csv():
    """Send ~/focus/sessions.csv — the blocks logged before there was an
    account to put them in."""
    rows = local_log()
    if not rows:
        print("Nothing in %s to send." % LOG_FILE)
        return 0
    sessions = [as_session(row) for row in rows]
    created = 0
    for start in range(0, len(sessions), BATCH):
        try:
            answer = api("POST", "/focus/sessions/import",
                         {"sessions": sessions[start:start + BATCH]})
        except ApiError as error:
            print(error, file=sys.stderr)
            return 1
        created += answer["created"]
    already = len(sessions) - created
    print("  Uploaded %d block%s%s."
          % (created, "" if created == 1 else "s",
             "" if not already else ", %d already there" % already))
    return 0


def offer_upload():
    """Ask once, at sign-in, about the history already on this machine.

    Without this the account simply starts empty, and a year of blocks
    quietly stops showing up in --log — the CSV is not gone, but it is no
    longer what focus reads.
    """
    rows = local_log()
    if not rows:
        return 0
    if not sys.stdin.isatty():
        return 0
    try:
        answer = input("  Upload the %d block%s already logged on this machine? [Y/n] "
                       % (len(rows), "" if len(rows) == 1 else "s")).strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        answer = "n"
    if answer.startswith("n"):
        print("  Left where they are. focus --upload sends them later.")
        return 0
    return upload_csv()


def do_login():
    """Sign in to accounts.bang-labs.eu, and offer to bring this machine's
    history along."""
    if signed_in():
        try:
            who = whoami()
        except ApiError:
            who = None                             # a dead token; sign in over it
        if who:
            print("Already signed in as %s. Run focus --logout to change account."
                  % who)
            return 0

    print("Sign in with your Bang Labs account — the same one as every other")
    print("bang-labs.eu site. Register at %s if you have none yet." % accounts_url())
    try:
        username = input("  Username: ").strip()
        password = getpass.getpass("  Password: ")
    except (EOFError, KeyboardInterrupt):
        print()
        return 1
    if not username or not password:
        print("Nothing entered. Not signed in.", file=sys.stderr)
        return 1

    try:
        answer = request("POST", accounts_url() + "/login",
                         {"username": username, "password": password,
                          "service": "focus"})
    except ApiError as error:
        print(error, file=sys.stderr)
        return 1

    save_token(answer["token"])
    print("Signed in as %s. Blocks are kept in your account from now on."
          % answer["username"])
    return offer_upload()


def do_logout():
    token = load_token()
    if not token:
        print("Not signed in.")
        return 0

    waiting = len(pending())
    if waiting:
        flush(quiet=False)
    waiting = len(pending())
    if waiting:
        print("%d block%s could not be sent, and stay in %s until the next "
              "sign-in." % (waiting, "" if waiting == 1 else "s", PENDING_FILE),
              file=sys.stderr)

    try:
        request("POST", accounts_url() + "/logout", {}, token=token)
    except ApiError:
        pass                                       # the token goes either way
    clear_token()
    print("Signed out. focus logs to %s again." % LOG_FILE)
    return 0


def do_whoami():
    if not signed_in():
        print("Not signed in — blocks are logged to %s." % LOG_FILE)
        print("Run focus --login to keep them in your Bang Labs account.")
        return 0
    try:
        who = whoami()
    except ApiError as error:
        print(error, file=sys.stderr)
        return 1
    print("Signed in as %s." % who)
    print("Blocks are kept at %s." % api_url())
    waiting = len(pending())
    if waiting:
        print("%d block%s waiting to upload. Run: focus --sync"
              % (waiting, "" if waiting == 1 else "s"))
    return 0


def do_sync():
    if not signed_in():
        print("Not signed in. Run: focus --login", file=sys.stderr)
        return 1
    waiting = len(pending())
    if not waiting:
        print("Nothing waiting.")
        return 0
    flush(quiet=False)
    left = len(pending())
    print("Sent %d of %d waiting block%s."
          % (waiting - left, waiting, "" if waiting == 1 else "s"))
    return 1 if left else 0


def record(started, goal, planned, actual, completed, theme=None):
    """Keep the block: in the account when there is one, in the CSV when
    there is not, and never nowhere."""
    if not signed_in():
        record_locally(started, goal, planned, actual, completed)
        return

    session = {
        "client_id": str(uuid.uuid4()),
        "started_at": aware(started).isoformat(),
        "goal": goal,
        "planned_minutes": float(planned),
        "actual_minutes": round(actual, 1),
        "completed": completed,
        "theme": theme,
        "device": device(),
    }
    try:
        api("POST", "/focus/sessions", session)
    except ApiError as error:
        queue(session)
        print("Kept on this machine for now — %s" % error, file=sys.stderr)
        return
    flush()                                        # anything an earlier block left


def record_locally(started, goal, planned, actual, completed):
    os.makedirs(LOG_DIR, exist_ok=True)
    new = not os.path.exists(LOG_FILE)
    with open(LOG_FILE, "a", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=LOG_FIELDS)
        if new:
            writer.writeheader()
        writer.writerow(
            {
                "started": started.isoformat(timespec="seconds"),
                "goal": goal,
                "planned_minutes": "%g" % planned,
                "actual_minutes": "%.1f" % actual,
                "completed": "yes" if completed else "no",
            }
        )



