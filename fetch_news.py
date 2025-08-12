import feedparser, json, requests, os, time
from bs4 import BeautifulSoup

USER_AGENT = os.environ.get("USER_AGENT", "SecurityNewsBot/1.0 (+https://treatchaos.github.io/security-news-feed-modern/)")
feedparser.USER_AGENT = USER_AGENT

sources = [
    "https://securityonline.info/category/news/vulnerability/feed/",
    "https://www.bleepingcomputer.com/feed/",
    "https://www.securityweek.com/feed/",
    "https://thehackernews.com/feeds/posts/default",
    "https://www.darkreading.com/rss.xml",
    "https://threatpost.com/feed/",
    "https://www.zero-day.cz/feed/",
    "https://www.zerodayinitiative.com/rss/upcoming/",
    "https://www.cisa.gov/known-exploited-vulnerabilities-catalog.xml"
]

news_items = []

for url in sources:
    try:
        feed = feedparser.parse(url)
        for entry in feed.entries[:5]:
            desc = entry.get("summary", "")
            soup = BeautifulSoup(desc, "html.parser")
            clean_desc = soup.get_text()
            news_items.append({
                "title": entry.title,
                "link": entry.link,
                "date": entry.get("published", ""),
                "description": clean_desc
            })
        time.sleep(0.5)  # polite delay
    except Exception as e:
        print(f"Error fetching {url}: {e}")

with open("news.json", "w", encoding="utf-8") as f:
    json.dump(news_items, f, indent=2, ensure_ascii=False)
