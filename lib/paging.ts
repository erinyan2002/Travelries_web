// Supabase (PostgREST) returns at most 1,000 rows per request, the project's API
// "Max rows". A plain select of a user's photos stopped at 1,000: newer photos past
// that vanished from Albums, Map and People, "Delete all photos" left the rest, and
// pruneOrphanPeople, seeing only some photos' tags, could delete people still in use.
// This pages through with .range() until a page comes back short.
export const PAGE_SIZE = 1000;

type Page<R> = PromiseLike<{ data: R[] | null; error: { message: string } | null }>;

/** `page(from, to)` = the same query with `.range(from, to)` and a stable `.order(...)`. */
export async function selectAllPages<R>(page: (from: number, to: number) => Page<R>, pageSize = PAGE_SIZE): Promise<{ data: R[]; error: { message: string } | null }> {
  const all: R[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: all, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
}
