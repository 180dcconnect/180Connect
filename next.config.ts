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
};

export default nextConfig;
