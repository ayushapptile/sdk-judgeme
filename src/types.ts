/**
 * `@tiledev/sdk-judgeme` — the types.
 *
 * Exposed on the `./types` subpath so a consumer can import only the shapes without pulling the
 * client or React in. Everything here is the SDK's OWN vocabulary, not Judge.me's wire shape — the
 * client normalises `product_external_id`, `reviewer.name`, the `verified-purchase` string and the
 * nested picture urls into the flat, camelCase forms below, so a screen never touches the raw API.
 */

/** How to reach Judge.me. Injected once via `configureJudgeMe`; nothing app-specific leaks in. */
export interface JudgeMeConfig {
  /** `*.myshopify.com` — the store the reviews belong to. */
  shopDomain: string;
  /**
   * The Judge.me **public** API token. Safe in a client bundle by design — it only authorises the
   * public read endpoints (product lookup, published reviews). It is NOT a private/admin token.
   */
  apiToken: string;
  /**
   * API root. Defaults to Judge.me direct (`https://judge.me/api/v1`). Point it at a proxy
   * (e.g. an apptile `judge-me-proxy`) when the token must stay server-side or a web build needs CORS.
   */
  baseUrl?: string;
  /**
   * `fetch` to use. Defaults to the global one (React Native and modern web both have it). Injectable
   * so tests and non-standard runtimes can pass their own — the SDK imports no HTTP library.
   */
  fetch?: typeof fetch;
}

/** A Judge.me product record. `id` is Judge.me's internal id and is what keys the reviews query. */
export interface JudgeMeProduct {
  /** Judge.me internal product id — pass to `listProductReviews`. */
  id: number;
  /** The Shopify product id. */
  externalId: number;
  title: string;
  handle: string;
}

/** One review photo, in Judge.me's rendition sizes. `huge` is absent on some uploads. */
export interface ReviewPicture {
  original: string;
  small: string;
  compact: string;
  huge: string | null;
}

/** One published review, flattened. */
export interface JudgeMeReview {
  id: number;
  /** Often null — Judge.me reviews frequently have a body and no title. */
  title: string | null;
  body: string;
  /** 1–5. */
  rating: number;
  reviewerName: string;
  /** True when Judge.me marked it `verified-purchase`. */
  verified: boolean;
  /** ISO-8601. */
  createdAt: string;
  pictures: ReviewPicture[];
}

/** One page of reviews. `hasNextPage` is inferred — Judge.me returns no total. */
export interface ReviewsPage {
  reviews: JudgeMeReview[];
  page: number;
  perPage: number;
  /** A full page came back, so there may be more; an under-full page is the last one. */
  hasNextPage: boolean;
}

/** The star-rating summary for a product — the figure a PDP shows above the list. */
export interface ReviewSummary {
  /** 0 when there are no reviews. */
  averageRating: number;
  reviewCount: number;
}

/**
 * A new review to submit. Judge.me matches the product by its Shopify id (`productId`) and/or `url`,
 * creating the product record if it has never seen it — so a product with no prior reviews is still
 * reviewable. The review lands pending moderation (unpublished) until the merchant approves it, which
 * is why it will not immediately appear in `listProductReviews` (that returns published only).
 */
export interface JudgeMeReviewInput {
  /** The Shopify product id (the numeric external id, not the gid). */
  productId: number;
  /** The product's storefront URL — helps Judge.me attach the review and link back. */
  productUrl?: string;
  /** 1–5. */
  rating: number;
  reviewerName: string;
  reviewerEmail: string;
  title?: string;
  body: string;
}
