#!/usr/bin/env python3
"""BOOK-009/010 release helper (box side). Supabase Management API, read-only query endpoint only.
Token read in-process from the site .env, never printed. Rows stay on the box (dir 700, files 600).
Usage: q.py backup | after"""
import hashlib, json, os, sys, urllib.request

REF = "uzimqndenngebzgndlhd"
DIR = "/home/forge/backups/2026-11-22-book-009-010"
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
        json.dump(obj, f, indent=1, default=str, sort_keys=True)
    os.chmod(p, 0o600)
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


FUNCS = ("'insert_booking_request_if_room','promote_agent_booking_with_room','booking_room_refusal',"
         "'booking_room_lock','booking_guest_counts'")
CATALOG = {
    "server_version": "SELECT current_setting('server_version') AS v, current_setting('server_version_num')::int AS n",
    "ledger_tail": "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5",
    "br_terms_columns": """SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='booking_requests' AND column_name IN ('terms_accepted_at','terms_text')
      ORDER BY column_name""",
    "br_column_count": "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_requests'",
    "br_constraints": "SELECT conname FROM pg_constraint WHERE conrelid='public.booking_requests'::regclass ORDER BY conname",
    "br_terms_constraint": "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.booking_requests'::regclass AND conname='booking_requests_terms_acceptance'",
    "br_indexes": "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='booking_requests' ORDER BY indexname",
    "booking_stops": """SELECT to_regclass('public.booking_stops')::text AS rel,
      (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.booking_stops')) AS rls,
      (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='booking_stops') AS policies,
      (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_stops') AS columns""",
    "booking_stops_constraints": "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = to_regclass('public.booking_stops') ORDER BY conname",
    "booking_stops_indexes": "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='booking_stops' ORDER BY indexname",
    "functions": f"""SELECT p.oid::regprocedure::text AS sig, l.lanname AS lang, p.prosecdef AS secdef, p.provolatile AS volatile,
      p.proconfig AS config,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public' AND p.proname IN ({FUNCS}) ORDER BY 1""",
    "counts": """SELECT
      (SELECT count(*) FROM booking_requests) AS booking_requests,
      (SELECT json_object_agg(status, n) FROM (SELECT status, count(*) n FROM booking_requests GROUP BY status) s) AS by_status,
      (SELECT count(*) FROM restaurants) AS restaurants,
      (SELECT json_object_agg(m, n) FROM (SELECT coalesce(booking_config->>'mode','(none)') m, count(*) n FROM restaurants GROUP BY 1) s) AS booking_mode,
      (SELECT count(*) FROM restaurants WHERE jsonb_typeof(booking_config->'bookingHours') IS NOT NULL
         AND jsonb_typeof(booking_config->'bookingHours') <> 'null') AS booking_hours_set,
      (SELECT count(*) FROM restaurants WHERE booking_config->'agentBooking'->>'publicId' IS NOT NULL) AS agent_booking_public_ids""",
}


def counts_extra(cat):
    if cat["booking_stops"][1][0]["rel"]:
        cat["booking_stops_rows"] = sql("SELECT count(*) AS n FROM booking_stops")
    return cat


def summary(cat):
    g = lambda k: cat[k][1]
    print("server_version:", g("server_version")[0])
    print("ledger tail:", ", ".join(f"{r['version']} {r['name']}" for r in g("ledger_tail")))
    print("booking_requests columns:", g("br_column_count")[0]["n"], "; terms columns:", g("br_terms_columns") or "absent")
    print("booking_requests constraints:", ", ".join(r["conname"] for r in g("br_constraints")))
    print("terms constraint:", g("br_terms_constraint") or "absent")
    print("booking_requests indexes:", ", ".join(r["indexname"] for r in g("br_indexes")))
    print("booking_stops:", g("booking_stops")[0])
    print("booking_stops constraints:", g("booking_stops_constraints"))
    print("booking_stops indexes:", ", ".join(r["indexname"] for r in g("booking_stops_indexes")) or "none")
    if "booking_stops_rows" in cat: print("booking_stops rows:", cat["booking_stops_rows"][1])
    print("functions:", json.dumps(g("functions"), indent=1) if g("functions") else "none")
    print("counts:", g("counts")[0])


def ids():
    return sql("SELECT id, status FROM booking_requests ORDER BY id")[1]


def configs():
    return sql("SELECT id, booking_config FROM restaurants ORDER BY id")[1]


def backup():
    os.makedirs(DIR, exist_ok=True)
    os.chmod(DIR, 0o700)
    st, b = req("GET", "/database/backups")
    print(f"GET  /database/backups HTTP {st} managed-backups.json sha256 {save('managed-backups.json', b)}")
    bk = b.get("backups", [])
    newest = max(bk, key=lambda x: x.get("inserted_at", "")) if bk else {}
    print(f"     {len(bk)} backups, walg {b.get('walg_enabled')}, pitr {b.get('pitr_enabled')}; newest {newest.get('id')} {newest.get('status')} {newest.get('inserted_at')}")
    st, rows = sql("SELECT * FROM booking_requests ORDER BY id")
    print(f"POST read-only booking_requests full rows HTTP {st} {len(rows)} rows booking_requests.json sha256 {save('booking_requests.json', rows)}")
    rc = configs()
    print(f"POST read-only restaurants (id, booking_config) {len(rc)} rows restaurants-booking-config.json sha256 {save('restaurants-booking-config.json', rc)}")
    cat = counts_extra({k: sql(q) for k, q in CATALOG.items()})
    print(f"POST read-only catalog HTTP {cat['counts'][0]} baseline-catalog.json sha256 {save('baseline-catalog.json', cat)}")
    i = ids()
    print(f"POST read-only ids baseline-ids.json sha256 {save('baseline-ids.json', i)} ({len(i)} rows: id, status only; not printed)")
    summary(cat)


def after():
    cat = counts_extra({k: sql(q) for k, q in CATALOG.items()})
    print(f"POST read-only catalog after-catalog.json sha256 {save('after-catalog.json', cat)}")
    summary(cat)
    base = {r["id"]: r["status"] for r in json.load(open(os.path.join(DIR, "baseline-ids.json")))}
    now = {r["id"]: r["status"] for r in ids()}
    save("after-ids.json", [{"id": k, "status": v} for k, v in sorted(now.items())])
    gone, new = set(base) - set(now), set(now) - set(base)
    moved = [k for k in set(base) & set(now) if base[k] != now[k]]
    print(f"baseline -> after: rows {len(base)} -> {len(now)}; gone {len(gone)}; new {len(new)} (statuses {sorted(now[k] for k in new)}); status changed {len(moved)}")
    bc = json.load(open(os.path.join(DIR, "restaurants-booking-config.json")))
    ac = configs()
    h = lambda o: hashlib.sha256(json.dumps(o, sort_keys=True, default=str).encode()).hexdigest()
    changed = sum(1 for a, b in zip(sorted(bc, key=lambda r: r["id"]), sorted(ac, key=lambda r: r["id"])) if h(a) != h(b))
    print(f"restaurants booking_config: baseline {len(bc)} rows, now {len(ac)}; rows whose booking_config changed: {changed}; set hash equal: {h(sorted(bc, key=lambda r: r['id'])) == h(sorted(ac, key=lambda r: r['id']))}")



if __name__ == "__main__":
    {"backup": backup, "after": after}[sys.argv[1]]()
