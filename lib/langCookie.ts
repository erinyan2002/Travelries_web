// The UI language cookie, shared by the server layout and the client provider.
// Kept out of lib/i18n.tsx: that file is "use client", and a value imported from
// it into a server component is a client reference, not the string.
export const LANG_COOKIE = "lang";
export type Lang = "en" | "ko";
