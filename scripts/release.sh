#!/usr/bin/env bash
set -euo pipefail

# Build the deployable tree on a developer machine and publish it to the
# `release` branch, which Forge watches. Nothing here runs on production.
#
# Why this exists (2026-08-05 and 2026-08-23 outages, see
# debugging_journals/2026-08-05-prod-vm-hang-during-deploy.md):
# `next build` on the production host is the single step that needs gigabytes.
# The box is an e2-medium — 2 vCPU / 4 GB RAM / 1 GB swap — shared by 17 Forge
# sites. A measured in-place build drove available memory from 2074 MB to
# ~1000 MB and swap from 0 to 1001 MB of 1024, i.e. it succeeded only just
# inside the limits. On 2026-08-05 it thrashed hard enough that sshd stopped
# answering and every site on the box went down. On 2026-08-23 the same build
# spent 64.6 minutes in the TypeScript phase and was still running when the VM
# rebooted, leaving a half-written `.next/` with no prerender-manifest.json;
# the app daemon then crash-looped eleven times and supervisor gave up.
#
# So the build moves off the box entirely. `release` carries the source tree at
# the released commit PLUS a complete, verified `.next/`, and deploy.sh on the
# server only installs deps, migrates, and restarts.

SOURCE_REF="${SOURCE_REF:-main}"
RELEASE_BRANCH="${RELEASE_BRANCH:-release}"
REMOTE="${REMOTE:-origin}"

# Rehearsal knobs. RELEASE_DRY_RUN stages, scrubs and scans the bundle but does
# not push — use it to check what a release WOULD publish, especially the
# secret scrub. RELEASE_SKIP_BUILD reuses whatever `.next/` is already on disk
# instead of rebuilding, which turns a 3-minute verification into a 5-second
# one when you are only changing the packaging.
#
# Dry run deliberately relaxes the clean-tree and in-sync preflight checks: a
# rehearsal is about what lands in the bundle, and demanding release discipline
# from someone who is explicitly not releasing just means they skip the check.
# Both are refused outright for a real push, below.
RELEASE_DRY_RUN="${RELEASE_DRY_RUN:-0}"
RELEASE_SKIP_BUILD="${RELEASE_SKIP_BUILD:-0}"

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

say() { printf '→ %s\n' "$1"; }
die() { printf '  ✗ %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
# A dirty tree would publish a bundle that no commit describes: the release
# branch records `built from <sha>`, and if the build actually came from <sha>
# plus uncommitted edits, that provenance is a lie and the next person cannot
# reproduce the artifact. Refuse rather than publish something untraceable.
say "Preflight"
if [ "$RELEASE_DRY_RUN" = "1" ]; then
  say "  DRY RUN — nothing will be pushed; preflight checks relaxed"
else
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    die "Working tree has uncommitted changes. Commit or stash them first —
    the release records the source commit, so the build must match it exactly."
  fi

  # Ask the server, rather than trusting refs/remotes/$REMOTE/$SOURCE_REF.
  # A remote-tracking ref is only as fresh as the fetch refspec that maintains
  # it, and that is per-clone configuration this script does not control: the
  # production checkout, for one, is configured
  # `+refs/heads/develop:refs/remotes/origin/develop` and nothing else, so its
  # `origin/main` has been frozen at a months-old commit and `git fetch origin
  # main` only moves FETCH_HEAD. Comparing against it reported main as
  # 54 commits out of sync when it was in fact identical to the remote.
  # `git ls-remote` cannot go stale.
  remote_sha=$(git ls-remote --heads "$REMOTE" "refs/heads/$SOURCE_REF" | awk '{print $1}')
  if [ -z "$remote_sha" ]; then
    die "$REMOTE has no branch '$SOURCE_REF'."
  fi
  if [ "$(git rev-parse "$SOURCE_REF")" != "$remote_sha" ]; then
    die "$SOURCE_REF is not in sync with $REMOTE (local $(git rev-parse --short "$SOURCE_REF"), remote ${remote_sha:0:7}).
    Pull or push first — deploying a bundle built from an unpushed commit
    leaves production running code nobody else can check out."
  fi

  # A real release must never ship a bundle the script did not just build:
  # RELEASE.json would claim provenance for a `.next/` of unknown origin.
  if [ "$RELEASE_SKIP_BUILD" = "1" ]; then
    die "RELEASE_SKIP_BUILD is only valid with RELEASE_DRY_RUN=1.
    A published release always builds from scratch."
  fi
fi
local_sha=$(git rev-parse "$SOURCE_REF")
say "  building $SOURCE_REF @ ${local_sha:0:7}"

# The standalone server runs under whatever Node the server has. Building on a
# materially different major version is the kind of thing that works until it
# doesn't, so surface it rather than discovering it in production.
node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 22 ]; then
  die "Node $(node -v) — production runs Node 22+. Build on a matching major."
