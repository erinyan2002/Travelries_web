# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Frontend (Next.js)
npm run dev        # start dev server at localhost:3000 (runs `next dev --webpack`, not Turbopack)
                   # NOTE: in this checkout's path ("4-2 캡디(2) travelries_final") the dev
                   # server does NOT hot-reload — edits only show after restarting it
                   # (kill, rm -rf .next, npm run dev). An ASCII path without parentheses works.
npm run build      # production build
npm start          # serve production build
npm run lint       # ESLint check
npx tsc --noEmit   # TypeScript type check
npm test           # vitest unit tests (lib/**/*.test.ts) — pure logic only
npx vitest run lib/trips.test.ts   # a single test file (add -t "name" for one test)

# Deploy — Vercel (auto-deploy on push), which handles the dynamic routes
# (/share/[id], /collab/[id]) via SSR. next.config.ts has no `output: "export"` —
# don't add one without also solving those two routes, since static export can't
# serve IDs that are created at runtime and can't be enumerated at build time.

# Backend (optional Python FastAPI — only needed for nearby-places / AI diary / landmark features)
cd backend
pip install -r requirements.txt
uvicorn main:app --reload   # starts at localhost:8000, auto-loads backend/.env (python-dotenv)

# Database migrations: supabase/migrations/NNNN_*.sql are NOT applied by any tool —
# each file is pasted and run by hand in the Supabase SQL editor. Add new ones with the
# next number; write them idempotently (create or replace / if not exists).

# Download browser face-detection models (~33 MB: face-api.js weights + MediaPipe model/wasm, run once from project root)
bash _scripts/download-models.sh
```

## Environment

`.env.local` must exist at the project root:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_BACKEND_URL=...   # optional; defaults to http://localhost:8000 (lib/backend.ts)
```

`backend/.env` (optional, only for the AI diary/landmark endpoints — see below):
```
GOOGLE_API_KEY=...
ALLOWED_ORIGINS=...   # optional, comma-separated extra CORS origins (e.g. the Vercel URL)
```

## Architecture

**Travelries** is a travel photo app: upload photos (one or many) → extract GPS + EXIF → run client-side face detection → save to map/albums. It is a PWA (`app/manifest.ts`, `/pwa-icon-192` and `/pwa-icon-512` routes).

The backend URL comes from `lib/backend.ts` (`NEXT_PUBLIC_BACKEND_URL`; without it, `http://<the page's hostname>:8000`, so a phone opening the dev server by LAN IP finds a backend started with `--host 0.0.0.0`). For that phone setup, `next.config.ts` sets `allowedDevOrigins` to this machine's LAN IPs, the backend CORS allows private-network origins by regex, and ids come from `lib/id.ts` `newId()` rather than `crypto.randomUUID`, which only exists in secure contexts (https or localhost). The localhost default only works when the browser and the backend are on the same machine, so the deployed Vercel site stays in browser mode unless a deployed backend URL is set there and added to the backend's `ALLOWED_ORIGINS`. Every main page opens with the shared `components/PageHero.tsx` banner rather than a per-page header. Shared visual primitives live in `app/globals.css` (`tv-card`, `tv-modal`, `tv-overlay`, `tv-btn-primary`/`tv-btn-soft`, and the fixed pastel `body` background; the Pretendard font is a `<link>` in `app/layout.tsx`, deliberately kept out of the CSS pipeline). For a picker inside a card, use `components/ActionMenu.tsx` (a chip button plus a popover portaled to `<body>`) rather than a native `<select>`. Every `tv-card` has `backdrop-filter`, which creates a stacking context, so an in-card popover would be painted under the next card. Pages leave `<main>` transparent, so reuse these classes instead of re-spelling card, modal or button styles.

### Data storage split

- **Auth**: Supabase Auth (`lib/supabase.ts`) — login, signup, session management, password reset.
- **Photo data (personal)**: Supabase `photos` table via `lib/photosApi.ts` (see Key shared types below) — replaced the old `map-<uid>`/`faces-<uid>`/`saved-<uid>` localStorage arrays. Faces-page person names now live in the `people` table too; the old `face-labels-<uid>` localStorage map is only read once, to migrate it (see Manual person grouping).
- **Images (personal)**: uploaded to the `user-photos` Storage bucket (`uploadToUserPhotos` in `lib/photosApi.ts`, path `<uid>/<photoId>.<ext>`); the row's `image_url` stores the resulting public URL directly. There is **no** base64 fallback: a failed upload retries once and then throws, because inline images bloated every `photos` row. The face save and Save to Map both upload to the same deterministic path, so an "already exists" error just returns that URL. `migrateInlineImages` (run on Home page load) moves any old inline-base64 rows into Storage.
- **Supabase DB tables** (for social features):
  - `profiles` — display name + join date per user; auto-created on first profile page load if missing
  - `notifications` — per-user notifications, queried via `lib/notificationUtils.ts`
  - `collab_albums`, `collab_members`, `collab_photos` — collaborative albums, managed via `lib/collabUtils.ts`
  - `shares` — public photo share links, managed via `lib/shareUtils.ts`
  - `trip_diaries` — cached AI-generated diary text per trip, keyed by `(user_id, trip_key)`; see the AI diary/landmark caching note under Albums below
  - `follows`, `posts`, `post_likes`, `post_comments`, `post_tags` — social feed layer, managed via `lib/socialUtils.ts`; see Social feed below
  - `trip_shares` — public whole-trip share snapshots (migration 0013), see Sharing below
  - RPC: `join_collab_album(p_invite_code)`, `record_share_view(p_share_id)`, `tag_user_in_post`, `share_post_to_user` (see Social feed)
