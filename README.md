# Commercial Sign Classifier

Upload a photo of a commercial sign and get an instant classification: **Cabinet**, **Channel Letter**, **Flat Cut**, or **Post Panel** — with a confidence score and a reference image.

Built with Next.js App Router + TensorFlow.js (server-side inference) + Sharp preprocessing. The model runs locally on the server; no external API calls.

## Getting Started

Prerequisites: Node.js 20+ and npm.

```bash
npm install
npm run dev      # http://localhost:3000 (uses --webpack flag, see below)
```

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (`next dev --webpack`) |
| `npm run build` | Production build (`next build --webpack`) |
| `npm start` | Serve production build |
| `npm run lint` | ESLint |

No test runner, no `.env` file, no extra services required.

## How It Works

1. User uploads an image in the chat UI (`app/components/ChatInterface.tsx`).
2. The browser POSTs multipart form data (`image` field) to `POST /api/classify` (`app/api/classify/route.ts`).
3. The API route passes the buffer to `classifyImage()` in `lib/modelLoader.ts`, which:
   - Lazy-loads and caches the TF.js model from `public/model/` on first request (custom `tf.io.IOHandler` reading `model.json` + `weights.bin` from disk).
   - Preprocesses with Sharp: resize to 224×224, strip alpha, normalize pixels to 0–1, CPU-backend inference.
   - Argmax over the output maps to `SIGN_TYPES` order (`cabinet`, `channel_letter`, `flat_cut`, `post_panel`); confidence is × 100, rounded to 2 decimals by the API.
4. The UI renders the result via `app/components/ClassificationResult.tsx`, including the matching quadrant of the `public/assets/sign_types.jpg` reference sprite (CSS `background-position`, see `SPRITE_POSITIONS`).

### API

`POST /api/classify` — form field `image` (must be `image/*`).

Success response:

```json
{ "signType": "channel_letter", "confidence": 94.21, "imageUrl": "/assets/sign_types.jpg" }
```

Errors: `400` missing file / not an image, `500` classification failure.

## Model

The classifier model is trained in a separate repo: [commercial-sign-classifier-model-training](https://github.com/handleman/commercial-sign-classifier-model-training) (MobileNetV1 transfer learning, TF.js LayersModel export). The exported `model.json` + `weights.bin` are copied into `public/model/` here and served locally — training code and datasets live only in that repo.

To update the model: retrain/export there, then copy the new `model.json` + `weights.bin` into `public/model/`. Keep the output class order aligned with `SIGN_TYPES` in `types/classification.ts`.

## Project Structure

- `app/page.tsx` — home page, renders `ChatInterface`.
- `app/components/ChatInterface.tsx` — upload + message history UI.
- `app/components/ClassificationResult.tsx` — result display.
- `app/api/classify/route.ts` — classification endpoint.
- `lib/modelLoader.ts` — model loading, preprocessing, inference (server-only).
- `types/classification.ts` — `SignType`, `SIGN_TYPES` order, labels.
- `public/model/model.json` + `weights.bin` — committed TF.js model assets, exported from the [model-training repo](https://github.com/handleman/commercial-sign-classifier-model-training).
- `public/assets/sign_types.jpg` — committed 2×2 reference sprite (top-left `cabinet`, top-right `channel_letter`, bottom-left `flat_cut`, bottom-right `post_panel`). The API returns its URL for every result; the UI crops the matching quadrant.

## Notes for Contributors

- `npm run dev` must keep the `--webpack` flag: the default Turbopack build breaks the `sharp` / `canvas` / `null-loader` setup in `next.config.ts`.
- `sharp` is server-only (dynamic import inside `classifyImage`, listed in `serverExternalPackages`). Never import it from client components.
- `next.config.ts` externalizes `canvas`, uses `null-loader` for `node-pre-gyp` HTML/MD, and sets `images.unoptimized: true` — don't remove these.
- Path alias `@/*` maps to the repo root; Tailwind v4 via `@tailwindcss/postcss`.
- Agent instructions: this repo supports both **Claude Code (`CLAUDE.md`)** and **OpenCode (`AGENTS.md`)**. If you change one, mirror the change in the other — they must stay in sync.

## TODO

- [ ] Load the published model from its GitHub Release in the [model-training repo](https://github.com/handleman/commercial-sign-classifier-model-training) instead of manually copying `model.json` + `weights.bin` into `public/model/`.