fi
say "  node $(node -v)"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
if [ "$RELEASE_SKIP_BUILD" = "1" ]; then
  say "Reusing existing .next/ (RELEASE_SKIP_BUILD=1)"
else
  say "Installing dependencies"
  npm ci

  say "Building Next.js"
  # From scratch: a stale .next/ can retain files that the current source no
  # longer produces, and those would ship. The incremental cache is worth less
  # than knowing exactly what is in the bundle.
  rm -rf .next
  npm run build
fi

# The exact file whose absence crash-looped production on 2026-08-23. `next
# build` writes it late, so its presence is a decent proxy for "the build ran
# to completion" — and checking here means a truncated build fails on the
# laptop instead of eleven times under supervisor.
for required in .next/BUILD_ID .next/prerender-manifest.json .next/routes-manifest.json; do
  [ -f "$required" ] || die "Build incomplete: $required is missing."
done
say "  BUILD_ID $(cat .next/BUILD_ID)"

# ---------------------------------------------------------------------------
# Stage the release tree
# ---------------------------------------------------------------------------
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

say "Staging release tree"
# git archive, not `cp -r`: it emits exactly the tracked files at that commit,
# so build leftovers, editor droppings, and local-only files cannot ride along.
git archive "$local_sha" | tar -x -C "$stage"

# `.next` is gitignored (it is a build output), so it is absent from the
# archive and gets copied in deliberately. `cache/` is excluded — it is
# incremental-build scratch, useless on a server that never builds.
mkdir -p "$stage/.next"
tar -c --exclude='./cache' -C .next . | tar -x -C "$stage/.next"

# -------------------------------------------------------------------------
# Secret scrub — the reason this script cannot be three lines
# -------------------------------------------------------------------------
# `output: 'standalone'` copies the build machine's .env VERBATIM into
# .next/standalone/.env. On 2026-08-23 that file on production was
# byte-identical to the production .env: service role key, Kapso API key and
# webhook secret, Resend and Gemini keys, the platform admin password — 24
# variables. xavierau/omc is a PUBLIC repository. Publishing that file to a
# branch would leak every production credential to anyone who clones.
#
# The server keeps its own .env, so the bundle never needs one.
say "Scrubbing secrets from the bundle"
# .env.example is tracked on purpose (it documents the required variables and
# holds no values), so it is the one name explicitly spared.
find_env_files() {
  find "$1" \( -name '.env' -o -name '.env.*' \) ! -name '.env.example' -type f
}

while IFS= read -r f; do
  [ -n "$f" ] || continue
  printf '  removed %s\n' "${f#"$stage"/}"
  rm -f "$f"
done < <(find_env_files "$stage")

leaked=$(find_env_files "$stage" | head -5)
[ -z "$leaked" ] || die "env files survived the scrub: $leaked"

# Belt and braces: the scrub above is name-based, so it cannot catch a secret
# that got inlined into a compiled chunk. These two patterns are unambiguous —
# a service_role JWT and a Supabase secret key are never legitimately present
# in shippable output. (NEXT_PUBLIC_* values, including the anon key, ARE
# inlined by design and are safe; they are public by definition.)
say "Scanning bundle for inlined credentials"
if grep -rlIE 'sb_secret_[A-Za-z0-9_-]{8,}|sbp_[a-f0-9]{40}' "$stage" 2>/dev/null | head -3 | grep -q .; then
  die "A Supabase secret/access key appears inside the built bundle.
    Do NOT push. Find it with:
      grep -rlIE 'sb_secret_|sbp_' <build dir>"
