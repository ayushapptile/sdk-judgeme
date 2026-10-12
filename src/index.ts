/**
 * `@tiledev/sdk-judgeme` — Judge.me product reviews for Tile apps.
 *
 * Framework-agnostic client + a React hook, so the review logic is written once and dropped into any
 * app. Same shape as the other `@tiledev/sdk-*` packages: `configure…` makes a singleton, a `use…`
 * hook reads it.
 *
 * ```ts
 * import { configureJudgeMe, useJudgeMeReviews } from "@tiledev/sdk-judgeme";
 *
 * const judgeMe = configureJudgeMe({
 *   shopDomain: "yek2dq-xe.myshopify.com",
 *   apiToken: "…public token…",
 *   // baseUrl: "https://api.apptile.io/judge-me-proxy/",  // optional proxy
 * });
 *
 * // In the PDP:
 * const { summary, reviews, loading, hasNextPage, loadMore } = useJudgeMeReviews(judgeMe, product.handle);
 * ```
 *
 * The React hook ships from this main entry (not only a `./react` subpath) so every resolver agrees on
 * one import; the cost is that importing this pulls in `react`.
 */
export { JudgeMeClient, configureJudgeMe, getJudgeMeClient } from "./client";
export { useJudgeMeReviews } from "./react";
export type { UseJudgeMeReviews } from "./react";
export type * from "./types";