- **Supabase Storage buckets**: `user-photos` (personal photos), `collab-photos` (collab album images), `shares` (shared photo images).

### Auth flow

`AuthGuard` (`components/AuthGuard.tsx`) wraps the entire app in `app/layout.tsx`. It calls `supabase.auth.getSession()` on mount and subscribes to `onAuthStateChange`. While the session check is in flight it renders a full-screen 🌍 spinner. Unauthenticated users are redirected to `/login`; public paths are `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/share/[id]` and `/trip/[id]` (matched with `path.startsWith("/share/")` / `"/trip/"`).

`NotificationBell` is rendered directly in `app/layout.tsx` (not inside `Header`) so it floats over all pages globally.

Page transitions are handled by `app/template.tsx` (framer-motion fade+slide on every route change).

### Home page (`app/page.tsx`)

Single-file upload OR multi-file batch upload. On file select:
1. EXIF + GPS extracted via `exifr`
2. Face detection runs in browser (or via the backend in API mode — see Face detection below)
3. Thumbnail created via `canvas.toDataURL`
4. Detected faces are upserted into Supabase `photos` (`is_face_photo: true`) via `lib/photosApi.ts` (`upsertPhoto`/`saveFacesToAlbum`); clicking "Save to Map" afterward reuses that same row's id and adds `is_map_photo: true` + location fields, rather than creating a second row — see Key shared types below for why that matters. That shared row id (`lastFacePhotoIdRef`) and the user-edited filename (`customFileNameRef`) live in `useRef`s, reserved synchronously *before* any `await` — they were `useState` and caused lost renames and duplicate rows when a rename or Save to Map raced an in-flight face save. Keep any id/value shared across async handlers in a ref.

**Multi-face save picker**: with exactly one face detected, `saveFacesToAlbum` saves it immediately as before. With 2+ faces, upload instead pauses in a `needsSelection` state — `cropFaceThumbnails` renders a padded, cropped thumbnail per detected box so the user can pick which people to save via `toggleFaceSelection`/`handleSaveSelectedFaces`, rather than saving every face in a group photo. `age`/`gender`/`expression` are only written when every detected face was selected, since a partial selection would otherwise misalign those arrays against the (possibly null-dropping) backend response. "Save to Map" writes `faceCount` from `savedFaceCount` (faces actually saved), not the raw detection count.

**Batch upload**: selecting multiple files queues them into a `BatchFile[]` state and processes them sequentially via `processBatch()` — through the backend's `/analyze` when it's online, same as single uploads (it used to always use the weaker browser detector). A live progress panel shows per-file status icons and a progress bar. Once all files finish, the panel switches to a review grid (`components/BatchUploadPanel.tsx`; one card per uploaded photo, with face-count/scenery badges) where tapping a photo lets you rename it before dismissing. Stats refresh after the batch completes.

**Dashboard stat cards**: total photos saved, unique locations visited, total faces detected — read live via `fetchMapPhotos`/`fetchFacePhotos` (`lib/photosApi.ts`).

**Highlights section**: most recent upload and photo with the most faces detected.

### Face detection

Two execution modes depending on whether the Python backend is running:

**Browser mode** (no backend): `runFaceDetection` (`lib/faceDetection.ts`, called from `app/page.tsx`) tries MediaPipe BlazeFace (`lib/mediapipeDetector.ts`, self-hosted models+WASM under `public/mediapipe-wasm` and `public/models/mediapipe`, requires `download-models.sh`) as the primary detector — each MediaPipe box is padded ~30% and cropped, then run through face-api.js's TinyFaceDetector to confirm/align/recognize (128-dim descriptor) within that crop. The **stored box is face-api's own detection translated back to full-image coordinates, not MediaPipe's raw box** — MediaPipe's box was sometimes off-center and produced boxes on a collar/shoulder next to a real face. Inside each crop face-api runs `detectAllFaces` and only a detection overlapping *that* MediaPipe box (IoU ≥ `CROP_MATCH_IOU`) counts. The padded crop often includes a neighbour's face, and taking the crop's top-scoring face double-counted the neighbour and lost the edge-cropped person. If nothing matches (even after a permissive 416px retry pass), the MediaPipe box is dropped rather than kept unconfirmed. A final dedupe (`dedupeFaces` in `lib/faceMatching.ts`) treats two faces as one when they have IoU ≥ 0.4, descriptor distance < 0.4, or **containment** ≥ 0.6. Containment is intersection over the smaller box's area. It's needed because a partial-face box nested inside the full-face box has IoU of only ~0.25, and one person showed up as two. The larger box wins a nested pair. The backend's `_nms` in `face_utils.py` applies the same rules (IoU, containment ≥ `CONTAIN_THR`, or cosine ≥ `SAME_FACE_COS` on overlapping boxes). For photos already saved with the bug, the Faces page tombstones the inner box on load (`nestedDuplicateIndices`), skipping manually tagged faces. If MediaPipe fails to load, falls back to face-api.js's own SSD MobileNetV1, then TinyFaceDetector (multi-scale 416+608 with IoU-NMS, no descriptors) as a last resort. Age/gender/expression are loaded as a separate optional model pair and only populated when available.

