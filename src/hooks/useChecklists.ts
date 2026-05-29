import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_LINES, type LineCard } from "@/data/lines";
import { fetchChecklists, saveChecklists } from "@/lib/api";

const KEY = ["checklists"];

// Loads the editable checklist set from the backend. On first run (empty store)
// it seeds the backend with the bundled DEFAULT_LINES. While loading — or if the
// backend is unreachable — callers fall back to DEFAULT_LINES so the checklists
// always render.
export function useChecklists() {
  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<LineCard[]> => {
      const data = await fetchChecklists();
      if (!Array.isArray(data) || data.length === 0) {
        await saveChecklists(DEFAULT_LINES);
        return DEFAULT_LINES;
      }
      return data;
    },
    staleTime: 60_000,
  });

  const lines = query.data ?? DEFAULT_LINES;
  const getLine = (id?: string) => (id ? lines.find((l) => l.id === id) : undefined);
  return { ...query, lines, getLine };
}

export function useSaveChecklists() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lines: LineCard[]) => saveChecklists(lines),
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}
