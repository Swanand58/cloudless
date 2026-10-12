import type { NextConfig } from "next";

// Only set for local development against a separate backend; see lib/api.ts
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
const apiSources = apiUrl ? ` ${apiUrl} ${apiUrl.replace(/^http/, "ws")}` : "";

// Production only: the dev server needs eval and a hot-reload socket
const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; there is no eval in production
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // blob: for decrypted images, data: for encrypted-then-decrypted thumbnails
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self'${apiSources}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone", // For Docker deployment

  // Security headers
  async headers() {
    const headers = [
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value:
          "accelerometer=(), camera=(), geolocation=(), gyroscope=(), " +
          "magnetometer=(), microphone=(), payment=(), usb=()",
      },
    ];

    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Content-Security-Policy",
        value: contentSecurityPolicy,
      });
    }

    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