`detectFacesMediaPipe` runs **both** BlazeFace variants and merges the results (IoU-NMS) rather than picking one — full_range alone misses a face that fills most of the frame (a close-up selfie; its anchor priors are tuned for farther/smaller faces and it'll sometimes lock onto a random small patch elsewhere in the image instead), and short_range alone misses small/far faces in a group shot, so neither is a safe substitute for the other. full_range also always runs once on the whole image first before any tiling — a tile-only pass can miss a face that's large relative to a tile or straddles a tile seam, even though the untiled image shows it fine — and only *adds* tiled passes (800px tiles, 650px stride) on top when the photo is bigger than one tile, for small/far faces a single downscaled pass would lose. `minDetectionConfidence` is 0.4 for both models — 0.3 was tried and reverted after it started flagging shadows/limbs as faces.

**API mode** (backend alive): `app/page.tsx` POSTs to `/analyze`. The backend runs a two-tier pipeline in `backend/utils/face_utils.py`:
- **Tier 1 (InsightFace buffalo_l)**: SCRFD detector at 1280×1280 with tiling for images larger than 1280px (1024px stride, 256px overlap). IoU-based NMS deduplicates tile boundaries. Returns 512-dim ArcFace embeddings (`normed_embedding`, unit length) + age + gender.
- **Tier 2 (SSD+dlib fallback)**: Used only if InsightFace/onnxruntime is not installed. Returns 128-dim dlib descriptors, no age/gender.
- EXIF Orientation is corrected before detection so portrait phone photos are upright — handled implicitly by `cv2.imread`'s own EXIF-aware JPEG decode; an earlier explicit `_apply_exif_rotation` helper was removed as dead code (it was double-rotating on top of OpenCV's built-in handling).
- Backend `/analyze` response includes `ages`, `genders`, `confidences` in addition to `faceBoxes` and `descriptors`.

Result stored in `FacePhoto` with normalized bounding boxes (`x_norm`, `y_norm`, `w_norm`, `h_norm`).

`app/faces/page.tsx` clusters descriptors in the browser (no server involved) via `lib/faceClustering.ts`. The algorithm (`clusterByPerson`) is a greedy nearest-centroid assign, not DBSCAN: photos are processed oldest-first, each face joins the nearest existing cluster if within `MATCH_THRESHOLD` (a fixed constant, `0.55`, tuned empirically — there is intentionally no UI to change it; a previous adjustable slider was removed because it kept resetting/drifting), else seeds a new one. Descriptors of different dimensions are never compared (`euclidean` returns `Infinity`): 128-dim ones (face-api / dlib) use `MATCH_THRESHOLD`, and 512-dim ArcFace ones use `ARCFACE_MATCH_THRESHOLD` (1.05) after `prepDescriptor` L2-normalizes them. That normalization also covers older rows saved with raw, unnormalized embeddings. The same person uploaded once in browser mode and once in API mode ends up in two clusters and has to be merged manually. A cluster's `id` is `${seedPhotoId}_${seedBoxIndex}`. That's stable enough for React keys, but it isn't a persisted identity; naming a cluster turns it into a `people` row (see below). Deleting a photo (single, via a per-photo confirm modal, or all at once via "Clear All") goes through `deletePhotoEverywhere` in `lib/savedUtils.ts` (thin wrapper over `photosApi.deletePhotoEverywhere`), which deletes the `photos` row outright — a deliberate simplification from the old per-view (map vs. faces) independent delete — and any `collab_photos` row this user shared from it, matched by `image_url` (unique per photo). It never matches by filename: camera names like `IMG_1234.jpg` repeat, and the old filename match deleted unrelated photos. `saved_photos` rows cascade automatically via its FK.

