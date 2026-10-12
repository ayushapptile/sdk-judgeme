/**
 * `@tiledev/sdk-judgeme` — the framework-agnostic client.
 *
 * No React here, and no HTTP library — just `fetch` and the three public Judge.me read endpoints,
 * verified against the live API:
 *
 *   getProduct(handle)           GET /products/-1?handle=…        → { product: { id, external_id, … } }
 *   listProductReviews(id, …)    GET /reviews?product_id=…&…      → { current_page, per_page, reviews:[…] }
 *   getProductSummary(handle)    GET /widgets/product_review?…    → { widget: "<div data-average-rating=…>" }
 *
 * The reviews endpoint returns no total, so "is there another page" is inferred from whether a FULL
 * page came back. The summary endpoint returns an HTML widget; the two figures a PDP needs
 * (`data-average-rating`, `data-number-of-reviews`) are read off its attributes rather than rendering it.
 *
 * `configureJudgeMe` stores a singleton the React hook reads, mirroring the other `@tiledev/sdk-*`
 * packages (`configureCartHold`, `configureTileCredit`): one instance, one place the token lives.
 */
import type {
  JudgeMeConfig,
  JudgeMeProduct,
  JudgeMeReview,
  JudgeMeReviewInput,
  ReviewSummary,
  ReviewsPage,
} from "./types";

const DEFAULT_BASE_URL = "https://judge.me/api/v1";
const DEFAULT_PER_PAGE = 20;

/** The raw Judge.me review shape — internal; `normaliseReview` maps it to `JudgeMeReview`. */
interface RawReview {
  id: number;
  title: string | null;
  body: string | null;
  rating: number | null;
  reviewer?: { name?: string | null } | null;
  verified?: string | null;
  created_at: string;
  published?: boolean;
  hidden?: boolean;
  pictures?: { urls?: { original: string; small: string; compact: string; huge?: string | null } }[];
}

export class JudgeMeClient {
  private readonly config: JudgeMeConfig;
  private readonly doFetch: typeof fetch;

  constructor(config: JudgeMeConfig) {
    this.config = config;
    const injected = config.fetch ?? (typeof fetch !== "undefined" ? fetch : undefined);
    if (!injected) {
      throw new Error("@tiledev/sdk-judgeme: no global fetch — pass `fetch` in the config.");
    }
    // Bind so a runtime that dislikes an unbound global fetch (some polyfills) does not throw.
    this.doFetch = injected.bind(globalThis);
  }

  private base(): string {
    return (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  /** The two credentials every public endpoint takes, query-encoded. */
  private auth(): string {
    const token = encodeURIComponent(this.config.apiToken);
    const shop = encodeURIComponent(this.config.shopDomain);
    return `api_token=${token}&shop_domain=${shop}`;
  }

  private async getJson(path: string): Promise<any> {
    const res = await this.doFetch(`${this.base()}${path}`);
    if (!res.ok) {
      throw new Error(`@tiledev/sdk-judgeme: ${path.split("?")[0]} responded ${res.status}`);
    }
    return res.json();
  }

  /**
   * Resolve a Shopify product handle to its Judge.me product. `null` when Judge.me has no record for
   * the handle (an unsynced product) — the caller shows no reviews rather than an error.
   */
  async getProduct(handle: string): Promise<JudgeMeProduct | null> {
    const body = await this.getJson(`/products/-1?${this.auth()}&handle=${encodeURIComponent(handle)}`);
    const p = body?.product;
    if (!p || typeof p.id !== "number") return null;
    return { id: p.id, externalId: p.external_id, title: p.title, handle: p.handle };
  }

  /**
   * One page of a product's reviews, newest first (Judge.me's default order). Only shopper-visible
   * ones — `published && !hidden` — reach the result; a review held in moderation is not shown.
   *
   * Pass the Judge.me product id from `getProduct`, NOT the Shopify id.
   */
  async listProductReviews(
    productId: number,
    opts?: { page?: number; perPage?: number }
  ): Promise<ReviewsPage> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? DEFAULT_PER_PAGE;
    const body = await this.getJson(
      `/reviews?${this.auth()}&product_id=${productId}&per_page=${perPage}&page=${page}`
    );
    const raw: RawReview[] = Array.isArray(body?.reviews) ? body.reviews : [];
    const reviews = raw
      .filter((r) => r.published !== false && r.hidden !== true)
      .map(normaliseReview);
    return {
      reviews,
      page,
      perPage,
      // No total in the response; a full page MIGHT have more, an under-full page is the last.
      hasNextPage: raw.length === perPage,
    };
  }

  /**
   * Submit a review. Resolves once Judge.me has accepted it — the review is then **pending
   * moderation** (unpublished) until the merchant approves it, so it will not show up in
   * `listProductReviews` right away. Rejects on a non-2xx response.
   *
   * The port of the legacy `postProductReview`: `platform: "shopify"`, the product keyed by its
   * Shopify id and url, the reviewer's name/email and the rating/title/body.
   */
  async createReview(input: JudgeMeReviewInput): Promise<void> {
    const body = {
      api_token: this.config.apiToken,
      shop_domain: this.config.shopDomain,
      platform: "shopify",
      id: input.productId,
      url: input.productUrl ?? "",
      name: input.reviewerName,
      email: input.reviewerEmail,
      rating: input.rating,
      title: input.title ?? "",
      body: input.body,
    };
    const res = await this.doFetch(`${this.base()}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`@tiledev/sdk-judgeme: createReview responded ${res.status}`);
    }
  }

  /**
   * The rating summary — average stars and review count — read off the product-review widget's
   * data attributes. Degrades to zeroes on a product Judge.me has never seen.
   */
  async getProductSummary(handle: string): Promise<ReviewSummary> {
    const body = await this.getJson(
      `/widgets/product_review?${this.auth()}&handle=${encodeURIComponent(handle)}`
    );
    const html = String(body?.widget ?? "");
    const average = Number(html.match(/data-average-rating=['"]([\d.]+)['"]/)?.[1] ?? 0);
    const count = Number(html.match(/data-number-of-reviews=['"](\d+)['"]/)?.[1] ?? 0);
    return {
      averageRating: Number.isFinite(average) ? average : 0,
      reviewCount: Number.isFinite(count) ? count : 0,
    };
  }
}

/** Raw → flat, camelCase, every field defaulted so a malformed row cannot crash a list. */
function normaliseReview(r: RawReview): JudgeMeReview {
  return {
    id: r.id,
    title: r.title ?? null,
    body: r.body ?? "",
    rating: r.rating ?? 0,
    reviewerName: r.reviewer?.name ?? "Anonymous",
    verified: r.verified === "verified-purchase",
    createdAt: r.created_at,
    pictures: (r.pictures ?? [])
      .filter((p) => p?.urls)
      .map((p) => ({
        original: p.urls!.original,
        small: p.urls!.small,
        compact: p.urls!.compact,
        huge: p.urls!.huge ?? null,
      })),
  };
}

// ── The configured singleton ──────────────────────────────────────────────────────────────────────

let client: JudgeMeClient | null = null;

/** Create the client and store it for `getJudgeMeClient` / `useJudgeMeReviews`. Returns it too. */
export function configureJudgeMe(config: JudgeMeConfig): JudgeMeClient {
  client = new JudgeMeClient(config);
  return client;
}

/** The configured client, or null before `configureJudgeMe` has run. */
export function getJudgeMeClient(): JudgeMeClient | null {
  return client;
}
