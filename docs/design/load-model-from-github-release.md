# Load Model from GitHub Release via Build-Time Fetch

- Status: accepted — implementing Option B (build-time fetch into gitignored local dir), amended by architect review 2026-09-20 (see §6).
- Scope: replace manual copy of `model.json` + `weights.bin` into `public/model/` with a versioned download from GitHub Releases in [commercial-sign-classifier-model-training](https://github.com/handleman/commercial-sign-classifier-model-training).
- Non-goals: retraining, changing architecture/preprocessing, client-side inference, runtime URL loading.

## 1. Background

`lib/modelLoader.ts:loadModel` lazy-loads and caches the TF.js `LayersModel` on first request (CPU backend). It reads `public/model/model.json` + `public/model/weights.bin` from disk via a custom `tf.io.IOHandler` (`fs.readFileSync` + in-memory `load()`). `classifyImage` keeps `sharp` as a server-only dynamic import, resizes to 224×224, strips alpha, normalizes to 0–1, and maps argmax to `SIGN_TYPES` (`cabinet`, `channel_letter`, `flat_cut`, `post_panel`).

Update flow today is manual: export in the training repo, copy both files into `public/model/`, eyeball class-order alignment. Both files are committed (`git ls-files public/model` → `model.json` + ~13 MB `weights.bin`). Problems: binary churn in git history, no version traceability (which tag / `val_acc` is live?), silent class-order drift risk, half-copy failure mode.

The training repo already publishes the right shape (`docs/releasing-a-model.md` there): tag convention `model-vX.Y.Z`, side-by-side assets `model.json` + `weights.bin` + `history.json`. Current `public/model/model.json` has `weightsManifest[0].paths: ["weights.bin"]`, i.e. relative resolution already works.

Decision: fetch the pinned release at install/build time into a gitignored local dir. Inference code stays on the local-disk `IOHandler` path. Runtime `loadLayersModel(url)` and self-hosted proxy options were rejected (cold-start latency, GitHub-as-runtime-dependency, no offline dev, no checksum story).

## 2. Requirements

1. Single pin: one committed file + env override determines the exact model tag.
2. Reproducible: clean clone + one command yields the pinned weights with verification.
3. No committed binaries: `weights.bin` / `model.json` become fetch artifacts, gitignored.
4. Minimal inference-path change: same `IOHandler`, CPU backend, preprocessing, `SIGN_TYPES` mapping, API rounding. One path-constant change allowed for the dir move (§3.3).
5. Works in `npm run dev --webpack`, `npm run build --webpack`, `next start`, Docker, CI — with a clear error when offline and cache is cold. `next start` has no lifecycle hook, so the runtime must fail with an actionable message (§3.6).
6. Fail loudly on checksum, shape, or class-order mismatch.

## 3. Design

### 3.1 Pin: `model/MODEL_VERSION` + env override (+ lockfile)

- New committed file `model/MODEL_VERSION` containing one line, e.g. `model-v1.0.0`. Bumping the model = PR to this file (+ lockfile below).
- Resolution order in the script: `process.env.MODEL_RELEASE_TAG` (if non-empty) else `model/MODEL_VERSION` trimmed. Env wins so CI/preview deploys can pin without a commit. When env overrides the file, the script must print a loud `using MODEL_RELEASE_TAG=<tag> (override)` line —silent divergence between what's committed and what's running is a debugging trap.
- Integrity anchor: `manifest.json` is downloaded from the same release as the weights, so it proves self-consistency only, not authenticity (a party that can tamper with the assets can tamper with the manifest). TLS to github.com is therefore the transport trust anchor — state this in the script header comment. Additionally commit a lockfile `model/MODEL_LOCK.json` = `{ "tag": "model-v1.0.0", "sha256": { "model.json": "<hex>", "weights.bin": "<hex>" } }`; the script verifies downloads against the lockfile when the tag matches, and refreshes the lockfile (`--update-lock`) only as an explicit step in the bump PR. This also protects against mutable re-uploads under an unchanged tag.
- Base URL (constant in script): `https://github.com/handleman/commercial-sign-classifier-model-training/releases/download/<tag>/`. `fetch` must follow redirects (default) since this URL 302s to `objects.githubusercontent.com`; assert on final `res.ok`, fail with `tag + filename + HTTP status`.

### 3.2 Training-repo release contract

Each `model-v*` release must contain side-by-side (no zips):

- `model.json`, `weights.bin` (existing),
- `history.json` (existing — records `val_acc`; fetch a copy too for traceability),
- `manifest.json` (new, small JSON): `{ "tag": "model-v1.0.0", "classes": ["cabinet","channel_letter","flat_cut","post_panel"], "input": [224,224,3], "val_acc": 0.93, "sha256": { "model.json": "<hex>", "weights.bin": "<hex>" } }`.

`manifest.classes` is load-bearing: the fetch script deep-equals it against the canonical class list and aborts on mismatch. If the training repo can't add `manifest.json` immediately, phase 1 treats a missing manifest as a warning and enforces the lockfile hashes + `model.json` shape checks; once the contract lands, missing manifest becomes an error (gate with a `REQUIRE_MANIFEST` constant flip, not silent drift).

### 3.3 Destination dir: `model/cache/` (not `public/`)

Serve nothing we don't have to. Keeping weights in `public/model/` publicly serves ~13 MB of model binaries at `/model/weights.bin`, bloats the deploy output (Next.js copies `public/` verbatim, including into standalone output), and leaks version metadata. Decide now: destination is `model/cache/` (gitignored), and `lib/modelLoader.ts` changes exactly its `path.join` base from `('public','model')` to `('model','cache')`. The custom `IOHandler` logic is otherwise untouched. Layout:

```
model/
  MODEL_VERSION        # committed pin, one line
  MODEL_LOCK.json      # committed hashes
  classes.json         # committed canonical classes (see §3.4) — optional but recommended
  cache/               # gitignored: model.json, weights.bin, manifest.json, history.json, .fetch-info.json
```

`.gitignore`: `model/cache/` (+ `*.tmp` anywhere under it); keep the committed `model/MODEL_*` files via negation if a broad rule is used. No `.gitkeep` needed if the script does `mkdir -p`.

### 3.4 `scripts/fetch-model.mjs` behavior

Zero new dependencies (Node 20 global `fetch`, `node:fs`, `node:crypto`, `node:path` only; stream hashes — never `readFileSync` a 13 MB binary into memory for hashing). Interface:

```bash
npm run fetch-model                 # fetch unless warm cache matches
npm run fetch-model -- --force      # re-download even if warm
npm run fetch-model -- --update-lock # refresh model/MODEL_LOCK.json (bump PRs only)
MODEL_RELEASE_TAG=model-v1.0.1 npm run fetch-model
```

Steps:

1. Resolve `<tag>`, `DEST = model/cache`, `FILES = [model.json, weights.bin, manifest.json, history.json]`.
2. Canonical classes: do NOT regex-parse `types/classification.ts` (brittle against formatting edits). Commit `model/classes.json` = `["cabinet","channel_letter","flat_cut","post_panel"]` and have both the TS side (`SIGN_TYPES`, via import or a compile-time assert) and the fetch script read it — one source of truth, drift impossible by construction. Until that lands, hardcode the 4-string list in the script with a `// must match SIGN_TYPES in types/classification.ts` pointer and add a CI grep check; treat the JSON file as the follow-up, not the parse hack.
3. Warm-cache fast path: if `DEST/.fetch-info.json` exists with same `tag` AND streaming sha256 of local files matches lockfile/manifest hashes → log `model <tag> already cached, skipping`, exit 0. `--force` skips this. Explicitly handle the transitional state (tracked binaries exist but no `.fetch-info.json`, i.e. pre-migration checkout): treat as cold, refetch — never "adopt" unverified files as warm.
4. Download each file to a staging dir `DEST/.stage-<pid>/` (not `DEST/*.tmp` — a crashed run must not leave half-files where `loadModel` can see them), check `res.ok`, fail with `tag + filename + HTTP status`.
5. Verify, in order: non-zero sizes → sha256 vs lockfile (tag match) and manifest → `model.json` shape: `format === "layers-model"`, `weightsManifest[*].paths` flattened deep-equals `["weights.bin"]`, input shape `[null,224,224,3]`, output/head dim `=== classes.length` (catches arch changes, e.g. 5th class or 299px input) → `manifest.classes` deep-equals canonical classes → `manifest.tag === <tag>`.
6. Atomic install: single `renameSync(DEST/.stage-<pid> → DEST)` (or per-file rename into a versioned `DEST/<tag>/` + `current` pointer if concurrent fetch-while-serving is a concern). Then write `DEST/.fetch-info.json` = `{ tag, fetchedAt, val_acc, classes, sha256 }` — schema fixed here so `/api/health` and log lines can rely on it.
7. Log one line on success: `fetched model <tag> (val_acc 0.93) → model/cache/`.

Failure modes: network/404 → exit 1 with `release <tag> not found or unreachable; check model/MODEL_VERSION and network, or run with warm cache`; checksum/shape/class mismatch → exit 1, delete the staging dir, leave previous `DEST` untouched. Never mutate the live dir before all checks pass. While `dev` is running, `--force` refetch must not tear down files out from under `loadModel` — the staging-dir + atomic rename is what makes that safe.

Private-repo future: only this script changes — send `Authorization: Bearer $GITHUB_TOKEN`/`$GH_TOKEN` and resolve via the Releases API. Inference code is unaffected.

### 3.5 Lifecycle wiring (`package.json`)

```json
{ "scripts": {
  "fetch-model": "node scripts/fetch-model.mjs",
  "predev": "npm run fetch-model",
  "prebuild": "npm run fetch-model"
} }
```

Deliberately NO `postinstall`. Rationale: it fires on every contributor `npm install`/`npm ci`, turns a GitHub blip into a failed install, misbehaves under `--ignore-scripts` and network-restricted CI, and is redundant — `predev`/`prebuild` already cover both entry points and the warm-cache check makes them cheap. Docker/CI call `npm run fetch-model` as an explicit layer/step instead:

```dockerfile
COPY model/MODEL_VERSION model/MODEL_LOCK.json model/classes.json ./
COPY scripts/fetch-model.mjs ./scripts/
RUN npm run fetch-model
```

Keep `--webpack` on `dev`/`build` untouched. Note the failure semantic: `predev`/`prebuild` exit 1 on cold-cache + offline — that is intended (fail fast with the actionable message), but the message must say how to proceed (warm cache location, `--force`, env override).

### 3.6 `lib/modelLoader.ts` changes (small, required)

1. Path base `('public','model')` → `('model','cache')` (§3.3).
2. Required (not optional): startup traceability + actionable cold-cache error. On load, read `model/cache/.fetch-info.json` (best-effort) and log `Model <tag> (val_acc …) loaded from <dir>`; on `ENOENT` throw `Model cache missing at model/cache — run 'npm run fetch-model' (see docs/design/load-model-from-github-release.md)`. `next start` has no hook, so without this the failure surfaces as a bare ENOENT. No change to backend, preprocessing, tensor shapes, or `SIGN_TYPES` mapping.

### 3.7 Gitignore + binary removal (one atomic PR)

- `.gitignore`: add `model/cache/` (covers binaries, manifest copy, `.fetch-info.json`, staging dirs).
- The same PR that adds the script must also `git rm --cached public/model/weights.bin public/model/model.json` (plus delete the `public/model/` dir or leave a README stub). Rationale: gitignore does not untrack tracked files, so a split rollout leaves a window where clones still carry 13 MB blobs while the script's warm-cache logic sees "files but no fetch-info" — the transition rule in §3.4 handles it, but landing both halves together shrinks the window to zero. Past history keeps old blobs; future retrains add zero churn.

### 3.8 Docs

- `README.md`: rewrite Model section (pin file, lockfile, `npm run fetch-model`, bump flow incl. `--update-lock`, offline warm-cache note, `model/cache/` location); check off the TODO.
- `AGENTS.md` ↔ `CLAUDE.md` (both, per repo convention): note the fetch script, pin + lock files, gitignored `model/cache/`, and that `loadModel`'s `IOHandler` stays (path base moved).

## 4. Verification

1. Cold checkout: `rm -rf model/cache && npm run fetch-model && ls model/cache` → `model.json weights.bin manifest.json history.json .fetch-info.json`, tag matches `MODEL_VERSION`, hashes match lockfile.
2. Idempotency: second `npm run fetch-model` → `already cached, skipping`, exit 0, no mtimes changed.
3. Drift guards: (a) corrupt one byte of cached `weights.bin` → next run refetches (hash mismatch detected); (b) `MODEL_RELEASE_TAG=<tag-with-different-classes>` → exit 1 class-mismatch, live dir untouched; (c) hand-edit `model.json` input to 299px → exit 1 shape error.
4. Transitional: checkout with old tracked `public/model/` files but no `.fetch-info.json` → treated as cold, refetches into `model/cache/`.
5. App: `npm run dev` and `npm run build && npm start` from cold cache succeed via hooks; `POST /api/classify` on the 4 sprite quadrants returns the expected `signType` each; server log shows `Model <tag>` line.
6. Offline: warm cache + network blocked → dev starts (skip path, no fetch); cold cache + blocked → `predev` fails with the actionable message.
7. Lint: `npm run lint` clean. Script is plain `.mjs`, zero deps to audit.

## 5. Rollout

1. Training repo: publish `manifest.json` (+ `history.json`, already there) on the current `model-v*` tag; new patch release if tags are immutable.
2. App PR (single, atomic): `scripts/fetch-model.mjs` + `model/{MODEL_VERSION,MODEL_LOCK.json,classes.json}` + hooks + `.gitignore` + `modelLoader.ts` path base + log line + `git rm --cached` of old binaries + docs. Prove cold-clone `npm ci && npm run build` works.
3. Follow-ups (optional): `GET /api/health` exposing `{ modelTag, val_acc }` from `.fetch-info.json`; CI job comparing pin vs latest training-repo release and opening a bump reminder.

## 6. Architect review log (2026-09-20)

Findings against the pre-review draft, all folded in above:

1. [Blocker] Destination was `public/model/` with the move deferred. Serving model binaries publicly + copying them into every deploy is a real cost with a 2-line fix — decided `model/cache/` now (§3.3, §3.6.1).
2. [Blocker] Checksum-against-same-release bootstraps nothing (tamper-with-both attack). Added committed `model/MODEL_LOCK.json` as the trust anchor; TLS stated as transport assumption (§3.1).
3. [Blocker] `postinstall` hook removed. It converts network blips into failed installs and is redundant with `predev`/`prebuild`; Docker/CI use an explicit step (§3.5).
4. [Major] Non-atomic install (`*.tmp` beside live files) + "adopt tracked files" gap. Replaced with staging-dir + atomic rename and an explicit cold-on-no-fetch-info rule (§3.4.4, §3.4.6).
5. [Major] `next start` has no hook — cold deploy would die with bare ENOENT. Added required actionable error + boot log line (§3.6.2).
6. [Major] Regex-parsing `types/classification.ts` for the class list is brittle. Replaced with committed `model/classes.json` shared by TS and script (§3.4.2).
7. [Major] Shape validation gap (arch drift: 5th class, 299px input). Added `format` / input-shape / output-dim checks (§3.4.5).
8. [Minor] Split rollout (`rm --cached` as "follow-up commit") leaves a half-migrated window. Folded into one atomic PR (§3.7).
9. [Minor] Streaming-hash requirement noted (13 MB file must not be slurped for hashing) (§3.4); silent env-override divergence called out (§3.1); `history.json` fetched for traceability (§3.2); update automation reduced to an optional CI reminder since no package manager watches `MODEL_VERSION` (§5.3).
