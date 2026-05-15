# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Frontend (Next.js)
npm run dev        # start dev server at localhost:3000
npm run build      # production build
npm run lint       # ESLint check
npx tsc --noEmit   # TypeScript type check (no test suite exists)

# Backend (optional Python FastAPI — only needed for nearby-places feature)
cd backend
pip install -r requirements.txt
uvicorn main:app --reload   # starts at localhost:8000

# Download face-api.js model weights (~21 MB, run once from project root)
bash _scripts/download-models.sh
```

## Environment

`.env.local` must exist at the project root:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Architecture

**TravelLens** is a travel photo app: upload photos (one or many) → extract GPS + EXIF → run client-side face detection → save to map/albums. It is a PWA (`app/manifest.ts`, `/pwa-icon` route).

### Data storage split

- **Auth**: Supabase Auth (`lib/supabase.ts`) — login, signup, session management, password reset.
- **Photo data (personal)**: `localStorage` keyed by user ID — `map-<uid>` (MapPhoto[]), `faces-<uid>` (FacePhoto[]), `saved-<uid>` (string[] of saved photo IDs).
- **Images (personal)**: stored as base64 data URLs inside the localStorage JSON (created via `canvas.toDataURL` in `createThumbnailDataUrl`).
- **Supabase DB tables** (for social features):
  - `notifications` — per-user notifications, queried via `lib/notificationUtils.ts`
  - `collab_albums`, `collab_members`, `collab_photos` — collaborative albums, managed via `lib/collabUtils.ts`
  - `shares` — public photo share links, managed via `lib/shareUtils.ts`
  - RPC: `join_collab_album(p_invite_code)`, `record_share_view(p_share_id)`
- **Supabase Storage buckets**: `collab-photos` (collab album images), `shares` (shared photo images). Base64 data URLs are uploaded as blobs before inserting the record.

### Auth flow

`AuthGuard` (`components/AuthGuard.tsx`) wraps the entire app in `app/layout.tsx`. It calls `supabase.auth.getSession()` on mount and subscribes to `onAuthStateChange`. Unauthenticated users are redirected to `/login`; only `/login`, `/signup`, `/forgot-password`, `/reset-password`, and `/share/[id]` are public paths.

Page transitions are handled by `app/template.tsx` (framer-motion fade+slide on every route change).

### Home page (`app/page.tsx`)

Single-file upload OR multi-file batch upload. On file select:
1. EXIF + GPS extracted via `exifr`
2. Face detection runs in browser (`face-api.js`)
3. Thumbnail created via `canvas.toDataURL`
4. Result saved to `map-<uid>` and `faces-<uid>` in localStorage

**Batch upload**: selecting multiple files queues them into a `BatchFile[]` state and processes them sequentially via `processBatch()`. A live progress panel shows per-file status icons and a progress bar. Stats refresh after the batch completes.

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

`app/faces/page.tsx` clusters descriptors by Euclidean distance (DBSCAN on the backend, Euclidean threshold in-browser) to group same-person appearances — no server involved for the clustering step.

### Albums (`app/albums/page.tsx`)

Photos grouped by location string. Filters:
- **Search bar**: matches filename or location (case-insensitive substring)
- **Date range chips**: All / This Week / This Month / This Year — filters by `captureDate` or `uploadedAt`
- Both filters compose: category → date range → search

### Notifications (`lib/notificationUtils.ts`)

Real-time notifications via Supabase Realtime. `subscribeToNotifications(userId, onNew)` opens a postgres_changes channel filtered to `user_id`. The `NotificationBell` component (shown in Header) polls on mount and subscribes for live inserts. Notification types: `share_viewed`, `collab_joined`, `collab_photo_added`.

### Collaborative albums (`lib/collabUtils.ts`, `app/collab/page.tsx`)

Users create shared albums with an invite code. Others join via `joinAlbumByCode` (calls `join_collab_album` RPC). Roles: owner / contributor / viewer. Photos are uploaded to the `collab-photos` storage bucket and stored in `collab_photos` table. Individual album detail pages live at `/collab/[id]`.

### Sharing (`lib/shareUtils.ts`)

`sharePhoto(photo)` uploads the base64 image to the `shares` storage bucket, inserts a row into `shares`, and returns a public URL (`/share/[id]`). The share page is public (no auth required). Views are tracked via the `record_share_view` RPC.

### Backend (optional)

`backend/main.py` is a FastAPI server. The frontend polls `GET /health` on load; if it responds the app enters "API mode" (server-side EXIF+face via `/analyze`, POI lookup via `/nearby-places`). If offline, falls back to browser-mode. **Not required** for any core functionality.

Key backend files:
- `backend/utils/face_utils.py` — two-tier face pipeline (InsightFace Tier 1, SSD+dlib Tier 2). InsightFace downloads `buffalo_l` (~200 MB) to `~/.insightface/models/buffalo_l/` on first run.
- `backend/utils/exif_utils.py` — EXIF extraction + reverse geocoding
- `backend/utils/places_utils.py` — Overpass API for nearby POIs
- `backend/requirements.txt` — includes `insightface`, `onnxruntime`, `opencv-python`, `exifread`, `face-recognition`, `scikit-learn`

To install InsightFace tier: `pip install insightface onnxruntime` (already in requirements.txt).

### Key shared types

`lib/types.ts` — `MapPhoto` (`lat?`/`lng?` are optional; photos without GPS still appear in Albums but are filtered out of the map) and `FacePhoto`. `rowToMapPhoto` / `rowToFacePhoto` are kept for a future Supabase DB migration but currently unused for personal photos.

`lib/savedUtils.ts` — `toggleSaved(photoId)` and `getSavedIds()` operate on the `saved-<uid>` localStorage key.

### Map (`app/map/page.tsx`)

Uses `react-leaflet` with OpenStreetMap tiles (free, no API key). Leaflet default icons overridden with `L.divIcon` showing a circular photo thumbnail + count badge for clustered markers. Loaded client-side only (Leaflet requires `window`). Only photos with `lat` and `lng` defined are shown.

### Reusable components

| Component | Purpose |
|---|---|
| `AuthGuard` | Auth redirect wrapper used in layout |
| `BottomNav` | Fixed bottom navigation bar |
| `Header` | Top header bar (includes `NotificationBell`) |
| `NotificationBell` | Real-time notification dropdown in Header |
| `AppLogo` | Shared logo component |
| `PhotoCard` | Photo thumbnail card used in Albums/Saved |
| `PhotoPreview` | Full-size photo preview modal |
| `UploadBox` | Drag-and-drop / click-to-upload file input |
| `ClientMapPage` | Client-only wrapper for the Leaflet map |
| `MapPlaceholder` | SSR placeholder shown before Leaflet loads |

### Pages

| Route | Purpose |
|---|---|
| `/` | Upload + analyze photo(s), dashboard stats + highlights |
| `/map` | Leaflet map with photo markers |
| `/albums` | Photos grouped by location, search + date range filter |
| `/faces` | Face photos, person clustering; color-coded PALETTE per cluster, gradient hero header, `PhotoModal` + `PersonModal` |
| `/saved` | Starred photos |
| `/stats` | Full dashboard — photo counts, top locations, recent uploads grid |
| `/collab` | Collaborative albums list + create; `/collab/[id]` for album detail |
| `/share/[id]` | Public share page (no auth required) |
| `/profile` | Edit name, change password |
| `/login` `/signup` | Public auth pages |
| `/forgot-password` `/reset-password` | Password reset flow |

### Metadata / Viewport

`app/layout.tsx` exports two named constants — `metadata` (title, description, appleWebApp) and `viewport` (themeColor). Next.js App Router requires `themeColor` in the `viewport` export, **not** inside `metadata`. Putting it in `metadata` produces a build warning.
