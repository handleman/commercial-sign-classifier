# AGENTS.md

> Agent config sync: this repo supports both OpenCode (`AGENTS.md`) and Claude Code (`CLAUDE.md`). If you update one, mirror the change in the other — they must always stay in sync.

## Commands

- `npm run dev` — dev server. Script already includes `--webpack`; keep it (default Turbopack breaks the `sharp`/`canvas`/`null-loader` setup in `next.config.ts`).
- `npm run build` / `npm start` — production build (script includes `--webpack`, same reason as dev) / serve.
- `npm run lint` — ESLint (flat config, `next/core-web-vitals` + `next/typescript`). No test runner, no typecheck script, no CI.

## Architecture

Single-package Next.js App Router app. Classifies an uploaded image as `cabinet` | `channel_letter` | `flat_cut` | `post_panel`.

Flow: `app/components/ChatInterface.tsx` POSTs multipart form data (`image` field) to `app/api/classify/route.ts` → `lib/modelLoader.ts:classifyImage` → result rendered by `app/components/ClassificationResult.tsx`.

`lib/modelLoader.ts` specifics:
- Model is trained in a separate repo ([commercial-sign-classifier-model-training](https://github.com/handleman/commercial-sign-classifier-model-training)); the exported `model.json` + `weights.bin` are copied into `public/model/` here. Never edit them by hand; to update, re-export there and copy over, keeping the output class order aligned with `SIGN_TYPES`.
- Lazy-loads and caches the TF.js model on first request (`loadModel`). Reads `public/model/model.json` + `public/model/weights.bin` from disk via a custom `tf.io.IOHandler` — do not switch to `loadLayersModel(url)`.
- Inference runs on the CPU backend (`tf.setBackend('cpu')`).
- Preprocessing: `sharp` resize to 224×224, `removeAlpha()`, raw pixels normalized to 0–1 into `tf.tensor4d(..., [1, 224, 224, 3])`. `sharp` is dynamically imported inside `classifyImage` — keep it server-only, never import from client components.
- Argmax index maps to `SIGN_TYPES` order in `types/classification.ts` (`cabinet`, `channel_letter`, `flat_cut`, `post_panel`); returns confidence × 100. The API route rounds to 2 decimals.

## Gotchas

- `next.config.ts`: `sharp` is in `serverExternalPackages`, `canvas` is a server external, `null-loader` suppresses `node-pre-gyp` HTML/MD. `images.unoptimized: true`. Don't remove these to "simplify".
- Path alias `@/*` → repo root (via `tsconfig.json` `paths`; the build fails without it — do not delete).
- `public/model/` (`model.json`, `weights.bin`) and `public/assets/sign_types.jpg` (2×2 reference sprite: TL `cabinet`, TR `channel_letter`, BL `flat_cut`, BR `post_panel`) are committed assets. The API returns the sprite URL for every result; `ClassificationResult.tsx` crops the matching quadrant via `SPRITE_POSITIONS` (`background-position`).
- `README.md` describes setup and usage. No `.env` required.
- Tailwind v4 via `@tailwindcss/postcss`.

## Design docs

- On request, write design docs as markdown under `docs/design/` (kebab-case filenames).
- When writing or reviewing a design doc, follow `.opencode/skills/architect/SKILL.md` (OpenCode loads it as the `architect` skill; other tools: read the file directly).