**Manual person grouping** (`lib/peopleApi.ts`, `supabase/migrations/0010_face_person_grouping.sql`): since automatic clustering can split one real person into two cards (e.g. a photo's lighting/angle pushes descriptor distance just past `MATCH_THRESHOLD`), a `people` table (`id`, `user_id`, `name`) plus a `photos.person_ids` column (jsonb, index-aligned with `boxes`/`descriptors` — null until a face is manually tagged) let a user override the algorithm; a manual assignment always wins. `buildPersonGroups()` wraps `clusterByPerson()`: faces with a `person_ids[i]` are skipped inside the greedy loop (via a guard added there) and instead assembled into their own "confirmed" groups keyed by `person_id`, so a stray distance match can never pull a tagged face into the wrong auto-cluster. Two entry points write `person_ids`:
- **"🔗 Merge with…"** on each Person card in `app/faces/page.tsx` — picking another card calls `handleMerge`, which reuses either side's existing `person_id` (creating one via `createPerson` if neither has one yet) and batches `updateFacePersonIds` calls (one per affected photo row, preserving that row's other face tags) across every face in both groups. Renaming a confirmed cluster calls `renamePerson`. Renaming an auto-cluster calls `createPerson` and pins its current faces to it via `assignPersonToFaces` (the same helper merge uses), so every name is synced through the DB. On load, any leftover `face-labels-<uid>` localStorage names are migrated this way once, then the key is removed.
- **Upload-time tagging** in `app/page.tsx`'s multi-face save picker (see Home page above) — each selected face thumbnail gets an optional "Who?" `<select>` sourced from `fetchPeople`; a pick is threaded through `saveFacesToAlbum` as `personIds` (index-aligned with the same `indices` used for `boxes`/`descriptors`) so a newly uploaded face can be saved directly into an existing person instead of waiting on auto-clustering to (maybe) group it correctly.

**Linking a person to an account** (migration `0012_people_linked_user.sql`, `people.linked_user_id`): each Person card has a "Link account" picker over the user's followers and following (`handleLink`; linking an auto-cluster first turns it into a `people` row). `NewPostModal` in `app/feed/page.tsx` reads the picked photo's `person_ids` (`fetchPhotoPersonIds`) and offers linked friends as one-tap tag suggestions. `fetchPeople` retries without `linked_user_id` if that column is missing, so an un-run migration only disables linking.

**Photos / Trips buttons** on a Person card open `/albums?photoIds=…&personLabel=…` (plus `&view=trips` for Trips). Albums filters by photo id; the older `?faceNames=` filename filter is still accepted. For a person filter, Albums also pulls in that person's face-only photos (`fetchPhotosByIds`), which aren't map photos, and drops them again when the filter is cleared.

**Per-face removal** (`removeFaceFromPhoto` in `lib/photosApi.ts`, `handleRemoveFace` in `app/faces/page.tsx`) drops one face without deleting the photo. It **tombstones in place** — box zeroed, descriptor set to `[]`, `person_ids[i]` set to null — and never splices. Cluster ids and manual person tags are keyed by array index, so shifting indices would silently reassign other people on the same photo. `isFaceRemoved()` treats an empty descriptor as removed only when the photo has *some* real descriptors (legacy/fallback paths saved all-empty descriptor arrays). Any new code that iterates `boxes`/`descriptors` must skip tombstones the same way.

### Other pages

- **`app/cleanup/page.tsx`** (linked from the Albums header): suggests near-duplicate and blurry photos to delete. Every photo (`fetchEveryPhoto`) is downloaded and analyzed in the browser, four at a time: a 64-bit dHash plus capture-time proximity for similar groups, with the sharpest photo kept and the rest pre-selected; Laplacian variance flags blur. The pure logic and its uncalibrated thresholds live in `lib/photoCleanup.ts`. Deletes go through `deletePhotoEverywhere` behind a confirm modal.
- **`app/saved/page.tsx`**: Grid of photos starred via `toggleSaved`. Downloads are triggered via a temporary `<a>` element against the image URL.
- **`app/stats/page.tsx`**: Aggregated read-only view computed from `fetchAllPhotos`/`getSavedIds` (`lib/photosApi.ts`) on mount. A **"Year in Review"** button renders a Spotify-Wrapped-style share card (`drawYearReviewCard`, see Share cards below) from the same `Stats` object already computed for the page — no extra fetch.
- **`app/profile/page.tsx`**: Reads/writes `profiles` table; validates old password via a re-`signInWithPassword` call before calling `updateUser`.
- **`app/collab/join/page.tsx`**: Accepts an invite code and calls `joinAlbumByCode` (RPC). Redirects to `/collab` on success.

### Albums (`app/albums/page.tsx`)

Photos grouped by location string. Filters:
- **Search bar**: matches filename or location (case-insensitive substring)
- **Date range chips**: All / This Week / This Month / This Year — filters by `captureDate` or `uploadedAt`
- Both filters compose: category → date range → search