fi
# service_role JWTs: decode each JWT payload found and look at the role claim.
while read -r jwt; do
  payload=${jwt#*.}; payload=${payload%%.*}
  # base64url → base64, pad to a multiple of 4 so `base64 -d` accepts it.
  padded=$(printf '%s' "$payload" | tr '_-' '/+')
  while [ $(( ${#padded} % 4 )) -ne 0 ]; do padded="${padded}="; done
  if printf '%s' "$padded" | base64 -d 2>/dev/null | grep -q 'service_role'; then
    die "A service_role JWT is inlined in the built bundle. Do NOT push."
  fi
# No cap on the candidate list on purpose: a truncated scan that reports
# "clean" is worse than no scan. Measured on the real 147 MB bundle this finds
# 0 candidates in 0.14s, so there is nothing to save by bounding it.
done < <(grep -rhoIE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' "$stage" 2>/dev/null | sort -u)
say "  clean"

# Provenance. deploy.sh echoes this so a production log says which commit is
# actually running, which `git log` on the release branch cannot tell you —
# the release branch is rewritten every time and has no shared history.
# Built with node rather than a heredoc so the commit subject is JSON-escaped
# properly — subjects routinely contain quotes and backslashes, and a hand-
# rolled heredoc would emit invalid JSON that deploy.sh then fails to parse.
SRC_REF="$SOURCE_REF" \
SRC_SHA="$local_sha" \
SRC_SUBJECT="$(git log -1 --format=%s "$local_sha")" \
BUILD_ID="$(cat .next/BUILD_ID)" \
BUILT_BY="$(git config user.email 2>/dev/null || echo unknown)" \
node -e '
  const out = {
    source_ref: process.env.SRC_REF,
    source_commit: process.env.SRC_SHA,
    source_subject: process.env.SRC_SUBJECT,
    build_id: process.env.BUILD_ID,
    built_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    built_by: process.env.BUILT_BY,
    node: process.version,
  };
  require("fs").writeFileSync(process.argv[1], JSON.stringify(out, null, 2) + "\n");
' "$stage/RELEASE.json"

# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------
# An ORPHAN commit, force-pushed. The bundle is ~136 MB; keeping history would
# add that much to a public repo on every single deploy, permanently. With no
# parent, the remote holds one release tree at a time and GitHub garbage-
# collects what it replaces. The tradeoff is deliberate: `release` is an
# artifact pointer, not a history. All real history lives on main/develop, and
# RELEASE.json is what ties an artifact back to it.
if [ "$RELEASE_DRY_RUN" = "1" ]; then
  printf '\n✓ DRY RUN complete — nothing pushed.\n'
  printf '  Bundle staged at: %s\n' "$stage"
  printf '  Size: %s across %s files\n' \
    "$(du -sh "$stage" | cut -f1)" "$(find "$stage" -type f | wc -l)"
  printf '  Re-run without RELEASE_DRY_RUN to publish.\n'
  # The trap would delete it the moment we exit, and the whole point of a dry
  # run is to let someone go and look.
  trap - EXIT
  exit 0
fi

say "Publishing to $REMOTE/$RELEASE_BRANCH"
GIT_INDEX_FILE=$(mktemp -u); export GIT_INDEX_FILE
trap 'rm -rf "$stage" "$GIT_INDEX_FILE"' EXIT

# -f because .gitignore excludes /.next/ — which is exactly what we are here
# to publish. The temp index means the real one is never touched, so this is
# safe to run with your own work in progress alongside.
git --git-dir="$repo_root/.git" --work-tree="$stage" add --all --force

tree=$(git --git-dir="$repo_root/.git" write-tree)
commit=$(git --git-dir="$repo_root/.git" commit-tree "$tree" -m "release ${local_sha:0:7}: $(git log -1 --format=%s "$local_sha")

Built from $SOURCE_REF @ $local_sha
BUILD_ID $(cat .next/BUILD_ID)
Built $(date -u +%Y-%m-%dT%H:%M:%SZ) by $(git config user.email 2>/dev/null || echo unknown)

Orphan commit — this branch is rewritten on every release.")

git push --force "$REMOTE" "$commit:refs/heads/$RELEASE_BRANCH"

printf '\n✓ Released %s @ %s → %s/%s (%s)\n' \
  "$SOURCE_REF" "${local_sha:0:7}" "$REMOTE" "$RELEASE_BRANCH" "${commit:0:7}"
printf '  Forge deploys this branch automatically. Watch it land:\n'
printf '    curl -sf https://app.ohmyclient.io/api/health\n'
