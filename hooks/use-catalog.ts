'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
export function useCatalog<T>(
  kind: 'jobs' | 'candidates',
  filters: unknown,
  role: string,
  page: number,
  scope: string,
  revision: unknown,
) {
  const [loadedSignature, setLoadedSignature] = useState('');
  const router = useRouter();
  const signature = JSON.stringify({ filters, role, page, scope });
  const previousRequest = useRef<{ query: unknown; other: string } | null>(null);
  const [data, setData] = useState<{
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    relaxations?: { skill: string; total: number; added: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    const parsed = JSON.parse(signature);
    const { query: textQuery, ...otherFilters } = parsed.filters ?? {};
    const other = JSON.stringify({ kind, role, page, scope: parsed.scope, filters: otherFilters });
    const previous = previousRequest.current;
    // Only typing waits for more input. Initial load, pagination and filter
    // buttons start immediately; cancellation still protects against stale data.
    const delay = previous && previous.other === other && previous.query !== textQuery ? 250 : 0;
    previousRequest.current = { query: textQuery, other };
    const controller = new AbortController();
    let alive = true;
    // Keep current cards during a refresh. Abort old requests when filters change.
    const startTimer = setTimeout(() => {
      setLoading(true);
      setError('');
    }, 0);
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({
          ...JSON.parse(signature),
          filters: JSON.stringify(JSON.parse(signature).filters),
          page: String(page),
        });
        const r = await fetch(`/api/catalog/${kind}?${query}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (r.status === 401) {
          router.push(`/login?role=${role}`);
          return;
        }
        const b = await r.json();
        if (!r.ok) throw new Error(b.error || 'Не удалось загрузить каталог');
        if (alive) {
          setLoadedSignature(signature);
          setData(b);
        }
      } catch (e) {
        if (alive && (e as Error).name !== 'AbortError')
          setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }, delay);
    return () => {
      alive = false;
      clearTimeout(startTimer);
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, signature, revision, page, role, router]);
  return {
    data,
    loading,
    error,
    isCurrentData: loadedSignature === signature && !loading,
    dismissError: () => setError(''),
  };
}
export function catalogPages(page: number, total: number) {
  const pages = new Set([1, total, page - 1, page, page + 1]);
  return [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
}
