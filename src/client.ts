/**
 * `@tiledev/sdk-judgeme` — the framework-agnostic client.
 *
 * No React here, and no HTTP library — just `fetch`. Reads run entirely off Judge.me's **public**
 * product-review widget, which is the only reviews surface the PUBLIC (widget) API token can reach:
 *
 *   getProductReviews(handle, …)  GET /widgets/product_review?handle=…&per_page=…
 *                                   → { widget: "<div class='jdgm-rev-widg' …>…reviews…</div>" }
 *   createReview(input)           POST /reviews   (public submission; lands pending moderation)
 *
 * The widget endpoint returns the rating summary **and** the rendered review list in one HTML blob
 * (its `data-average-rating` / `data-number-of-reviews` attributes plus a `jdgm-rev` block per review).
 * We parse both out of it. The private JSON endpoints (`/products`, `/reviews`) are deliberately NOT
 * used — they require an authoritative (private) token, which must never ship in a client bundle.
 *
 * `configureJudgeMe` stores a singleton the React hook reads, mirroring the other `@tiledev/sdk-*`
 * packages (`configureCartHold`, `configureTileCredit`): one instance, one place the token lives.
 */
import type {
  JudgeMeConfig,
  JudgeMeReview,
  JudgeMeReviewInput,
  ReviewPicture,
  ReviewSummary,
  ReviewsPage,
} from "./types";

const DEFAULT_BASE_URL = "https://judge.me/api/v1";
const DEFAULT_PER_PAGE = 20;

/** `getProductReviews` returns the page of reviews together with the product's rating summary. */
export interface ProductReviewsResult extends ReviewsPage {
  summary: ReviewSummary;
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

  /** Fetch the product-review widget HTML for a handle. Empty string on an unsynced product. */
  private async getWidgetHtml(handle: string, page: number, perPage: number): Promise<string> {
    // Judge.me serves this widget with `Cache-Control: max-age=1200, public` behind CloudFront, so a
    // plain GET can return a review list up to 20 minutes stale — newly posted reviews are then missing
    // when the shopper opens the product. A unique query param makes every read a fresh cache miss, so
    // the app always sees the current reviews (`_vt` = "view time", ignored by Judge.me).
    const bust = `&_vt=${Date.now()}`;
    const body = await this.getJson(
      `/widgets/product_review?${this.auth()}&handle=${encodeURIComponent(handle)}` +
        `&per_page=${perPage}&page=${page}${bust}`
    );
    return String(body?.widget ?? "");
  }

