import os, time, json, feedparser, concurrent.futures, hashlib, datetime
from bs4 import BeautifulSoup
from urllib.parse import urlparse

USER_AGENT = os.environ.get("USER_AGENT", "SecurityNewsBot/1.2 (+https://treatchaos.github.io/security-news-feed-modern/)")
feedparser.USER_AGENT = USER_AGENT

MAX_ITEMS_PER_FEED = int(os.environ.get("MAX_ITEMS_PER_FEED", 5))
DESC_LIMIT = int(os.environ.get("DESC_LIMIT", 400))
ENABLE_CONCURRENCY = os.environ.get("DISABLE_CONCURRENCY") is None
# New archive-related settings
RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", 90))
ARCHIVE_PATH = os.environ.get("ARCHIVE_PATH", "archive.json")
HISTORY_DIR = os.environ.get("HISTORY_DIR", "history")  # per-day files
HISTORY_INDEX_PATH = os.path.join(HISTORY_DIR, "index.json")

SOURCES = [
    "https://securityonline.info/category/news/vulnerability/feed/",
    "https://www.bleepingcomputer.com/feed/",
    "https://www.securityweek.com/feed/",
    "https://thehackernews.com/feeds/posts/default",
    "https://www.darkreading.com/rss.xml",
    "https://threatpost.com/feed/",
    "https://www.zero-day.cz/feed/",
    "https://www.zerodayinitiative.com/rss/upcoming/",
    "https://www.cisa.gov/known-exploited-vulnerabilities-catalog.xml",
    "https://cybersecuritynews.com/feed/",
]

# ----------------- Helpers -----------------

def clean_html(text: str) -> str:
    if not text:
        return ""
    soup = BeautifulSoup(text, "html.parser")
    return " ".join(soup.get_text().split())

def trim(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit - 1].rsplit(" ", 1)[0] + "…"

def normalize_date(entry) -> str:
    for key in ("published_parsed", "updated_parsed"):
        dt_struct = entry.get(key)
        if dt_struct:
            try:
                return time.strftime("%Y-%m-%dT%H:%M:%SZ", dt_struct)
            except Exception:
                pass
    for key in ("published", "updated"):
        if entry.get(key):
            return entry.get(key)
    return ""

def domain_from_link(link: str) -> str:
    try:
        return urlparse(link).netloc.replace("www.", "")
    except Exception:
        return "unknown"

def hash_entry(title: str, link: str) -> str:
    return hashlib.sha1(f"{title}|{link}".encode()).hexdigest()

# New helper functions for archive management

def parse_iso(ts: str):
    if not ts:
        return None
    try:
        # Support both Z and +00:00
        if ts.endswith('Z'):
            ts = ts.replace('Z', '+00:00')
        return datetime.datetime.fromisoformat(ts)
    except Exception:
        return None

def load_json(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None

def write_json_if_changed(path, data):
    existing = load_json(path)
    if existing == data:
        return False
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return True

# ----------------- Fetch -----------------

def fetch_feed(url: str):
    t0 = time.time()
    items = []
    try:
        feed = feedparser.parse(url)
        for entry in feed.entries[:MAX_ITEMS_PER_FEED]:
            title = entry.get("title", "(no title)").strip()
            link = entry.get("link", "").strip()
            desc = trim(clean_html(entry.get("summary", entry.get("description", ""))), DESC_LIMIT)
            date_iso = normalize_date(entry)
            items.append({
                "title": title,
                "link": link,
                "date": date_iso,
                "description": desc,
                "source": domain_from_link(link)
            })
    except Exception as e:
        print(f"ERROR: {url} -> {e}")
    dur = (time.time() - t0) * 1000
    print(f"Fetched {url} ({len(items)} items) in {dur:.0f}ms")
    return items

# ----------------- Main -----------------

def gather_items():
    all_items = []
    seen = set()
    if ENABLE_CONCURRENCY:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(SOURCES))) as executor:
            for feed_items in executor.map(fetch_feed, SOURCES):
                for it in feed_items:
                    h = hash_entry(it['title'], it['link'])
                    if h in seen:
                        continue
                    seen.add(h)
                    all_items.append(it)
    else:
        for url in SOURCES:
            for it in fetch_feed(url):
                h = hash_entry(it['title'], it['link'])
                if h in seen:
                    continue
                seen.add(h)
                all_items.append(it)
    return all_items

