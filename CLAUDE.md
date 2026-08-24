# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Frontend (Next.js)
npm run dev        # start dev server at localhost:3000
npm run build      # production build
npm start          # serve production build
npm run lint       # ESLint check
npx tsc --noEmit   # TypeScript type check (no test suite exists)

# Deploy — Vercel (auto-deploy on push), which handles the dynamic routes
# (/share/[id], /collab/[id]) via SSR. next.config.ts has no `output: "export"` —
# don't add one without also solving those two routes, since static export can't
# serve IDs that are created at runtime and can't be enumerated at build time.

# Backend (optional Python FastAPI — only needed for nearby-places / AI diary / landmark features)
cd backend
pip install -r requirements.txt
uvicorn main:app --reload   # starts at localhost:8000, auto-loads backend/.env (python-dotenv)

# Download face-api.js model weights (~21 MB, run once from project root)
bash _scripts/download-models.sh
```

## Environment

`.env.local` must exist at the project root:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

`backend/.env` (optional, only for the AI diary/landmark endpoints — see below):
```
ANTHROPIC_API_KEY=...
```

## Architecture

**Travelries** is a travel photo app: upload photos (one or many) → extract GPS + EXIF → run client-side face detection → save to map/albums. It is a PWA (`app/manifest.ts`, `/pwa-icon` route).

### Data storage split

- **Auth**: Supabase Auth (`lib/supabase.ts`) — login, signup, session management, password reset.
- **Photo data (personal)**: `localStorage` keyed by user ID — `map-<uid>` (MapPhoto[]), `faces-<uid>` (FacePhoto[]), `saved-<uid>` (string[] of saved photo IDs).
- **Images (personal)**: stored as base64 data URLs inside the localStorage JSON (created via `canvas.toDataURL` in `createThumbnailDataUrl`).
- **Supabase DB tables** (for social features):
  - `profiles` — display name + join date per user; auto-created on first profile page load if missing
  - `notifications` — per-user notifications, queried via `lib/notificationUtils.ts`
  - `collab_albums`, `collab_members`, `collab_photos` — collaborative albums, managed via `lib/collabUtils.ts`
  - `shares` — public photo share links, managed via `lib/shareUtils.ts`
  - RPC: `join_collab_album(p_invite_code)`, `record_share_view(p_share_id)`
- **Supabase Storage buckets**: `collab-photos` (collab album images), `shares` (shared photo images). Base64 data URLs are uploaded as blobs before inserting the record.

### Auth flow

`AuthGuard` (`components/AuthGuard.tsx`) wraps the entire app in `app/layout.tsx`. It calls `supabase.auth.getSession()` on mount and subscribes to `onAuthStateChange`. While the session check is in flight it renders a full-screen 🌍 spinner. Unauthenticated users are redirected to `/login`; public paths are `/login`, `/signup`, `/forgot-password`, `/reset-password`, and `/share/[id]` (matched with `path.startsWith("/share/")`).

`NotificationBell` is rendered directly in `app/layout.tsx` (not inside `Header`) so it floats over all pages globally.

Page transitions are handled by `app/template.tsx` (framer-motion fade+slide on every route change).

### Home page (`app/page.tsx`)

Single-file upload OR multi-file batch upload. On file select:
1. EXIF + GPS extracted via `exifr`
2. Face detection runs in browser (`face-api.js`)
3. Thumbnail created via `canvas.toDataURL`
4. Result saved to `map-<uid>` and `faces-<uid>` in localStorage

**Batch upload**: selecting multiple files queues them into a `BatchFile[]` state and processes them sequentially via `processBatch()`. A live progress panel shows per-file status icons and a progress bar. Once all files finish, the panel switches to a review grid (one card per uploaded photo, with face-count/scenery badges) where tapping a photo lets you rename it before dismissing. Stats refresh after the batch completes.

**Dashboard stat cards**: total photos saved, unique locations visited, total faces detected — read live from `map-<uid>` localStorage.

**Highlights section**: most recent upload and photo with the most faces detected.

### Face detection

Two execution modes depending on whether the Python backend is running:

**Browser mode** (no backend): `app/page.tsx` uses face-api.js — tries SSD MobileNetV1 first (requires weights from `download-models.sh`), falls back to TinyFaceDetector. Returns 128-dim descriptors. No age/gender.

**API mode** (backend alive): `app/page.tsx` POSTs to `/analyze`. The backend runs a two-tier pipeline in `backend/utils/face_utils.py`:
- **Tier 1 (InsightFace buffalo_l)**: SCRFD detector at 1280×1280 with tiling for images larger than 1280px (1024px stride, 256px overlap). IoU-based NMS deduplicates tile boundaries. Returns 512-dim ArcFace embeddings + age + gender.
- **Tier 2 (SSD+dlib fallback)**: Used only if InsightFace/onnxruntime is not installed. Returns 128-dim dlib descriptors, no age/gender.
- EXIF Orientation is corrected before detection so portrait phone photos are upright.
- Backend `/analyze` response includes `ages`, `genders`, `confidences` in addition to `faceBoxes` and `descriptors`.

Result stored in `FacePhoto` with normalized bounding boxes (`x_norm`, `y_norm`, `w_norm`, `h_norm`).

`app/faces/page.tsx` clusters descriptors by Euclidean distance (DBSCAN on the backend, Euclidean threshold in-browser) to group same-person appearances — no server involved for the clustering step. The in-browser threshold is a fixed constant (`MATCH_THRESHOLD = 0.55` in that file, tuned empirically) — there is intentionally no UI to change it; a previous adjustable slider was removed because it kept resetting/drifting. Deleting a photo (single, via a per-photo confirm modal, or all at once via "Clear All") goes through `deletePhotoEverywhere` in `lib/savedUtils.ts`, which removes it from `map-<uid>`, `faces-<uid>`, and `saved-<uid>` together (matching by id or, for faces, by `fileName` since the two stores may have assigned different UUIDs to the same upload), and also deletes any matching row from `collab_photos` in Supabase.

### Other pages

- **`app/saved/page.tsx`**: Grid of photos starred via `toggleSaved`. Downloads are triggered via a temporary `<a>` element against the base64 data URL.
- **`app/stats/page.tsx`**: Aggregated read-only view computed from `map-<uid>` and `faces-<uid>` localStorage on mount — no Supabase queries.
- **`app/profile/page.tsx`**: Reads/writes `profiles` table; validates old password via a re-`signInWithPassword` call before calling `updateUser`.
- **`app/collab/join/page.tsx`**: Accepts an invite code and calls `joinAlbumByCode` (RPC). Redirects to `/collab` on success.

### Albums (`app/albums/page.tsx`)

Photos grouped by location string. Filters:
- **Search bar**: matches filename or location (case-insensitive substring)
- **Date range chips**: All / This Week / This Month / This Year — filters by `captureDate` or `uploadedAt`
- Both filters compose: category → date range → search

### Notifications (`lib/notificationUtils.ts`)

Real-time notifications via Supabase Realtime. `subscribeToNotifications(userId, onNew)` opens a postgres_changes channel filtered to `user_id`. The `NotificationBell` component polls on mount and subscribes for live inserts. Notification types: `share_viewed`, `collab_joined`, `collab_photo_added`.

### Collaborative albums (`lib/collabUtils.ts`, `app/collab/page.tsx`)

Users create shared albums with an invite code. Others join via `joinAlbumByCode` (calls `join_collab_album` RPC). Roles: owner / contributor / viewer. Photos are uploaded to the `collab-photos` storage bucket and stored in `collab_photos` table. Individual album detail pages live at `/collab/[id]`.

### Sharing (`lib/shareUtils.ts`)

`sharePhoto(photo)` uploads the base64 image to the `shares` storage bucket, inserts a row into `shares`, and returns a public URL (`/share/[id]`). The share page is public (no auth required). Views are tracked via the `record_share_view` RPC.

### Backend (optional)

`backend/main.py` is a FastAPI server. The frontend polls `GET /health` on load; if it responds the app enters "API mode" (server-side EXIF+face via `/analyze`, POI lookup via `/nearby-places`). If offline, falls back to browser-mode. **Not required** for any core functionality. `/health`'s response includes `utils_available`, `places_available`, `claude_available` — each backend feature degrades independently (missing deps or an unset `ANTHROPIC_API_KEY` return a JSON `error` field from that endpoint rather than a 500).

Key backend files:
- `backend/utils/face_utils.py` — two-tier face pipeline (InsightFace Tier 1, SSD+dlib Tier 2). InsightFace downloads `buffalo_l` (~200 MB) to `~/.insightface/models/buffalo_l/` on first run.
- `backend/utils/exif_utils.py` — EXIF extraction + reverse geocoding
- `backend/utils/places_utils.py` — Overpass API for nearby POIs
- `backend/utils/claude_utils.py` — Claude API (Anthropic SDK, model `claude-opus-5`) wrappers behind `/generate-diary` (photo metadata → short first-person travel diary, `client.messages.create`) and `/recognize-landmark` (photo → landmark name/confidence via `client.messages.parse` + a Pydantic `LandmarkResult` schema). Both require `ANTHROPIC_API_KEY`; there is no frontend UI calling these yet.

To install InsightFace tier: `pip install insightface onnxruntime` (already in `backend/requirements.txt`).

### Key shared types

`lib/types.ts` — `MapPhoto` (`lat?`/`lng?` are optional; photos without GPS still appear in Albums but are filtered out of the map) and `FacePhoto`. `rowToMapPhoto` / `rowToFacePhoto` are kept for a future Supabase DB migration but currently unused for personal photos — personal photo data stays localStorage-only for now (see Data storage split above). Both converters read from the *same* live `public.photos` table (already created in the Supabase project — one unified table with `is_map_photo`/`is_face_photo` boolean flags per row, not a `photos`/`face_photos` split; a `saved_photos` join table backs favorites). `image_url` is stored directly on the row as the full Storage public URL (bucket `user-photos`) — there's no separate path column. `supabase/migrations/0001_add_missing_photo_columns.sql` only adds columns the app's types need that the live table didn't have yet (`capture_timestamp`, `confidences`, `ages`, `genders`, `expressions`) — it does not create tables. Before writing any new migration against `photos`/`saved_photos`, check the live schema in the Supabase dashboard (Table Editor) rather than assuming — an earlier session drafted a competing two-table schema without checking first and had to throw it away.

`MapPhoto.captureTimestamp` is an ISO 8601 string populated alongside the display-only `captureDate`/`captureTime` (which are locale-formatted via `toLocaleDateString()`/`toLocaleTimeString()` and are **not** safe to sort or compare). Anything that needs chronological order — e.g. the map's route line — must sort by `captureTimestamp` (falling back to `uploadedAt` for photos saved before this field existed), never by `captureDate`.

`lib/savedUtils.ts` — `toggleSaved(photoId)` and `getSavedIds()` operate on the `saved-<uid>` localStorage key.

### Map (`app/map/page.tsx`)

Uses `react-leaflet` with OpenStreetMap tiles (free, no API key). Leaflet default icons overridden with `L.divIcon` showing a circular photo thumbnail + count badge for clustered markers. Loaded client-side only (Leaflet requires `window`). Only photos with `lat` and `lng` defined are shown.

Two optional overlay toggles, mutually exclusive with the marker view when heatmap is on:
- **Route**: a `RouteLayer` component draws photos as a Polyline in chronological order (sorted by `captureTimestamp`, see above) — a white casing line for contrast against any tile color, an animated flowing dashed line on top (`route-flow-line` keyframe in `app/globals.css`), and a rotated arrow `Marker` at each segment midpoint (bearing computed via `bearingDeg()`) showing travel direction.
- **Heatmap**: `HeatmapLayer` wraps the `leaflet.heat` plugin (`L.heatLayer`, imperatively added/removed via `useMap()` + `useEffect` since it has no react-leaflet component) — replaces the cluster markers while active.

### Metadata / Viewport

`app/layout.tsx` exports two named constants — `metadata` (title, description, appleWebApp) and `viewport` (themeColor). Next.js App Router requires `themeColor` in the `viewport` export, **not** inside `metadata`. Putting it in `metadata` produces a build warning.
