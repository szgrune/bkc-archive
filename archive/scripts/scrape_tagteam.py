#!/usr/bin/env python3
"""
Scrape every item from a Harvard TagTeam hub into a single archive.json with
full metadata per item.

TagTeam's per-page JSON export carries the structured fields (id, url, guid,
authors, hub_feed_ids, tags, dates) but NOT the item description. The Atom
export carries the description (as <summary>) and any full <content>. This
script fetches both, merges them by item id, and writes one record per item.

Usage:
    python3 scripts/scrape_tagteam.py            # hub 1176 -> archive.json
    python3 scripts/scrape_tagteam.py --hub 1176 --out archive.json

It is idempotent: re-running overwrites the output file.
"""

import argparse
import html
import json
import sys
import time
import urllib.request
import urllib.error
from xml.etree import ElementTree as ET

ATOM_NS = "{http://www.w3.org/2005/Atom}"
PER_PAGE = 1000          # TagTeam honours per_page; fewer requests = friendlier
REQUEST_DELAY = 1.0      # seconds between requests (be polite to the server)
MAX_RETRIES = 4
USER_AGENT = "BKC-Archive-Scraper/1.0 (one-time hub export)"


def fetch(url, retries=MAX_RETRIES):
    """GET a URL with retries/backoff, returning the response body as bytes."""
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError) as err:
            last_err = err
            wait = attempt * 2
            print(f"  ! request failed ({err}); retry {attempt}/{retries} in {wait}s",
                  file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"giving up on {url}: {last_err}")


def fetch_json_page(hub, page):
    url = f"https://tagteam.harvard.edu/hubs/{hub}/items.json?page={page}&per_page={PER_PAGE}"
    data = json.loads(fetch(url))
    # In-range pages return {"feed_items":[...]}; past the last page TagTeam
    # returns {"records":[]}. Treat anything without feed_items as "no more".
    return data.get("feed_items", [])


def parse_atom_page(hub, page):
    """Return {item_id: {'description':..., 'content':..., 'atom_author':...}}."""
    url = f"https://tagteam.harvard.edu/hubs/{hub}/items.atom?page={page}&per_page={PER_PAGE}"
    root = ET.fromstring(fetch(url))
    out = {}
    for entry in root.findall(f"{ATOM_NS}entry"):
        raw_id = entry.findtext(f"{ATOM_NS}id", "")          # tag:...:FeedItem/12345
        item_id = int(raw_id.rsplit("/", 1)[-1]) if "/" in raw_id else None
        if item_id is None:
            continue
        summary = entry.findtext(f"{ATOM_NS}summary") or ""
        content = entry.findtext(f"{ATOM_NS}content") or ""
        author_el = entry.find(f"{ATOM_NS}author")
        author = ""
        if author_el is not None:
            author = (author_el.findtext(f"{ATOM_NS}name") or "").strip()
        out[item_id] = {
            "description": html.unescape(summary).strip(),
            "content": html.unescape(content).strip(),
            "atom_author": author,
        }
    return out


def page_count(hub):
    """Total items and pages, read from the hub's HTML pagination is unreliable;
    instead probe by walking JSON pages until one comes back empty."""
    # We don't know the count up front for per_page=1000, so the caller walks
    # pages until an empty result. This helper is kept for clarity/None.
    return None


def scrape(hub):
    items_by_id = {}
    page = 1
    while True:
        print(f"[json] page {page} ...", file=sys.stderr)
        rows = fetch_json_page(hub, page)
        if not rows:
            break
        for row in rows:
            items_by_id[row["id"]] = dict(row)
        time.sleep(REQUEST_DELAY)
        page += 1
    json_pages = page - 1
    print(f"  collected {len(items_by_id)} items from {json_pages} json page(s)",
          file=sys.stderr)

    # Atom pass: same pagination, merge description/content onto each item.
    matched = 0
    for page in range(1, json_pages + 1):
        print(f"[atom] page {page} ...", file=sys.stderr)
        atom = parse_atom_page(hub, page)
        for item_id, extra in atom.items():
            if item_id in items_by_id:
                items_by_id[item_id].update(extra)
                matched += 1
        time.sleep(REQUEST_DELAY)
    print(f"  enriched {matched} items with description/content", file=sys.stderr)

    # Stable order: newest first by publish date, matching the hub's display.
    items = sorted(items_by_id.values(),
                   key=lambda i: i.get("date_published") or "", reverse=True)
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hub", default="1176")
    ap.add_argument("--out", default="archive.json")
    args = ap.parse_args()

    items = scrape(args.hub)
    payload = {
        "source": f"https://tagteam.harvard.edu/hubs/{args.hub}/items",
        "hub_id": int(args.hub),
        "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "item_count": len(items),
        "items": items,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(f"\nWrote {len(items)} items -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
