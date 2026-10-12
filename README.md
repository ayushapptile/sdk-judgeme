# @tiledev/sdk-judgeme

Judge.me product reviews for Tile apps — a framework-agnostic client plus a React hook.

```ts
import { configureJudgeMe, useJudgeMeReviews } from "@tiledev/sdk-judgeme";

const judgeMe = configureJudgeMe({
  shopDomain: "your-shop.myshopify.com",
  apiToken: "…public Judge.me token…",
  // baseUrl: "https://api.apptile.io/judge-me-proxy/", // optional proxy
});

function Reviews({ handle }: { handle: string }) {
  const { summary, reviews, loading, hasNextPage, loadMore } = useJudgeMeReviews(judgeMe, handle);
  // render summary.averageRating / summary.reviewCount and the reviews list
}
```

Built with `tsc` → `dist/`. `react` / `react-native` are peer dependencies.
