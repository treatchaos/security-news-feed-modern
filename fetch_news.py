import os, time, json, feedparser, concurrent.futures, hashlib, datetime
from bs4 import BeautifulSoup
from urllib.parse import urlparse

USER_AGENT = os.environ.get("USER_AGENT", "SecurityNewsBot/1.2 (+https://treatchaos.github.io/security-news-feed-modern/)")
feedparser.USER_AGENT = USER_AGENT

MAX_ITEMS_PER_FEED = int(os.environ.get("MAX_ITEMS_PER_FEED", 5))
DESC_LIMIT = int(os.environ.get("DESC_LIMIT", 400))
ENABLE_CONCURRENCY = os.environ.get("DISABLE_CONCURRENCY") is None

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
    items = sort_items(gather_items())
    payload = {
        "last_updated": datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        "count": len(items),
        "items": items
    }
    out_path = 'news.json'
    existing = read_existing(out_path)
    if existing and existing.get('items') == payload['items']:
        # Keep previous last_updated to avoid noisy commits.
        print("No content changes; skipping file update.")
        return
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"Wrote {payload['count']} items -> {out_path}")

if __name__ == '__main__':
    main()
