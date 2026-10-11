"""Weekly Shop agent for the PC.

It signs in to the household database as its own limited account, then does what the phones ask:
  * refreshes Waitrose prices when someone taps "Check latest prices"
  * finds Waitrose products for items and recipe ingredients added on a phone
  * when a week is marked ready, adds that list to the booked Waitrose order (amend mode)

It never checks out and never pays. You confirm the amended order yourself in the Waitrose app.

Commands (run from this folder):
  python agent.py setup              one-off: database address, agent email, and its password (kept in Windows Credential Manager)
  python agent.py login              one-off: opens a browser so you can sign in to Waitrose yourself
  python agent.py check              checks both connections
  python agent.py prices             refresh prices now
  python agent.py lookups            find products waiting to be looked up
  python agent.py fill               go through weeks marked ready (dry run unless FILL_MODE=commit or --commit)
  python agent.py fill --commit --interactive    the first real run: you watch, it asks you if it gets stuck
  python agent.py watch              keep running and do all of the above when asked (used by the scheduled task)
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import time
import traceback
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV = HERE / ".env"
KEYRING_SERVICE = "weekly-shop-agent"


# ---------------------------------------------------------------- config
def load_env() -> None:
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def parse_ts(s: str | None) -> float:
    if not s:
        return 0.0
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def log(msg: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
    print(line, flush=True)
    try:
        with open(HERE / "agent.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------- database
class DB:
    """The household's documents, through the agent's own (limited) account."""

    def __init__(self) -> None:
        from supabase import create_client
        import keyring

        url, key, email = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY"), os.environ.get("AGENT_EMAIL")
        if not (url and key and email):
            sys.exit("Not set up yet. Run: python agent.py setup")
        pw = os.environ.get("AGENT_PASSWORD") or keyring.get_password(KEYRING_SERVICE, email)
        if not pw:
            sys.exit("The agent's password isn't stored on this PC. Run: python agent.py setup")
        self.sb = create_client(url, key)
        self.sb.auth.sign_in_with_password({"email": email, "password": pw})
        hh = self.sb.rpc("claim_invites").execute().data or []
        hh = [h if isinstance(h, str) else (h.get("claim_invites") or next(iter(h.values()))) for h in hh]
        if not hh:
            sys.exit(f"{email} isn't part of a household. Check setup-household.sql was run with this email as agent_email.")
        self.hh = hh[0]

    def get(self, path: str) -> dict | None:
        r = self.sb.table("docs").select("data").eq("household_id", self.hh).eq("path", path).limit(1).execute()
        return r.data[0]["data"] if r.data else None

    def prefix(self, prefix: str) -> dict[str, dict]:
        out, start = {}, 0
        while True:
            r = (self.sb.table("docs").select("path,data").eq("household_id", self.hh)
                 .like("path", prefix + "%").order("path").range(start, start + 499).execute())
            out.update({row["path"]: row["data"] for row in r.data})
            if len(r.data) < 500:
                return out
            start += 500

    def put(self, path: str, data: dict) -> None:
        """Update an existing document. The agent can't create or delete documents, by design."""
        r = self.sb.table("docs").update({"data": data}).eq("household_id", self.hh).eq("path", path).execute()
        if not r.data:
            raise RuntimeError(f"couldn't update {path} (missing, or not allowed for the agent)")

    def patch(self, path: str, fn) -> dict | None:
        """Re-read just before writing so a phone edit made a moment ago isn't lost."""
        cur = self.get(path)
        if cur is None:
            return None
        new = fn(json.loads(json.dumps(cur)))
        self.put(path, new)
        return new


