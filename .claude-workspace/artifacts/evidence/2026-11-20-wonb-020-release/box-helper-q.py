#!/usr/bin/env python3
"""WONB-020 release helper (box side). Supabase Management API, read-only endpoint only.
Token read in-process from the site .env, never printed. Rows stay on the box (dir 700, files 600).
Usage: q.py backup | after"""
import hashlib, json, os, sys, urllib.request

REF = "uzimqndenngebzgndlhd"
DIR = "/home/forge/backups/2026-11-20-wonb-020"
API = f"https://api.supabase.com/v1/projects/{REF}"


def token():
    for line in open("/home/forge/app.ohmyclient.io/.env"):
        if line.startswith("SUPABASE_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("no token")


TOK = token()


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": f"Bearer {TOK}", "Content-Type": "application/json",
        "Accept": "application/json", "User-Agent": "curl/8"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return resp.status, json.loads(resp.read().decode() or "null")


def sql(q):
    return req("POST", "/database/query/read-only", {"query": q})


def save(name, obj):
    p = os.path.join(DIR, name)
    with open(p, "w") as f:
        json.dump(obj, f, indent=1, default=str)
    os.chmod(p, 0o600)
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


PRED = """(c.type = 'welcome' OR EXISTS (SELECT 1 FROM campaigns k WHERE k.id = c.campaign_id
  AND k.restaurant_id = c.restaurant_id AND k.type = 'welcome'))"""

CATALOG = {
    "ledger_tail": "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5",
    "events_indexes": "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='events' ORDER BY indexname",
    "coupons_indexes": "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='coupons' ORDER BY indexname",
    "coupons_columns": """SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='coupons' ORDER BY ordinal_position""",
    "events_size": "SELECT pg_size_pretty(pg_total_relation_size('public.events')) AS total, pg_total_relation_size('public.events') AS bytes",
    "counts": f"""SELECT
      (SELECT count(*) FROM events) AS events_total,
      (SELECT count(*) FROM events WHERE type='join') AS events_join,
      (SELECT count(*) FROM coupons) AS coupons_total,
      (SELECT count(*) FROM coupons WHERE type='welcome') AS coupons_type_welcome,
      (SELECT count(*) FROM coupons c WHERE c.type='promo' AND EXISTS (SELECT 1 FROM campaigns k
         WHERE k.id=c.campaign_id AND k.restaurant_id=c.restaurant_id AND k.type='welcome')) AS promo_of_welcome_campaign,
      (SELECT count(*) FROM coupons c WHERE {PRED}) AS backfill_predicate,
      (SELECT count(*) FROM members) AS members,
      (SELECT count(*) FROM restaurants) AS restaurants""",
}


def summary(cat):
    print("ledger tail:", ", ".join(f"{r['version']} {r['name']}" for r in cat["ledger_tail"][1]))
    print("events indexes:", ", ".join(r["indexname"] for r in cat["events_indexes"][1]))
    j = [r["indexdef"] for r in cat["events_indexes"][1] if r["indexname"] == "idx_events_join_restaurant_member"]
    print("idx_events_join_restaurant_member:", j[0] if j else "absent")
    cols = cat["coupons_columns"][1]
    w = [c for c in cols if c["column_name"] == "welcome_offer"]
    print(f"coupons columns: {len(cols)}; welcome_offer:", w[0] if w else "absent")
    print("events size:", cat["events_size"][1][0])
    print("counts:", cat["counts"][1][0])


def backup():
    os.makedirs(DIR, exist_ok=True)
    os.chmod(DIR, 0o700)
    st, b = req("GET", "/database/backups")
    print(f"GET  /database/backups HTTP {st} managed-backups.json sha256 {save('managed-backups.json', b)}")
    bk = b.get("backups", [])
    newest = max(bk, key=lambda x: x.get("inserted_at", "")) if bk else {}
    print(f"     {len(bk)} backups, walg {b.get('walg_enabled')}, pitr {b.get('pitr_enabled')}; newest {newest.get('id')} {newest.get('status')} {newest.get('inserted_at')}")
    cat = {k: sql(q) for k, q in CATALOG.items()}
    print(f"POST read-only catalog HTTP {cat['counts'][0]} baseline-catalog.json sha256 {save('baseline-catalog.json', cat)}")
    st, ids = sql(f"SELECT c.id, c.type, c.campaign_id FROM coupons c WHERE {PRED} ORDER BY c.id")
    print(f"POST read-only ids HTTP {st} baseline-welcome-coupon-ids.json sha256 {save('baseline-welcome-coupon-ids.json', ids)} ({len(ids)} rows: id, type, campaign_id only)")
    summary(cat)


def after():
    cat = {k: sql(q) for k, q in CATALOG.items()}
    st, true_rows = sql("SELECT id FROM coupons WHERE welcome_offer = true ORDER BY id")
    cat["welcome_offer_true"] = len(true_rows)
    print(f"POST read-only catalog HTTP {st} after-catalog.json sha256 {save('after-catalog.json', cat)}")
    summary(cat)
    st, nn = sql("""SELECT is_nullable, column_default, data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='coupons' AND column_name='welcome_offer'""")
    print("welcome_offer column:", nn)
    base = json.load(open(os.path.join(DIR, "baseline-welcome-coupon-ids.json")))
    bset = {r["id"] for r in base}
    aset = {r["id"] for r in true_rows}
    print(f"welcome_offer=true count {len(aset)}; baseline predicate count {len(bset)}; "
          f"in both {len(aset & bset)}; only after {len(aset - bset)}; only baseline {len(bset - aset)}")
    if aset - bset:
        st, extra = sql("SELECT c.type, c.created_at FROM coupons c WHERE c.id IN (%s)" %
                        ",".join("'%s'" % i for i in sorted(aset - bset)))
        print("only-after rows (type, created_at):", extra)
    st, fp = sql(f"SELECT count(*) AS n FROM coupons c WHERE c.welcome_offer = false AND {PRED}")
    print("predicate rows still false (expect 0):", fp)


if __name__ == "__main__":
    {"backup": backup, "after": after}[sys.argv[1]]()
