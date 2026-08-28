import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
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
