"""Browser side of the Weekly Shop agent: everything that touches waitrose.com.

Rules this module keeps:
  * It never checks out and never opens a payment page. Any navigation to a checkout or
    payment URL is blocked inside the browser itself, so a mis-click can't get there either.
  * It never types the Waitrose password. You sign in yourself once (`agent.py login`), and the
    sign-in lives in a browser profile on this PC only.
  * When filling an order it only adds or raises quantities. It never removes anything or lowers a quantity.

Waitrose changes its pages from time to time. Every selector the agent relies on is in SEL below,
so a fix is usually a one-line change here.
"""
from __future__ import annotations

import os
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

from playwright.sync_api import BrowserContext, Page, sync_playwright

BASE = os.environ.get("WAITROSE_BASE", "https://www.waitrose.com").rstrip("/")
SEARCH_URL = BASE + "/ecom/shop/search?&searchTerm={q}"
ORDERS_URL = os.environ.get("WAITROSE_ORDERS_URL", BASE + "/ecom/my-orders")
HOME_URL = BASE + "/"

SEL = {
    "pod": 'article[data-testid="product-pod"]',
    "pod_name": '[data-testid="product-pod-name"]',
    "pod_size": '[data-testid="product-size"]',
    "pod_price": '[data-testid="trolleyControls"]',
    "pod_qty_input": 'input[type="number"], input[name="quantity"], input[aria-label*="uantity"]',
    "pod_add": 'button:has-text("Add")',
    "pod_plus": 'button[aria-label*="ncrease"], button[aria-label*="Add one"], button[data-testid*="increment"]',
    "signed_in_hint": 'a[href*="my-account"], a[href*="myaccount"], button:has-text("My account"), a:has-text("My account"), a:has-text("Sign out")',
    "amend_button": 'a:has-text("Amend"), button:has-text("Amend")',
}
# Never let the agent's browser reach these.
BLOCKED = re.compile(r"/(checkout|payment|payments|pay|wallet)(/|\?|$)", re.I)

PROFILE_DIR = Path(os.environ.get("WS_PROFILE_DIR", Path(__file__).with_name("profile")))


@dataclass
class Product:
    name: str
    size: str
    price: float | None
    offer: str | None
    pid: str | None
    qty_in_trolley: int = 0
    index: int = 0

    @property
    def label(self) -> str:
        return (self.name + (" " + self.size if self.size else "")).strip()


def norm_tokens(s: str) -> list[str]:
    s = s.lower().replace("&", " and ").replace("'", "")
    return re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", s)


def match_score(wanted: str, cand: str) -> float:
    """1.0 = same product label. Size words (numbers, units) count double so 2 pints != 4 pints."""
    w, c = norm_tokens(wanted), norm_tokens(cand)
    if not w or not c:
        return 0.0
    if w == c:
        return 1.0
    def weight(t: str) -> float:
        return 2.0 if re.search(r"\d", t) else 1.0
    cs = set(c)
    hit = sum(weight(t) for t in w if t in cs)
    total = sum(weight(t) for t in w) + 0.5 * sum(weight(t) for t in c if t not in set(w))
    return hit / total if total else 0.0


def parse_price(text: str) -> float | None:
    if not text:
        return None
    m = re.search(r"£\s*(\d+(?:\.\d{1,2})?)", text)
    if m:
        return float(m.group(1))
    m = re.search(r"(\d+(?:\.\d+)?)\s*p\b", text)
    return round(float(m.group(1)) / 100, 2) if m else None


EXTRACT_JS = """(sel) => [...document.querySelectorAll(sel.pod)].map((pod, i) => {
  const t = (s) => { const e = pod.querySelector(s); return e ? e.textContent.trim() : ""; };
  const inp = pod.querySelector(sel.pod_qty_input);
  const priceText = t(sel.pod_price) || ([...pod.querySelectorAll('*')].map(e => e.childElementCount ? '' : e.textContent).find(x => /£|\\dp\\b/.test(x)) || "");
  const offerAttr = pod.getAttribute('data-product-on-offer');
  const offerText = [...pod.querySelectorAll('*')].map(e => e.childElementCount ? '' : e.textContent.trim()).find(x => /^(was\\s|save\\s|offer|\\d+ for|half price|1\\/3 off|add \\d+ for)/i.test(x)) || null;
  return { index: i, name: t(sel.pod_name), size: t(sel.pod_size), priceText,
           offer: (offerAttr === 'true' || offerText) ? (offerText || 'On offer') : null,
           pid: pod.getAttribute('data-product-id'),
           qty: inp ? (parseInt(inp.value, 10) || 0) : 0 };
})"""