def sort_items(items):
    def date_key(x):
        try:
            # Attempt ISO parse
            return datetime.datetime.fromisoformat(x['date'].replace('Z','+00:00')) if x['date'] else datetime.datetime.min
        except Exception:
            return datetime.datetime.min
    return sorted(items, key=date_key, reverse=True)

def read_existing(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None

def main():
    now_dt = datetime.datetime.now(datetime.timezone.utc)
    now_str = now_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    items = sort_items(gather_items())
    payload = {
        "last_updated": now_str,
        "count": len(items),
        "items": items
    }
    out_path = 'news.json'
    existing = load_json(out_path)
    # Backward compatibility: legacy file was a raw list
    if isinstance(existing, list):
        existing = {"items": existing}
    news_unchanged = isinstance(existing, dict) and existing.get('items') == payload['items']
    if news_unchanged:
        print("No content changes in news.json (will still ensure archive & history).")
    else:
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        print(f"Wrote {payload['count']} items -> {out_path}")
    print("Updating archive & daily history...")

    # ---- Archive update ----
    archive = load_json(ARCHIVE_PATH) or {"items": []}
    if isinstance(archive, list):  # legacy safety
        archive = {"items": archive}
    archive_items = archive.get('items', [])

    # Build map
    idx = {it.get('id') or hash_entry(it['title'], it['link']): it for it in archive_items}

    changed = False
    for it in items:
        _id = hash_entry(it['title'], it['link'])
        if _id not in idx:
            new_entry = {
                "id": _id,
                **it,
                "first_seen": now_str,
                "last_seen": now_str
            }
            idx[_id] = new_entry
            changed = True
        else:
            # Update last_seen if different
            if idx[_id].get('last_seen') != now_str:
                idx[_id]['last_seen'] = now_str
                changed = True
            # Optionally refresh description if new one longer
            if len(it.get('description','')) > len(idx[_id].get('description','')):
                idx[_id]['description'] = it['description']

    # Retention pruning
    cutoff = now_dt - datetime.timedelta(days=RETENTION_DAYS)
    pruned = {}
    for _id, it in idx.items():
        fs = parse_iso(it.get('first_seen'))
        if not fs or fs >= cutoff:
            pruned[_id] = it
        else:
            changed = True
    idx = pruned

    # Sort archive by original article date (fallback: first_seen) desc
    def sort_key(a):
        d = parse_iso(a.get('date')) or parse_iso(a.get('first_seen')) or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
        return d
    archive_sorted = sorted(idx.values(), key=sort_key, reverse=True)

    archive_payload = {
        "last_updated": now_str,
        "retention_days": RETENTION_DAYS,
        "count": len(archive_sorted),
        "items": archive_sorted
    }

    if changed or not os.path.exists(ARCHIVE_PATH):
        with open(ARCHIVE_PATH, 'w', encoding='utf-8') as f:
            json.dump(archive_payload, f, indent=2, ensure_ascii=False)
        print(f"Archive updated: {len(archive_sorted)} items -> {ARCHIVE_PATH}")
    else:
        print("Archive unchanged (no new/pruned items).")

    # ---- Daily history & index ----
    # Group by first_seen date (YYYY-MM-DD)
    groups = {}
    for it in archive_sorted:
        fs = it.get('first_seen', '')[:10]
        if not fs:
            continue
        groups.setdefault(fs, []).append(it)

    os.makedirs(HISTORY_DIR, exist_ok=True)
    # Write per-day files
    day_write_count = 0
    for day, day_items in groups.items():
        day_path = os.path.join(HISTORY_DIR, f"{day}.json")
        # Store a compact version without archive-only fields? Keep full for flexibility.
        if write_json_if_changed(day_path, {"date": day, "count": len(day_items), "items": day_items}):
            day_write_count += 1

    # Build index
    daily_summary = [
        {"date": day, "count": len(items)} for day, items in sorted(groups.items(), reverse=True)
    ]
    index_payload = {
        "generated": now_str,
        "retention_days": RETENTION_DAYS,
        "days": daily_summary
    }
    if write_json_if_changed(HISTORY_INDEX_PATH, index_payload):
        print(f"History index updated ({len(daily_summary)} days) -> {HISTORY_INDEX_PATH}")
    else:
        print("History index unchanged.")

    if day_write_count:
        print(f"Updated {day_write_count} daily history file(s).")

if __name__ == '__main__':
    main()