  /**
   * A page of a product's published reviews **and** the rating summary, parsed from the public review
   * widget. Only shopper-visible reviews are in the widget, so moderation-held ones never appear.
   *
   * Keyed by the Shopify product **handle** (not the Judge.me id) — the widget resolves it directly.
   * `hasNextPage` is computed from the widget's own total (`data-number-of-reviews`).
   */
  async getProductReviews(
    handle: string,
    opts?: { page?: number; perPage?: number }
  ): Promise<ProductReviewsResult> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? DEFAULT_PER_PAGE;
    const html = await this.getWidgetHtml(handle, page, perPage);
    const summary = parseSummary(html);
    const reviews = parseReviews(html);
    return {
      reviews,
      page,
      perPage,
      summary,
      // The widget reports the total, so paging is exact rather than inferred.
      hasNextPage: page * perPage < summary.reviewCount,
    };
  }

  /**
   * The rating summary — average stars and review count — read off the widget's data attributes.
   * Degrades to zeroes on a product Judge.me has never seen. `per_page=1` keeps the payload small.
   */
  async getProductSummary(handle: string): Promise<ReviewSummary> {
    const html = await this.getWidgetHtml(handle, 1, 1);
    return parseSummary(html);
  }

  /**
   * Submit a review. Resolves once Judge.me has accepted it — the review is then **pending
   * moderation** (unpublished) until the merchant approves it, so it will not show up in
   * `getProductReviews` right away. Rejects on a non-2xx response.
   *
   * `platform: "shopify"`, the product keyed by its Shopify id and url, the reviewer's name/email and
   * the rating/title/body. Works with the public token (public review submission).
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
}

// ── Widget HTML parsing ─────────────────────────────────────────────────────────────────────────
//
// The widget is Judge.me's own server-rendered markup; we read fields off stable `jdgm-*` class names
// and `data-*` attributes with regexes rather than a DOM (React Native has no reliable DOMParser).
// Every field is defaulted so a markup change degrades a single field instead of crashing the list.

/** `data-average-rating` / `data-number-of-reviews` off the widget root. */
function parseSummary(html: string): ReviewSummary {
  const average = Number(html.match(/data-average-rating=['"]([\d.]+)['"]/)?.[1] ?? 0);
  const count = Number(html.match(/data-number-of-reviews=['"](\d+)['"]/)?.[1] ?? 0);
  return {
    averageRating: Number.isFinite(average) ? average : 0,
    reviewCount: Number.isFinite(count) ? count : 0,
  };
}

/** Split the widget into its `jdgm-rev` blocks and map each to a `JudgeMeReview`. */
function parseReviews(html: string): JudgeMeReview[] {
  // Each review opens with `<div class='jdgm-rev jdgm-divider-top' …>`. Splitting on that marker gives
  // one segment per review (the delimiter is dropped, so a segment runs to the next review or the end).
  const segments = html.split(/<div class=['"]jdgm-rev jdgm-divider-top['"]/).slice(1);
  return segments.map((seg, i) => parseReview(seg, i)).filter((r): r is JudgeMeReview => r !== null);
}

function parseReview(seg: string, index: number): JudgeMeReview | null {
  const rating = Number(
    seg.match(/class=['"]jdgm-rev__rating['"][^>]*data-score=['"](\d+)['"]/)?.[1] ??
      seg.match(/data-score=['"](\d+)['"]/)?.[1] ??
      0
  );
  const id = seg.match(/data-review-id=['"]([^'"]+)['"]/)?.[1] ?? `rev-${index}`;
  const author = clean(seg.match(/class=['"]jdgm-rev__author['"][^>]*>([\s\S]*?)<\/span>/)?.[1]) || "Anonymous";
  const title = clean(seg.match(/class=['"]jdgm-rev__title['"][^>]*>([\s\S]*?)<\/b>/)?.[1]) || null;
  const body = clean(seg.match(/class=['"]jdgm-rev__body['"][^>]*>([\s\S]*?)<\/div>/)?.[1]);
  const verified = /data-verified-buyer=['"]true['"]/.test(seg);
  const createdAt = normaliseTimestamp(
    seg.match(/class=['"]jdgm-rev__timestamp[^'"]*['"][^>]*data-content=['"]([^'"]+)['"]/)?.[1]
  );
  return { id, title, body, rating: Number.isFinite(rating) ? rating : 0, reviewerName: author, verified, createdAt, pictures: parsePictures(seg) };
}

/** Best-effort photo extraction from the review's `jdgm-rev__pics` block. */
function parsePictures(seg: string): ReviewPicture[] {
  const start = seg.indexOf("jdgm-rev__pics");
  if (start === -1) return [];
  // Bound the region so we do not pick up unrelated imagery further down the review.
  const region = seg.slice(start, start + 4000);
  const urls = new Set<string>();
  for (const m of region.matchAll(/(?:data-src|src|href)=['"](https?:\/\/[^'"]+?\.(?:jpe?g|png|webp|gif)[^'"]*)['"]/gi)) {
    urls.add(m[1]);
  }
  return [...urls].map((u) => ({ original: u, small: u, compact: u, huge: null }));
}

/** `"2026-10-19 03:28:40 UTC"` → ISO `"2026-10-19T03:28:40Z"`; passes anything else through. */
function normaliseTimestamp(raw: string | undefined): string {
  if (!raw) return "";
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*UTC)?/);
  return m ? `${m[1]}T${m[2]}Z` : raw.trim();
}

/** Strip tags, collapse whitespace, decode the handful of entities Judge.me emits. */
function clean(fragment: string | undefined): string {
  if (!fragment) return "";
  return fragment
    .replace(/<br\s*\/?>(?=)/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
