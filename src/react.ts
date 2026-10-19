/**
 * `@tiledev/sdk-judgeme` — the React binding.
 *
 * Thin by design: the fetching lives in `JudgeMeClient`; this only subscribes a component to it and
 * owns the paging state. Pass the client from `configureJudgeMe` (or `getJudgeMeClient()`); `null` is
 * accepted so a screen can render before the SDK is configured without a conditional hook.
 *
 * One mount does the two first reads together — the product (to get the id reviews are keyed by) and
 * the summary — then the first page of reviews. `loadMore` appends; `reload` starts over. Every async
 * result is gated on a request id so a handle that changes mid-flight cannot land stale rows.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { JudgeMeClient } from "./client";
import type { JudgeMeReview, ReviewSummary } from "./types";

export interface UseJudgeMeReviews {
  /** Average rating + count, or null until the first load settles. */
  summary: ReviewSummary | null;
  reviews: JudgeMeReview[];
  /** True during the first load and during a `loadMore`. */
  loading: boolean;
  error: Error | null;
  hasNextPage: boolean;
  /** Append the next page. No-op while loading, at the end, or before the product resolved. */
  loadMore: () => void;
  /** Re-run from page one — for pull-to-refresh or a handle change. */
  reload: () => void;
}

export function useJudgeMeReviews(
  client: JudgeMeClient | null,
  handle: string | null | undefined,
  opts?: { perPage?: number }
): UseJudgeMeReviews {
  const perPage = opts?.perPage ?? 20;

  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [reviews, setReviews] = useState<JudgeMeReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);

  const page = useRef(1);
  /** Guards against an out-of-order resolve landing under a newer load. */
  const reqId = useRef(0);

  const loadFirst = useCallback(async () => {
    const id = ++reqId.current;
    if (!client || !handle) {
      setReviews([]);
      setSummary(null);
      setHasNextPage(false);
      return;
    }
    setLoading(true);
    setError(null);
    page.current = 1;
    try {
      // One widget read returns the summary and the first page of reviews together.
      const first = await client.getProductReviews(handle, { page: 1, perPage });
      if (reqId.current !== id) return;
      setSummary(first.summary);
      setReviews(first.reviews);
      setHasNextPage(first.hasNextPage);
    } catch (caught) {
      if (reqId.current === id) setError(caught as Error);
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  }, [client, handle, perPage]);

  const loadMore = useCallback(async () => {
    if (!client || !handle || loading || !hasNextPage) return;
    const id = ++reqId.current;
    setLoading(true);
    try {
      const next = page.current + 1;
      const pageData = await client.getProductReviews(handle, { page: next, perPage });
      if (reqId.current !== id) return;
      page.current = next;
      setReviews((current) => [...current, ...pageData.reviews]);
      setHasNextPage(pageData.hasNextPage);
    } catch (caught) {
      if (reqId.current === id) setError(caught as Error);
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  }, [client, handle, loading, hasNextPage, perPage]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  return { summary, reviews, loading, error, hasNextPage, loadMore, reload: loadFirst };
}
