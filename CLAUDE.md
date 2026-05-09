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

**TravelLens** is a travel photo app: upload a photo → extract GPS + EXIF → run client-side face detection → save to map/albums.

### Data storage split

- **Auth**: Supabase Auth (`lib/supabase.ts`) — login, signup, session management.
- **Photo data**: `localStorage` keyed by user ID — `map-<uid>` (MapPhoto[]), `faces-<uid>` (FacePhoto[]), `saved-<uid>` (string[] of saved photo IDs). This deliberately avoids needing Supabase DB tables to be set up.
- **Images**: stored as base64 data URLs inside the localStorage JSON (created via `canvas.toDataURL` in `createThumbnailDataUrl`).

### Auth flow

`AuthGuard` (`components/AuthGuard.tsx`) wraps the entire app in `app/layout.tsx`. It calls `supabase.auth.getSession()` on mount and subscribes to `onAuthStateChange`. Unauthenticated users are redirected to `/login`; only `/login` and `/signup` are public paths.

Page transitions are handled by `app/template.tsx` (framer-motion fade+slide on every route change).

### Face detection

`app/page.tsx` runs face detection entirely in the browser using `face-api.js`. On file select it tries to load the SSD MobileNetV1 model first (higher accuracy, requires the weights from `download-models.sh`); falls back to TinyFaceDetector if SSD weights are absent. The result is stored in localStorage as part of the `FacePhoto` object including normalized bounding boxes and 128-dim face descriptors.

`app/faces/page.tsx` clusters stored face descriptors by Euclidean distance to group appearances of the same person — no server involved.

### Backend (optional)

`backend/main.py` is a FastAPI server. The frontend polls `GET /health` on load; if it responds the app enters "API mode" (uses `/analyze` for EXIF+face detection server-side and `/nearby-places` for POI lookup). If the backend is offline the app falls back to browser-mode (exifr for EXIF, face-api.js for detection, Nominatim for geocoding). The backend is **not required** for any core functionality.

### Key shared types

`lib/types.ts` defines `MapPhoto` and `FacePhoto` and their converter functions `rowToMapPhoto` / `rowToFacePhoto` (currently unused since data comes from localStorage, but kept for future Supabase DB migration).

`lib/savedUtils.ts` — `toggleSaved(photoId)` and `getSavedIds()` operate on the `saved-<uid>` localStorage key.

### Map

`app/map/page.tsx` uses `react-leaflet` with OpenStreetMap tiles (free, no API key). Leaflet default icons are overridden with custom `L.divIcon` that renders a circular photo thumbnail with a count badge for clustered markers. The map is loaded client-side only (Leaflet requires `window`).

### Pages

| Route | Purpose |
|---|---|
| `/` | Upload + analyze photo, save to map |
| `/map` | Leaflet map with photo markers |
| `/albums` | Photos grouped by location with filters |
| `/faces` | Face photos, person clustering by descriptor similarity |
| `/saved` | Starred photos |
| `/stats` | Dashboard — photo counts, location breakdown, recent uploads |
| `/profile` | Edit name, change password |
| `/login` `/signup` | Public auth pages |
