# Load Model from GitHub Release via Build-Time Fetch

- Status: accepted — implementing Option B (build-time fetch into gitignored local dir)
- Scope: replace manual copy of `model.json` + `weights.bin` into `public/model/` with a versioned download from GitHub Releases in [commercial-sign-classifier-model-training](https://github.com/handleman/commercial-sign-classifier-model-training).
- Non-goals: retraining, changing architecture/preprocessing, client-side inference, runtime URL loading.

## 1. Background

`lib/modelLoader.ts:loadModel` lazy-loads and caches the TF.js `LayersModel` on first request (CPU backend). It reads `public/model/model.json` + `public/model/weights.bin` from disk via a custom `tf.io.IOHandler` (`fs.readFileSync` + in-memory `load()`). `classifyImage` keeps `sharp` as a server-only dynamic import, resizes to 224×224, strips alpha, normalizes to 0–1, and maps argmax to `SIGN_TYPES` (`cabinet`, `channel_letter`, `flat_cut`, `post_panel`).

Update flow today is manual: export in the training repo, copy both files into `public/model/`, eyeball class-order alignment. Both files are committed (~13 MB `weights.bin`). Problems: binary churn in git history, no version traceability (which tag / `val_acc` is live?), silent class-order drift risk, half-copy failure mode.

The training repo already publishes the right shape (`docs/releasing-a-model.md` there): tag convention `model-vX.Y.Z`, side-by-side assets `model.json` + `weights.bin` + `history.json`. Current `public/model/model.json` has `weightsManifest[0].paths: ["weights.bin"]`, i.e. relative resolution already works.

Decision: fetch the pinned release at install/build time into a gitignored local dir. Inference code stays on the local-disk `IOHandler` path. Runtime `loadLayersModel(url)` and self-hosted proxy options were rejected (cold-start latency, GitHub-as-runtime-dependency, no offline dev, no checksum story).

## 2. Requirements

1. Single pin: one committed file + env override determines the exact model tag.
2. Reproducible: clean clone + `npm ci` yields the pinned weights with verification.
3. No committed binaries: `weights.bin` / `model.json` become fetch artifacts, gitignored.
4. Zero inference-path behavior change: same `IOHandler`, CPU backend, preprocessing, `SIGN_TYPES` mapping, API rounding.
5. Works in `npm run dev --webpack`, `npm run build --webpack`, `next start`, Docker, CI — with a clear error when offline and cache is cold.
6. Fail loudly on checksum or class-order mismatch.

## 3. Design

### 3.1 Pin: `model/MODEL_VERSION` + env override

- New committed file `model/MODEL_VERSION` containing one line, e.g. `model-v1.0.0`. Bumping the model = one-line PR to this file.
- Resolution order in the script: `process.env.MODEL_RELEASE_TAG` (if non-empty) else `model/MODEL_VERSION` trimmed. Env wins so CI/preview deploys can pin without a commit.
- Base URL (constant in script): `https://github.com/handleman/commercial-sign-classifier-model-training/releases/download/<tag>/`.

### 3.2 Training-repo release contract

Each `model-v*` release must contain side-by-side (no zips):

- `model.json`, `weights.bin` (existing),
- `history.json` (existing — records `val_acc`),
- `manifest.json` (new, small JSON): `{ "tag": "model-v1.0.0", "classes": ["cabinet","channel_letter","flat_cut","post_panel"], "input": [224,224,3], "val_acc": 0.93, "sha256": { "model.json": "<hex>", "weights.bin": "<hex>" } }`.

`manifest.classes` is load-bearing: the fetch script deep-equals it against `SIGN_TYPES` and aborts on mismatch, closing the silent label-permutation risk. If the training repo can't add `manifest.json` immediately, ship phase 1 with the tag's `model.json` shape check (output dim 4 + `paths == ["weights.bin"]`) and add the manifest assertion when available — the script should treat a missing manifest as a warning in phase 1, an error once the contract lands.

### 3.3 Destination dir

Keep `public/model/` as the destination in phase 1 so `lib/modelLoader.ts` needs zero changes. Add `.gitkeep` so the empty dir survives checkout; the script creates it with `mkdir -p`.

Follow-up (same PR if trivial): move to a non-served dir (e.g. `model/cache/`) and update the two `path.join` lines in `loadModel()`, so 13 MB of weights stop being publicly served at `/model/weights.bin`. This doc specifies `public/model/` paths; if the move lands, substitute the dir everywhere.

### 3.4 `scripts/fetch-model.mjs` behavior

Zero new dependencies (Node 20 `fetch`, `node:fs`, `node:crypto`, `node:path` only). Interface:

```bash
npm run fetch-model            # fetch unless warm cache matches
npm run fetch-model -- --force # re-download even if warm
MODEL_RELEASE_TAG=model-v1.0.1 npm run fetch-model
```

Steps:

1. Resolve `<tag>`, `DEST = public/model`, `FILES = [model.json, weights.bin, manifest.json]`.
2. Warm-cache fast path: if `DEST/.fetch-info.json` exists with same `tag` and `sha256` of local `model.json`/`weights.bin` matches the recorded hashes → log `model <tag> already cached, skipping` and exit 0. `--force` skips this.
3. Download each file to `DEST/<name>.tmp` via `fetch` (check `res.ok`, fail with `tag + filename + HTTP status`); also fetch `manifest.json` (warn-and-continue in phase 1 if 404, error once contract is mandatory).
4. Verify: non-zero sizes; `sha256(file) == manifest.sha256[file]` (when manifest present); `JSON.parse(model.json).weightsManifest[0].paths` deep-equals `["weights.bin"]`; `manifest.classes` deep-equals `SIGN_TYPES` read from `types/classification.ts` (parse the `SIGN_TYPES = [...]` line — do not hardcode a second copy); `manifest.tag == <tag>`.
5. Atomic install: `renameSync(<name>.tmp → <name>)` for each file, then write `DEST/.fetch-info.json` = `{ tag, fetchedAt, val_acc, classes, sha256 }`.
6. Log one line on success: `fetched model <tag> (val_acc 0.93) → public/model/`.

Failure modes: network error or 404 → exit 1 with `release <tag> not found or unreachable; check model/MODEL_VERSION and network`; checksum/class mismatch → exit 1, delete `.tmp` files, leave previous cache untouched. Never leave a half-written `weights.bin` in place.

Private-repo future: only this script changes — send `Authorization: Bearer $GITHUB_TOKEN`/`$GH_TOKEN` and resolve via the Releases API. Inference code is unaffected.

### 3.5 Lifecycle wiring (`package.json`)

```json
{ "scripts": {
  "fetch-model": "node scripts/fetch-model.mjs",
  "predev": "npm run fetch-model",
  "prebuild": "npm run fetch-model",
  "postinstall": "npm run fetch-model"
} }
```

Keep `--webpack` on `dev`/`build` untouched. `predev` covers `npm run dev`; `prebuild` covers `npm run build`; `postinstall` covers `npm ci` Docker/CI layers. The warm-cache check makes the triple hook cheap (no-op after first fetch).

Docker: `COPY model/MODEL_VERSION` + `COPY scripts/fetch-model.mjs` early, `RUN npm run fetch-model` in its own layer so weights cache across code-only rebuilds.

### 3.6 `lib/modelLoader.ts` changes

None required in phase 1. One optional addition: read `public/model/.fetch-info.json` at load time and `console.log('Model <tag> (val_acc …) loaded')` so server logs show the live version. No change to backend, preprocessing, tensor shapes, or `SIGN_TYPES` mapping.

### 3.7 Gitignore + binary removal

- `.gitignore`: add `public/model/model.json`, `public/model/weights.bin`, `public/model/manifest.json`, `public/model/.fetch-info.json`, `public/model/*.tmp`; keep `!public/model/.gitkeep`.
- After the script lands and CI is green: `git rm --cached public/model/weights.bin public/model/model.json` (separate commit). Past history keeps the old blobs; future retrains add zero binary churn.

### 3.8 Docs

- `README.md`: rewrite Model section (pin file, `npm run fetch-model`, bump flow, offline warm-cache note); check off the TODO.
- `AGENTS.md` ↔ `CLAUDE.md` (both, per repo convention): note the fetch script, pin file, gitignored `public/model/`, and that `loadModel`'s `IOHandler` stays.

## 4. Verification

1. Cold checkout: `rm -rf public/model/*.bin public/model/*.json && npm run fetch-model && ls -la public/model` → 4 files + `.fetch-info.json`, tag matches `MODEL_VERSION`.
2. Idempotency: second `npm run fetch-model` → `already cached, skipping`, exit 0, no mtimes changed.
3. Drift guard: temporarily set `MODEL_RELEASE_TAG` to a tag whose manifest classes differ (or corrupt a local byte) → script exits 1 with class/checksum error, old cache intact.
4. App: `npm run dev` and `npm run build && npm start` from cold cache succeed via hooks; spot-check `POST /api/classify` on the 4 sprite quadrants returns the expected `signType` each.
5. Lint: `npm run lint` clean.

## 5. Rollout

1. Training repo: publish `manifest.json` on the current `model-v*` tag (new patch release if immutable).
2. App PR: `scripts/fetch-model.mjs` + `model/MODEL_VERSION` + hooks + `.gitignore` + `.gitkeep` + docs; prove cold-clone `npm ci && npm run build` works.
3. Follow-up commit: `git rm --cached` the binaries; confirm fresh-clone inference unchanged.
4. Optional follow-ups: move cache out of `public/`; `GET /api/health` exposing `{ modelTag, val_acc }` from `.fetch-info.json`.
