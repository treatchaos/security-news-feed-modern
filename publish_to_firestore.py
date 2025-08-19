import os, json, hashlib, datetime
from typing import Any, Dict, List

from google.cloud import firestore  # type: ignore


def sha1_id(title: str, link: str) -> str:
    return hashlib.sha1(f"{title}|{link}".encode()).hexdigest()


def load_payload() -> Dict[str, Any]:
    # Prefer archive.json to get full retention window
    if os.path.exists('archive.json'):
        with open('archive.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, dict) and 'items' in data:
                return data
    # Fallback to news.json
    if os.path.exists('news.json'):
        with open('news.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, list):
                return {"items": data, "last_updated": None}
            return data
    raise FileNotFoundError('archive.json or news.json not found')


def parse_iso(ts: str):
    if not ts:
        return None
    try:
        if ts.endswith('Z'):
            ts = ts.replace('Z', '+00:00')
        return datetime.datetime.fromisoformat(ts)
    except Exception:
        return None


def to_timestamp(ts: str):
    dt = parse_iso(ts)
    if not dt:
        return None
    if not dt.tzinfo:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


def to_ms(ts: str) -> int:
    dt = parse_iso(ts)
    if not dt:
        return 0
    if not dt.tzinfo:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    epoch = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    return int((dt - epoch).total_seconds() * 1000)


def main():
    project_id = os.environ.get('GCP_PROJECT_ID')
    if not project_id:
        raise RuntimeError('GCP_PROJECT_ID not set')

    payload = load_payload()
    items: List[Dict[str, Any]] = payload.get('items', [])
    now = datetime.datetime.now(datetime.timezone.utc)

    db = firestore.Client(project=project_id)

    # Batch upserts for items
    batch = db.batch()
    batch_count = 0
    total_written = 0

    daily_counts: Dict[str, int] = {}

    for it in items:
        _id = it.get('id') or sha1_id(it.get('title', ''), it.get('link', ''))
        date_iso = it.get('date') or ''
        first_seen = it.get('first_seen') or payload.get('last_updated') or ''
        last_seen = it.get('last_seen') or payload.get('last_updated') or ''
        fs_date = (first_seen or '')[:10]

        doc = {
            'id': _id,
            'title': it.get('title', ''),
            'link': it.get('link', ''),
            'description': it.get('description', ''),
            'source': it.get('source', ''),
            'date': date_iso,
            'date_ts': to_ms(date_iso),
            'first_seen': to_timestamp(first_seen),
            'first_seen_date': fs_date,
            'last_seen': to_timestamp(last_seen),
            'updated_at': now,
        }

        ref = db.collection('items').document(_id)
        batch.set(ref, doc, merge=True)
        batch_count += 1
        total_written += 1

        if fs_date:
            daily_counts[fs_date] = daily_counts.get(fs_date, 0) + 1

        # Commit every ~400 docs to stay under limits
        if batch_count >= 400:
            batch.commit()
            batch = db.batch()
            batch_count = 0

    if batch_count:
        batch.commit()

    # Stats/meta
    db.collection('stats').document('meta').set({
        'last_updated': now,
        'count': len(items),
        'source': 'github-actions',
    }, merge=True)

    # Daily docs
    for day, cnt in daily_counts.items():
        db.collection('daily').document(day).set({
            'date': day,
            'count': cnt,
            'updated_at': now,
        }, merge=True)

    print(f"Firestore publish complete: {total_written} items, {len(daily_counts)} daily docs")


if __name__ == '__main__':
    main()