# ---------------------------------------------------------------- jobs
def all_products(db: DB, master: dict) -> list[str]:
    seen: dict[str, None] = {}
    for k in ("staples", "topups", "drinks", "household"):
        for i in master.get(k, []):
            if i.get("product"):
                seen[i["product"]] = None
    for m in master.get("meals", []):
        for b in m.get("buy", []):
            if b.get("product"):
                seen[b["product"]] = None
    for b in (master.get("breakfasts") or {}).values():
        for opt in b if isinstance(b, list) else []:
            for i in (opt.get("buy") or opt.get("items") or []) if isinstance(opt, dict) else []:
                if isinstance(i, dict) and i.get("product"):
                    seen[i["product"]] = None
    for doc in db.prefix("recipes/").values():
        for b in doc.get("buy", []):
            if b.get("product") and not b.get("pending"):
                seen[b["product"]] = None
    for doc in db.prefix("items/").values():
        if doc.get("product") and not doc.get("pending"):
            seen[doc["product"]] = None
    return list(seen)


def job_prices(db: DB, wr, force: bool = False) -> None:
    master = db.get("catalog/master")
    req = db.get("requests/prices") or {}
    if not force and parse_ts(req.get("requestedAt")) <= parse_ts(master.get("pricesCheckedAt")):
        return
    products = all_products(db, master)
    log(f"Checking prices for {len(products)} products")
    found, missing = {}, []
    for label in products:
        p, score, _ = wr.find(label)
        if p and p.price is not None:
            found[label] = {"price": p.price, "offer": p.offer, "checkedAt": now_iso()}
        else:
            missing.append(label)
        wr.pause()

    def apply(m: dict) -> dict:
        m.setdefault("prices", {}).update(found)
        for label in missing:
            if label in m["prices"]:
                m["prices"][label]["unavailable"] = True
        m["pricesCheckedAt"] = now_iso()
        return m

    db.patch("catalog/master", apply)
    log(f"Prices updated: {len(found)} found, {len(missing)} not found" + (": " + "; ".join(missing[:8]) if missing else ""))


def job_lookups(db: DB, wr) -> None:
    req = db.get("requests/lookups")
    items = (req or {}).get("items") or []
    if not items:
        return
    log(f"Looking up {len(items)} product(s)")
    results, keep = {}, []
    for it in items:
        text = it.get("text", "").strip()
        p, score, hits = wr.find(text, min_score=0.0)  # a typed description: take Waitrose's best match
        if not p and hits:
            p = hits[0]
        if p:
            results[text] = {"product": p.label, "price": p.price, "waitroseId": p.pid, "offer": p.offer}
        else:
            it["attempts"] = it.get("attempts", 0) + 1
            if it["attempts"] < 3:
                keep.append(it)
        wr.pause()
    # resolve the pending entries that were waiting on these
    for path, doc in db.prefix("recipes/").items():
        if any(b.get("pending") and b.get("product") in results for b in doc.get("buy", [])):
            def fix(d):
                for b in d.get("buy", []):
                    r = results.get(b.get("product"))
                    if b.get("pending") and r:
                        b.update({k: v for k, v in r.items() if v is not None and k != "offer"})
                        b.pop("pending", None)
                return d
            db.patch(path, fix)
    for path, doc in db.prefix("items/").items():
        r = results.get(doc.get("product"))
        if doc.get("pending") and r:
            def fix(d, r=r):
                d.update({k: v for k, v in r.items() if v is not None and k != "offer"})
                d.pop("pending", None)
                return d
            db.patch(path, fix)
    key = lambda i: (i.get("text", "").strip(), i.get("requestedAt"))
    seen = {key(i) for i in items}

    def tidy(d: dict) -> dict:
        newer = [i for i in d.get("items", []) if key(i) not in seen]  # asked for while we were searching
        return {**d, "items": keep + newer, "checkedAt": now_iso()}

    db.patch("requests/lookups", tidy)
    log(f"Lookups: {len(results)} found" + (f", {len(items) - len(results)} not found" if len(items) > len(results) else ""))


def due_runs(db: DB, include_dry: bool, retry_failed: bool = False) -> list[tuple[str, dict]]:
    today = date.today().isoformat()
    out = []
    for path, r in db.prefix("runs/").items():
        if path.count("/") != 1 or r.get("status") != "ready" or not r.get("finalList"):
            continue
        if (r.get("delivery") or "") < today:
            continue
        ready = parse_ts(r.get("readyAt"))
        if ready <= parse_ts(r.get("filledAt")):
            continue
        ag = r.get("agent") or {}
        if not include_dry and ready <= parse_ts(ag.get("dryRunFor")):
            continue
        if not retry_failed and ready <= parse_ts(ag.get("failedFor")):
            continue  # already reported a problem with this list; wait for Mark ready again
        out.append((path, r))
    return sorted(out, key=lambda x: x[1].get("delivery", ""))


