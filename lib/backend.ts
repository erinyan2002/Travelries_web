// Base URL of the optional FastAPI backend (backend/main.py). Set
// NEXT_PUBLIC_BACKEND_URL (e.g. in Vercel's env settings) to a deployed backend.
// NEXT_PUBLIC_* is inlined at build time: redeploy after changing it.
//
// Without it, the backend is assumed to run on the same machine that served
// the page, port 8000 — so the desktop (localhost) and a phone on the same
// Wi-Fi (http://192.168.x.x:3000 → :8000) both find it. A deployed https site
// without the variable just falls back to browser mode.
const fromEnv = process.env.NEXT_PUBLIC_BACKEND_URL;
const sameHost = typeof window !== "undefined" ? `http://${window.location.hostname}:8000` : "http://localhost:8000";

export const BACKEND_URL = (fromEnv || sameHost).replace(/\/+$/, "");
