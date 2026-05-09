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

**TravelLens** is a travel photo app: upload photos (one or many) → extract GPS + EXIF → run client-side face detection → save to map/albums.

### Data storage split

- **Auth**: Supabase Auth (`lib/supabase.ts`) — login, signup, session management. No Supabase DB tables or Storage buckets are used.
- **Photo data**: `localStorage` keyed by user ID — `map-<uid>` (MapPhoto[]), `faces-<uid>` (FacePhoto[]), `saved-<uid>` (string[] of saved photo IDs).
- **Images**: stored as base64 data URLs inside the localStorage JSON (created via `canvas.toDataURL` in `createThumbnailDataUrl`).

### Auth flow

`AuthGuard` (`components/AuthGuard.tsx`) wraps the entire app in `app/layout.tsx`. It calls `supabase.auth.getSession()` on mount and subscribes to `onAuthStateChange`. Unauthenticated users are redirected to `/login`; only `/login` and `/signup` are public paths.

Page transitions are handled by `app/template.tsx` (framer-motion fade+slide on every route change).

### Home page (`app/page.tsx`)

Single-file upload OR multi-file batch upload. On file select:
1. EXIF + GPS extracted via `exifr`
2. Face detection runs in browser (`face-api.js`)
3. Thumbnail created via `canvas.toDataURL`
4. Result saved to `map-<uid>` and `faces-<uid>` in localStorage

**Batch upload**: selecting multiple files queues them into a `BatchFile[]` state and processes them sequentially via `processBatch()`. A live progress panel shows per-file status icons and a progress bar. Stats refresh after the batch completes.

**Dashboard stat cards** (3 cards below the header): total photos saved, unique locations visited, total faces detected — read live from `map-<uid>` localStorage.

**Highlights section**: most recent upload and photo with the most faces detected.

### Face detection

`app/page.tsx` tries SSD MobileNetV1 first (higher accuracy, requires weights from `download-models.sh`); falls back to TinyFaceDetector if weights are absent. Result stored in `FacePhoto` with normalized bounding boxes and 128-dim descriptors.

`app/faces/page.tsx` clusters descriptors by Euclidean distance to group same-person appearances — no server involved.

### Albums (`app/albums/page.tsx`)

Photos grouped by location string. Filters:
- **Search bar**: matches filename or location (case-insensitive substring)
- **Date range chips**: All / This Week / This Month / This Year — filters by `captureDate` or `uploadedAt`
- Both filters compose: category → date range → search

### Backend (optional)

`backend/main.py` is a FastAPI server. The frontend polls `GET /health` on load; if it responds the app enters "API mode" (server-side EXIF+face via `/analyze`, POI lookup via `/nearby-places`). If offline, falls back to browser-mode. **Not required** for any core functionality.

### Key shared types

`lib/types.ts` — `MapPhoto` (`lat?`/`lng?` are optional; photos without GPS still appear in Albums but are filtered out of the map) and `FacePhoto`. `rowToMapPhoto` / `rowToFacePhoto` are kept for a future Supabase DB migration but currently unused.

`lib/savedUtils.ts` — `toggleSaved(photoId)` and `getSavedIds()` operate on the `saved-<uid>` localStorage key.

### Map (`app/map/page.tsx`)

Uses `react-leaflet` with OpenStreetMap tiles (free, no API key). Leaflet default icons overridden with `L.divIcon` showing a circular photo thumbnail + count badge for clustered markers. Loaded client-side only (Leaflet requires `window`). Only photos with `lat` and `lng` defined are shown.

### Reusable components

| Component | Purpose |
|---|---|
| `AuthGuard` | Auth redirect wrapper used in layout |
| `BottomNav` | Fixed bottom navigation bar (Home, Map, Albums, Faces, Saved, Stats, Profile + Logout) |
| `Header` | Top header bar |
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
| `/faces` | Face photos, person clustering by descriptor similarity |
| `/saved` | Starred photos |
| `/stats` | Full dashboard — photo counts, top locations, recent uploads grid |
| `/profile` | Edit name, change password |
| `/login` `/signup` | Public auth pages |