def fail(db: DB, path: str, run: dict, msg: str) -> None:
    def f(r: dict) -> dict:
        r["report"] = msg
        r["agent"] = {**(r.get("agent") or {}), "lastError": msg, "failedFor": run.get("readyAt"), "at": now_iso()}
        return r
    db.patch(path, f)
    log(msg)


def job_fill(db: DB, wr, commit: bool, interactive: bool, only: str | None = None) -> None:
    runs = due_runs(db, include_dry=commit or bool(only), retry_failed=interactive or bool(only))
    if only:
        runs = [x for x in runs if x[0].endswith("/" + only)]
    for path, run in runs:
        delivery = run["delivery"]
        nice = date.fromisoformat(delivery).strftime("%a %d %b").replace(" 0", " ")
        changed_after = parse_ts(run.get("updatedAt")) > parse_ts(run.get("readyAt"))
        lst = run["finalList"]
        log(f"{'Filling' if commit else 'Dry run for'} {delivery}: {len(lst)} lines")
        lines, problems, added_total = [], [], 0.0
        if commit:
            if not wr.is_signed_in():
                fail(db, path, run, "The PC isn't signed in to Waitrose any more. On the PC, run: python agent.py login. Then tap Mark ready again.")
                return
            status = wr.open_amend(delivery, interactive)
            if status != "ok":
                fail(db, path, run, status + " Then tap Mark ready again.")
                continue
        for e in lst:
            label, qty = e.get("product"), int(e.get("qty") or 0)
            if not label or qty <= 0:
                continue
            try:
                p, score, _ = wr.find(label)
                if not p:
                    problems.append(f"✗ {label}: no close match on Waitrose")
                    continue
                note = "" if score >= 0.999 else f" (closest: {p.label})"
                if commit:
                    final = wr.set_quantity(p, qty)
                    if final < qty:
                        problems.append(f"✗ {label}: only got to {final} of {qty}")
                    else:
                        lines.append(f"✓ {qty} × {p.label}" + (f" (already {final} in the order)" if final > qty else "") + note)
                else:
                    lines.append(f"• {qty} × {p.label}{' · £%.2f' % p.price if p.price is not None else ''}{note}")
                if p.price is not None:
                    added_total += p.price * qty
            except Exception as ex:  # keep going with the rest of the list
                problems.append(f"✗ {label}: {ex.__class__.__name__}")
            wr.pause()
        head = (f"Added to your Waitrose order for {nice}. Open the Waitrose app to check and confirm."
                if commit else
                f"Dry run (nothing added yet): this is what the agent would add for {nice}.")
        if changed_after:
            head += "\nNote: the list changed after it was marked ready. This used the list as marked; tap Mark ready again to send the newer one."
        report = "\n".join([head, f"{len(lines)} {'added' if commit else 'found'}, {len(problems)} need a look · about £{added_total:.2f}", *problems, *lines])

        def finish(r: dict) -> dict:
            r["report"] = report
            ag = dict(r.get("agent") or {})
            ag["at"] = now_iso()
            if commit:
                r["status"] = "filled"
                r["filledAt"] = now_iso()
            else:
                ag["dryRunFor"] = run.get("readyAt")
            r["agent"] = ag
            return r

        db.patch(path, finish)
        log(f"Done {delivery}: {len(lines)} ok, {len(problems)} problems")