@dataclass
class Waitrose:
    headless: bool = False
    channel: str | None = None  # "chrome" uses the installed Google Chrome, which Waitrose treats more kindly
    slow: float = 0.6           # seconds between page actions, so we behave like a person
    log: list[str] = field(default_factory=list)

    def __enter__(self) -> "Waitrose":
        self._pw = sync_playwright().start()
        PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        kw = dict(user_data_dir=str(PROFILE_DIR), headless=self.headless, viewport={"width": 1280, "height": 900}, locale="en-GB")
        try:
            self.ctx: BrowserContext = self._pw.chromium.launch_persistent_context(**kw, **({"channel": self.channel} if self.channel else {}))
        except Exception:
            if not self.channel:
                raise
            # Google Chrome isn't installed: use Playwright's own Chromium instead
            self.ctx = self._pw.chromium.launch_persistent_context(**kw)
        self.ctx.route("**/*", self._guard)
        self.page: Page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        self.page.set_default_timeout(20000)
        return self

    def __exit__(self, *exc) -> None:
        try:
            self.ctx.close()
        finally:
            self._pw.stop()

    @staticmethod
    def _guard(route, request) -> None:
        if request.is_navigation_request() and BLOCKED.search(urllib.parse.urlparse(request.url).path):
            route.abort("blockedbyclient")
        else:
            route.continue_()

    def pause(self, k: float = 1.0) -> None:
        time.sleep(self.slow * k)

    # ---------- sign-in ----------
    def is_signed_in(self) -> bool:
        self.page.goto(HOME_URL, wait_until="domcontentloaded")
        self.pause(2)
        return self.page.locator(SEL["signed_in_hint"]).count() > 0

    def interactive_login(self) -> bool:
        self.page.goto(HOME_URL, wait_until="domcontentloaded")
        print("\nA browser window has opened on waitrose.com.")
        print("Sign in there yourself (accept or decline cookies as you like).")
        input("When you can see your account, come back here and press Enter... ")
        ok = self.is_signed_in()
        print("Signed in. The agent will reuse this sign-in." if ok else "The agent can't see a signed-in account yet. Run login again.")
        return ok

    # ---------- search ----------
    def search(self, query: str) -> list[Product]:
        self.page.goto(SEARCH_URL.format(q=urllib.parse.quote(query)), wait_until="domcontentloaded")
        try:
            self.page.wait_for_selector(SEL["pod"], timeout=12000)
        except Exception:
            return []
        self.pause()
        rows = self.page.evaluate(EXTRACT_JS, SEL)
        out = []
        for r in rows:
            if not r["name"]:
                continue
            out.append(Product(name=r["name"], size=r["size"], price=parse_price(r["priceText"]), offer=r["offer"],
                               pid=r["pid"], qty_in_trolley=r["qty"], index=r["index"]))
        return out

    def find(self, label: str, min_score: float = 0.72) -> tuple[Product | None, float, list[Product]]:
        hits = self.search(label)
        best, score = None, 0.0
        for p in hits[:24]:
            s = match_score(label, p.label)
            if s > score:
                best, score = p, s
        return (best if score >= min_score else None), score, hits

    # ---------- orders ----------
    def open_amend(self, delivery_iso: str, interactive: bool) -> str:
        """Put the booked order for this delivery date into amend mode.
        Returns 'ok', or a sentence saying what went wrong."""
        from datetime import date
        d = date.fromisoformat(delivery_iso)
        forms = {d.strftime(f) for f in ("%A %d %B", "%a %d %b", "%d %B", "%d %b %Y", "%d/%m/%Y")}
        forms |= {f.replace(" 0", " ") for f in forms} | {f.lstrip("0") for f in forms}
        self.page.goto(ORDERS_URL, wait_until="domcontentloaded")
        self.pause(3)
        body = self.page.inner_text("body")
        if re.search(r"amending|you are amending|finish amending", body, re.I):
            return "ok"  # already in amend mode
        found = any(f.lower() in body.lower() for f in forms)
        if found:
            # click the Amend control nearest to the matching date
            for f in sorted(forms, key=len, reverse=True):
                card = self.page.locator(f"xpath=//*[contains(normalize-space(.), '{f}')]/ancestor-or-self::*[.//a[contains(., 'Amend')] or .//button[contains(., 'Amend')]][1]")
                if card.count():
                    card.first.locator(SEL["amend_button"]).first.click()
                    self.pause(4)
                    return "ok"
        if interactive:
            print(f"\nI couldn't find the Amend button for the order delivering {d:%A %d %B}.")
            input("Please open that order in amend mode in the browser window, then press Enter here... ")
            return "ok"
        return (f"Couldn't find a booked order delivering {d:%a %d %b} on the PC. "
                "Book the slot, or run the agent once with --interactive so it can be shown where it is.")

    # ---------- trolley ----------
    def set_quantity(self, prod: Product, target: int) -> int:
        """Raise the quantity of a search-result product to target. Never lowers. Returns final qty."""
        pod = self.page.locator(SEL["pod"]).nth(prod.index)
        pod.scroll_into_view_if_needed()
        inp = pod.locator(SEL["pod_qty_input"])
        if not inp.count():
            add = pod.locator(SEL["pod_add"])
            if not add.count():
                raise RuntimeError("no Add button")
            add.first.click()
            self.pause(2)
            inp = pod.locator(SEL["pod_qty_input"])
        current = int(inp.first.input_value() or 0) if inp.count() else 1
        if current >= target:
            return current
        if inp.count():
            inp.first.fill(str(target))
            inp.first.press("Enter")
            self.pause(2.5)
            try:
                current = int(pod.locator(SEL["pod_qty_input"]).first.input_value() or 0)
            except Exception:
                pass
        tries = 0
        while current < target and tries < 12:
            plus = pod.locator(SEL["pod_plus"])
            if not plus.count():
                break
            plus.first.click()
            self.pause(1.5)
            tries += 1
            try:
                current = int(pod.locator(SEL["pod_qty_input"]).first.input_value() or current + 1)
            except Exception:
                current += 1
        return current
