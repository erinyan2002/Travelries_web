// "5m ago" / "5분 전" for posts and comments; `t` is useLang().t.
export function timeAgo(iso: string, t: (en: string, vars?: Record<string, string | number>) => string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t("just now");
  if (mins < 60) return t("{n}m ago", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("{n}h ago", { n: hours });
  return t("{n}d ago", { n: Math.floor(hours / 24) });
}