# ---------------------------------------------------------------- commands
def cmd_setup() -> None:
    import keyring

    load_env()
    print("Weekly Shop agent setup. Values in [brackets] are kept if you just press Enter.\n")
    vals = {}
    for k, prompt in [("SUPABASE_URL", "Supabase project URL (https://xxxx.supabase.co)"),
                      ("SUPABASE_KEY", "Supabase publishable (anon) key"),
                      ("AGENT_EMAIL", "The agent's email address (the one you added in Supabase)")]:
        cur = os.environ.get(k, "")
        v = input(f"{prompt} [{cur}]: ").strip() or cur
        vals[k] = v
    vals["FILL_MODE"] = os.environ.get("FILL_MODE", "dry-run")
    vals["BROWSER_CHANNEL"] = os.environ.get("BROWSER_CHANNEL", "chrome")
    vals["WATCH_MINUTES"] = os.environ.get("WATCH_MINUTES", "10")
    ENV.write_text("\n".join(f"{k}={v}" for k, v in vals.items()) + "\n", encoding="utf-8")
    pw = getpass.getpass("The agent's database password (typing is hidden): ")
    if pw:
        keyring.set_password(KEYRING_SERVICE, vals["AGENT_EMAIL"], pw)
        print("Password stored in Windows Credential Manager (not in any file).")
    for k, v in vals.items():
        os.environ[k] = v
    DB()
    print("Connected to the household database. Next: python agent.py login")


def work_waiting(db: DB, commit: bool) -> bool:
    master = db.get("catalog/master") or {}
    if parse_ts((db.get("requests/prices") or {}).get("requestedAt")) > parse_ts(master.get("pricesCheckedAt")):
        return True
    if (db.get("requests/lookups") or {}).get("items"):
        return True
    return bool(due_runs(db, include_dry=commit))


def watch(db: DB, commit: bool) -> None:
    """Check the database every few minutes; open the browser only when there's something to do."""
    every = max(2, int(os.environ.get("WATCH_MINUTES", "10")))
    log(f"Watching every {every} min ({'adding to orders' if commit else 'dry runs only'}). Close this window to stop.")
    while True:
        try:
            if work_waiting(db, commit):
                with browser() as wr:
                    for job in (lambda: job_prices(db, wr), lambda: job_lookups(db, wr),
                                lambda: job_fill(db, wr, commit=commit, interactive=False)):
                        try:
                            job()
                        except Exception:
                            log("Error: " + traceback.format_exc(limit=2).strip().splitlines()[-1])
        except Exception:
            log("Error: " + traceback.format_exc(limit=2).strip().splitlines()[-1])
            try:
                db = DB()  # sign in again (network blip, or the session expired)
            except BaseException:
                pass
        time.sleep(every * 60)


def browser(headless: bool | None = None):
    from waitrose import Waitrose
    h = os.environ.get("HEADLESS", "0") == "1" if headless is None else headless
    return Waitrose(headless=h, channel=os.environ.get("BROWSER_CHANNEL") or None)


def main() -> None:
    load_env()
    ap = argparse.ArgumentParser(description="Weekly Shop agent")
    ap.add_argument("command", choices=["setup", "login", "check", "prices", "lookups", "fill", "watch"])
    ap.add_argument("--commit", action="store_true", help="really add to the Waitrose order (otherwise a dry run)")
    ap.add_argument("--interactive", action="store_true", help="ask in this window when stuck")
    ap.add_argument("--run", help="only this week (the run id)")
    ap.add_argument("--force", action="store_true", help="prices: check even if nobody asked")
    a = ap.parse_args()

    if a.command == "setup":
        return cmd_setup()
    if a.command == "login":
        with browser(headless=False) as wr:
            wr.interactive_login()
        return
    db = DB()
    commit = a.commit or os.environ.get("FILL_MODE", "dry-run") == "commit"
    if a.command == "check":
        print(f"Database: connected, household {db.hh}")
        with browser() as wr:
            print("Waitrose: " + ("signed in" if wr.is_signed_in() else "NOT signed in. Run: python agent.py login"))
        return
    if a.command == "watch":
        return watch(db, commit)
    with browser() as wr:
        if a.command == "prices":
            job_prices(db, wr, force=True)
        elif a.command == "lookups":
            job_lookups(db, wr)
        elif a.command == "fill":
            job_fill(db, wr, commit=commit, interactive=a.interactive, only=a.run)



if __name__ == "__main__":
    main()
