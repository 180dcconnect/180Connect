import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // The outreach flyer is read from disk at send time (src/lib/outreach/flyer.ts).
  // Only files Next traces reach a serverless bundle, and a PDF opened through a
  // runtime path string is invisible to tracing, so every route that can reach
  // it is named here. Three do:
  //   /clients/[id] and /inbox both bundle the sendReviewedEmail server action
  //     (through EmailReviewPanel, the only component allowed to render the
  //     approval gate), which is what attaches the flyer to an immediate send.
  //   /api/cron/scheduled-outreach runs the worker that attaches it to a
  //     scheduled one.
  // Getting this list wrong degrades observably rather than silently: a missing
  // file makes flyerAttachment() return null, which logs
  // outreach.send.flyer_unavailable and sends the email without it.
  outputFileTracingIncludes: {
    "/clients/[id]": ["./src/lib/outreach/assets/**"],
    "/inbox": ["./src/lib/outreach/assets/**"],
    "/api/cron/scheduled-outreach": ["./src/lib/outreach/assets/**"],
  },
  experimental: {
    // Keeps a visited signed-in page in the browser's router cache for 30s, so
    // Back, or returning to a page moments after leaving it, is instant instead
    // of re-running the whole server render (Next 15+ defaults this to 0).
    // Saves still show at once: server actions that call revalidatePath or
    // router.refresh() clear the cache regardless of this window.
    staleTimes: {
      dynamic: 30,
    },
    // Defense in depth only: on exceeding this, Next.js truncates the body
    // and logs a warning rather than rejecting the request, so the actual
    // enforcement point for input limits is still src/lib/validation.ts.
    proxyClientMaxBodySize: "1mb",
  },
  turbopack: {
    resolveAlias: {
      // The vendored CherryBlossomQRCode component (src/components/
      // cherry-blossom-qrcode/) is React Native source. Map its `react-native`
      // import to react-native-web at bundle time; the four RN animation/
      // haptics/WebGPU modules are aliased to the web shims in src/lib/
      // web-shims/ through tsconfig.json `paths`, which Turbopack reads
      // natively (same mechanism as the `@/*` alias).
      "react-native": "react-native-web",
    },
  },
};

export default nextConfig;