**Trips view** (`viewMode === "trips"`, via `detectTrips()`) groups photos into trip cards by date gap, then by GPS cluster (`lib/trips.ts`; dates come from `captureTimestamp` first, see Key shared types). Each trip card has an **"AI Diary"** button — checks Supabase `trip_diaries` for a cached entry first (keyed by `trip_key`, the sorted/comma-joined ids of the trip's photos — stable across reloads and filter changes, unlike `trip.id` which is just an array index) and only POSTs to `/generate-diary` on a cache miss; a successful generation is written back via `saveTripDiary`. `DiaryModal` shows a "Re-generate" button once a diary is loaded, which is the only way to force a fresh API call. The single-photo detail modal (`PhotoModal`) has an **"Identify Landmark"** button — only shown when the photo has no `landmark_analyzed_at` yet; it resizes the image client-side (`resizeImageForApi`, max 1024px) before POSTing to `/recognize-landmark`, then persists the result via `saveLandmarkResult` (`photos.landmark_name`/`landmark_confidence`/`landmark_description`/`landmark_analyzed_at`). Once analyzed, the cached result renders directly from `MapPhoto` with only a small "Re-analyze" link to force another call. Both endpoints are no-ops with an error message if the backend is offline or `GOOGLE_API_KEY` isn't set (the endpoints return `{error: "..."}` for that rather than a 500). The backend also resizes server-side (`_resize_for_api` in `gemini_utils.py`) as a backstop, and logs model/token usage/duration/errors for both calls via the standard `logging` module. `PhotoModal` also has a **"Story"** button rendering an Instagram-story-shaped share card for that one photo (`drawPhotoStoryCard`, see Share cards below).

### Share cards (Canvas API)

`components/ShareCardModal.tsx` is a generic "render a card to a 1080×1920 canvas, then Save or Share it as a PNG" modal — it owns the canvas, the `toBlob`-based download, and the Web Share API call (`navigator.canShare({ files })`, falling back to download when file-sharing isn't supported, e.g. most desktop browsers); callers only supply a `draw(ctx, width, height)` function. `lib/canvasCard.ts` has the drawing helpers both callers share: `loadImage` (sets `crossOrigin: "anonymous"` — required to export the canvas without a tainted-canvas `SecurityError`, which works because Supabase Storage's public buckets serve permissive CORS by default), `drawImageCover` (CSS `object-fit: cover` equivalent), `drawWrappedText`, and `drawPolaroid` (a rotated, white-bordered photo frame with a drop shadow, or a blank placeholder frame when `img` is `null` — e.g. a photo that failed to load via CORS). Two draw functions currently exist: `drawPhotoStoryCard` (`app/albums/page.tsx`, one photo + its location/date) and `drawYearReviewCard` (`app/stats/page.tsx`, a scattered polaroid collage of up to 5 recent photos — laid out via the fixed `COLLAGE_LAYOUT` offsets, sliced from the tail so the centered "hero" photo is always kept when fewer are available — above the year's aggregate `Stats`: total photos, places visited, faces detected, top destination). Both are plain async functions, not components — `ShareCardModal` awaits whichever one is passed in.

### Notifications (`lib/notificationUtils.ts`)

Real-time notifications via Supabase Realtime. `subscribeToNotifications(userId, onNew)` opens a postgres_changes channel filtered to `user_id`. The `NotificationBell` component polls on mount and subscribes for live inserts. Notification types: `share_viewed`, `collab_joined`, `collab_photo_added`, plus the social types listed under Social feed.

### Collaborative albums (`lib/collabUtils.ts`, `app/collab/page.tsx`)

Users create shared albums with an invite code. Others join via `joinAlbumByCode` (calls `join_collab_album` RPC). Roles: owner / contributor / viewer. Photos are uploaded to the `collab-photos` storage bucket and stored in `collab_photos` table. Individual album detail pages live at `/collab/[id]`.

### Sharing (`lib/shareUtils.ts`, `lib/tripShareUtils.ts`)

**Whole trips**: the Share button on an Albums trip card calls `shareTrip`, which inserts a `trip_shares` row: a snapshot of the photos (sorted chronologically, inline-base64 ones skipped), locations, date range, and the cached AI diary if one exists (it never generates one). `/trip/[id]` is public and renders a route map (`components/TripRouteMap.tsx`, loaded via `next/dynamic` with `ssr: false`), the diary, and the photos.

**Single photos**:

`sharePhoto(photo)` uploads the base64 image to the `shares` storage bucket, inserts a row into `shares`, and returns a public URL (`/share/[id]`). The share page is public (no auth required). Views are tracked via the `record_share_view` RPC.

### Social feed (`app/feed/page.tsx`, `lib/socialUtils.ts`)

A simple follow/feed/like layer, additive on top of the existing schema (new tables only — doesn't touch `photos` RLS). `posts` stores a **denormalized snapshot** of a photo (`image_url`/`caption`/`location`/`capture_date`) taken at post time via `createPost`, rather than a live FK into `photos` — so reading a followed user's feed never needs cross-user SELECT access to their `photos` rows. `posts.user_id` also has no FK into `profiles` (a user can post before a `profiles` row exists for them, since that row is otherwise lazily created on first `/profile` visit — see `app/profile/page.tsx`), so `fetchFeed` joins author names in client-side from a separate `profiles` query and falls back to "Traveler" for anyone missing one; `ensureProfile` is called on `/feed` load to backfill the current user's own row.

- **Follow**: `follows` (`follower_id`, `following_id`) — `followUser`/`unfollowUser`/`getFollowingIds`/`getFollowCounts`. Finding people to follow is a name search over `profiles` (`searchProfiles`, `ilike`), which needed a wider-than-"own row only" RLS select policy on `profiles` (added permissively in the same migration — Postgres OR's multiple permissive SELECT policies together, so this can only widen access).
- **Post**: `posts` — created from one of the current user's own map photos via the "Post" button's `NewPostModal` (a simple picker over `fetchMapPhotos`, not a new upload flow). RLS: visible to the author or anyone following them.
- **Like**: `post_likes` (`post_id`, `user_id`) — `toggleLike`; `fetchFeed` resolves counts and "did I like this" in two follow-up queries across all visible posts rather than per-post, to avoid N+1 queries.
- **Comment**: `post_comments` (`post_id`, `user_id`, `content`, `parent_comment_id`) — same visibility RLS as `post_likes` (author or a follower can read). `fetchComments`/`addComment`/`deleteComment`. Comments load lazily per post (only once its panel is expanded in the feed UI), not batched into `fetchFeed` — only `commentCount` is batched there, same N+1-avoidance pattern as like counts. `components/CommentThread.tsx` is a self-contained comment section (fetches its own comments, owns add/reply/like/delete) used by both `app/feed/page.tsx` (mounted only while a post's panel is expanded) and `app/post/[id]/page.tsx` (always mounted) — neither page duplicates comment state. Replies are one level deep only (`parent_comment_id`, set via `addComment(uid, postId, content, parentCommentId)`) — a reply can't itself be replied to, same flat-thread model Instagram/Facebook use. Comments can also be liked (`comment_likes` table, `toggleCommentLike`) — same `toggleLike`-shaped API as post likes.
- **Repost**: `createRepost` inserts a normal `posts` row owned by the reposter with `repost_of` (the original post's id) and a denormalized `original_author_name` — no new RLS policy needed since it's visible via the same "own or followed" rule as any post. Reposting a repost points `repost_of` at the *original*, not the repost, so reposts never chain. `on delete set null` (not cascade) on `repost_of`, so a repost survives the source post being deleted, consistent with posts already being snapshots rather than live references.
- **Share**: reuses `sharePhoto` (`lib/shareUtils.ts`) rather than a feed-specific mechanism — a post's `image_url` is already a public Storage URL, so `sharePhoto` skips re-uploading and just creates a `shares` row + `/share/[id]` link, same as sharing a photo from Albums. Falls back to clipboard copy when `navigator.share` isn't available.
- **Tag**: `post_tags` (`post_id`, `tagged_user_id`) — an explicit "tag people" picker in `NewPostModal` at post time, **not** free-text `@mention` parsing (`profiles.name` can contain spaces, e.g. "Jeong min", which makes parsing ambiguous without a separate single-token username field this app doesn't have). Tagging someone writes a notification for *them*, which a plain client insert can't do under RLS (every table here only allows inserting your own rows) — `tag_user_in_post(p_post_id, p_tagged_user_id)` is a `SECURITY DEFINER` RPC (same pattern as `join_collab_album`/`record_share_view`) that validates the caller owns the post, then inserts the tag and the `notifications` row (type `tagged_in_post`) together. Untagging is a plain delete (the post-owner-only RLS delete policy already covers it, no RPC needed). `fetchFeed` batches tagged users per post the same way it batches likes/comments.

Profile pictures (`profiles.avatar_url`) reuse the existing `user-photos` Storage bucket rather than a new one — `app/profile/page.tsx` uploads to `<uid>/avatar-<timestamp>.jpg` (a fresh filename per upload, not a fixed path with `upsert`, so it only ever needs the same insert-your-own-path Storage permission photo uploads already use). `Avatar` (in `app/feed/page.tsx`) renders the image when present, falling back to initials.

The "N following · N followers" counts on `/feed` are clickable, opening `FollowListModal` (`fetchFollowingProfiles`/`fetchFollowerProfiles` in `lib/socialUtils.ts`) with a Follow/Unfollow toggle per person, reusing the same `handleFollowToggle` as the search results. `searchProfiles` strips a leading `@` before matching against `profiles.name` — people type Instagram-style `@name` out of habit, but names are never stored with one.

**Viewing someone else's profile**: `app/u/[id]/page.tsx` — avatar, name, follower/following counts, a Follow/Unfollow button, and a post grid, reachable by clicking any avatar/name in the feed (post header), search results, or `FollowListModal` (all now wrapped in a `Link` to `/u/[id]`). Their posts only render if you already follow them (or it's your own profile) — `fetchUserPosts` runs the exact same query+RLS as the main feed, just filtered to one author, so it naturally comes back empty for someone you don't follow; the page shows a "Follow to see their posts" placeholder in that case rather than a silently-empty grid. `Avatar`/`initials` were extracted to `components/Avatar.tsx` once a second page needed them (previously local to `app/feed/page.tsx`).

**Engagement notifications**: liking or commenting on a post notifies its author (`notifications` type `post_liked`/`post_commented`) — via `AFTER INSERT` triggers on `post_likes`/`post_comments` (`notify_post_like`/`notify_post_comment` in `0008_engagement_notifications.sql`), not client code, so it fires regardless of which call site does the insert. Liking a comment or replying to one similarly notify that comment's author (`comment_liked`/`comment_replied`, via `notify_comment_like`/`notify_comment_reply` in `0009_comment_likes_and_replies.sql`) — a reply still separately triggers the post-level `notify_post_comment` too, so the post owner always hears about new comments even when a reply's notification instead goes to whoever it replied to. All these triggers (like `tag_user_in_post`) are `SECURITY DEFINER`, since `notifications` RLS only allows inserting your own rows and these need to insert one for the *other* user; all skip self-notifications. `NotificationBell`'s `TYPE_ICON`/`ACTION_TEXT` maps cover `post_liked`/`post_commented`/`tagged_in_post`/`comment_liked`/`comment_replied`, falling back to 🔔 for anything unmapped. For all of these the row renders two separate (non-nested) links: `data.from_user_id` resolved via `profilesByIds` links to `/u/[id]`, and — since `data.post_id` is stored by the same trigger/RPC — the action text ("liked your post" etc.) links to `/post/[id]`, so a notification answers both "who" and "which post/comment".

Tagged users under a post caption (`post.taggedUsers`) and deleting a feed post both follow the same conventions used elsewhere: names link to `/u/[id]`, and delete goes through a confirm/cancel modal (`DeletePostConfirmModal`) rather than deleting on click, mirroring `DeleteConfirmModal` in `app/albums/page.tsx`.

**Post detail page**: `app/post/[id]/page.tsx` — a single post (via `fetchPostById` in `lib/socialUtils.ts`, which reuses the same `enrichPosts` batching as the feed) with its full comment thread always expanded, like/comment/delete. Reached from a post's image in the feed, a post grid tile on `/u/[id]`, or a notification's action text. RLS applies exactly as in the feed ("own or followed"), so `fetchPostById` returning `null` — rendered as a "not available" placeholder — covers both a deleted post and one you're not allowed to see (e.g. tagged by someone you don't follow).

**In-app "Send"** (`components/ShareToModal.tsx`, `sharePostToUser` in `lib/socialUtils.ts`, migration `0011_share_post_to_user.sql`) sits alongside the public-link share. It sends a post to someone you follow or who follows you through the `share_post_to_user` `SECURITY DEFINER` RPC, which checks that the caller can see the post and inserts a `post_shared` notification for the recipient. There is no DM/inbox table; the notification *is* the delivery.

### Backend (optional)

`backend/main.py` is a FastAPI server. The frontend polls `GET /health` on load; if it responds the app enters "API mode" (server-side EXIF+face via `/analyze`, POI lookup via `/nearby-places`). If offline, falls back to browser-mode. **Not required** for any core functionality. `/health`'s response includes `utils_available`, `places_available`, `gemini_available` — each backend feature degrades independently (missing deps or an unset `GOOGLE_API_KEY` return a JSON `error` field from that endpoint rather than a 500).

Key backend files:
- `backend/utils/face_utils.py` — two-tier face pipeline (InsightFace Tier 1, SSD+dlib Tier 2) used by `/analyze`. InsightFace downloads `buffalo_l` (~200 MB) to `~/.insightface/models/buffalo_l/` on first run. Also has an unused `detect_faces_multi()` / MediaPipe detector path (pinned to `mediapipe==0.10.21` — 1.0.x crashes the process on macOS) not wired to any endpoint, kept for future backend-side experimentation — not the same MediaPipe as the browser detector below.
- `backend/utils/exif_utils.py` — EXIF extraction + reverse geocoding
- `backend/utils/places_utils.py` — Overpass API for nearby POIs
- `backend/utils/gemini_utils.py` — Gemini API wrappers (`google-genai` SDK, free tier, chosen over Claude to avoid per-call billing) behind `/generate-diary` (photo metadata → short first-person travel diary) and `/recognize-landmark` (photo → landmark JSON validated into the Pydantic `LandmarkResult`). Calls go down `MODEL_CHAIN` via `_generate_with_fallback`: `gemini-3.5-flash` with `thinking_level="minimal"` first (~2–3s), then flash-lite models. A 429/5xx/504 or the 15s per-call timeout moves straight on to the next model rather than retrying the overloaded one; the old single flash-lite model took 20–110s. **Don't pass `response_schema`**: with it, 3.5-flash stalled past 90s on a request it answers in ~3s as plain JSON mode. `thinking_level` values are model-specific (flash-lite and newer flashes reject `minimal`). Both endpoints need `GOOGLE_API_KEY` and return `friendly_error()` text on failure. Called from `app/albums/page.tsx` (Trips view "AI Diary" button, photo modal "Identify Landmark" button).

To install InsightFace tier: `pip install insightface onnxruntime` (already in `backend/requirements.txt`).

### Key shared types

`lib/types.ts` — `MapPhoto` (`lat?`/`lng?` are optional; photos without GPS still appear in Albums but are filtered out of the map) and `FacePhoto`. `rowToMapPhoto` / `rowToFacePhoto` convert a `public.photos` row into each — that table is a *single unified table* (one row can be a map photo, a face photo, or both, via `is_map_photo`/`is_face_photo` booleans), not a `photos`/`face_photos` split; a `saved_photos` join table backs favorites. `image_url` is stored directly on the row as the full Storage public URL (bucket `user-photos`) — there's no separate path column. `photos` also carries `landmark_name`/`landmark_confidence`/`landmark_description`/`landmark_analyzed_at` (nullable — presence of `landmark_analyzed_at` is what gates whether `/recognize-landmark` gets called again for that photo). Before writing any new migration against `photos`/`saved_photos`, check the live schema in the Supabase dashboard (Table Editor) rather than assuming — an earlier session drafted a competing two-table schema without checking first and had to throw it away.

`MapPhoto.captureTimestamp` is an ISO 8601 string populated alongside the display-only `captureDate`/`captureTime` (which are locale-formatted via `toLocaleDateString()`/`toLocaleTimeString()` and are **not** safe to sort or compare). A missing date is stored as the sentinel `"Not available"`, or `"날짜 없음"` on older rows. Check for both. Anything that needs chronological order — e.g. the map's route line — must sort by `captureTimestamp` (falling back to `uploadedAt` for photos saved before this field existed), never by `captureDate`.

`lib/photosApi.ts` is the only place that talks to the `photos`/`saved_photos` tables — `fetchMapPhotos`/`fetchFacePhotos`/`fetchAllPhotos` (filter+convert), `fetchSavedIds`/`toggleSavedPhoto`, `upsertPhoto` (insert-or-update by id; only the columns present in the input are written, so a partial update never clobbers unrelated columns already on the row — e.g. adding `is_map_photo: true` to an existing face-only row doesn't touch its `boxes`/`descriptors`), `renamePhoto`, `deletePhotoEverywhere` (the delete uses `.select("id")` to confirm a row was actually removed and throws if RLS silently matched zero rows, rather than reporting success on a no-op delete; callers in `app/albums/page.tsx`/`app/faces/page.tsx` catch this and surface an alert instead of updating local state as if it succeeded). `lib/savedUtils.ts` (`toggleSaved`/`getSavedIds`/`deletePhotoEverywhere`) is a thin per-caller wrapper that resolves the current user id and delegates to `photosApi` — pages import from `savedUtils`, not `photosApi`, for those three. Unauthenticated/guest sessions get empty results everywhere rather than an error (in practice unreachable — `AuthGuard` requires login on every page that calls these).

### Map (`app/map/page.tsx`)

Uses `react-leaflet` with OpenStreetMap tiles (free, no API key). Leaflet default icons overridden with `L.divIcon` showing a circular photo thumbnail + count badge for clustered markers. Loaded client-side only (Leaflet requires `window`). Only photos with `lat` and `lng` defined are shown.

A **Pins / Regions** toggle (`viewMode`) switches between the Leaflet map and `components/KoreaRegionMap.tsx`, an SVG choropleth of South Korea's 17 provinces. It uses no Leaflet: `lib/koreaGeo.ts` projects `public/data/skorea-provinces.geo.json` itself and maps each photo's reverse-geocoded `location` string to a province via `matchRegionCode`. Clicking a province filters the photo list below.

In Pins view there are two optional overlay toggles, mutually exclusive with the marker view when heatmap is on:
- **Route**: a `RouteLayer` component draws photos as a Polyline in chronological order (sorted by `captureTimestamp`, see above) — a white casing line for contrast against any tile color, an animated flowing dashed line on top (`route-flow-line` keyframe in `app/globals.css`), and a rotated arrow `Marker` at each segment midpoint (bearing computed via `bearingDeg()`) showing travel direction.
- **Heatmap**: `HeatmapLayer` wraps the `leaflet.heat` plugin (`L.heatLayer`, imperatively added/removed via `useMap()` + `useEffect` since it has no react-leaflet component) — replaces the cluster markers while active.

### Metadata / Viewport

`app/layout.tsx` exports two named constants — `metadata` (title, description, appleWebApp) and `viewport` (themeColor). Next.js App Router requires `themeColor` in the `viewport` export, **not** inside `metadata`. Putting it in `metadata` produces a build warning.
