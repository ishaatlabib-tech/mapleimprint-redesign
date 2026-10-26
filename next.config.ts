import type { NextConfig } from "next";

// Square's Web Payments SDK requires a Content-Security-Policy that explicitly allows its CDN/
// PCI-connect domains (see developer.squareup.com/docs/web-payments/content-security-policy) —
// scoped to /checkout only, not sitewide, since nothing else on the site talks to Square.
const isSquareSandbox = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT !== "production";
const SQUARE_JS_HOST = isSquareSandbox ? "https://sandbox.web.squarecdn.com" : "https://web.squarecdn.com";
const SQUARE_PCI_HOST = isSquareSandbox ? "https://pci-connect.squareupsandbox.com" : "https://pci-connect.squareup.com";
const SQUARE_CSP = [
  "default-src 'self'",
  // Square's docs say script-src only needs the squarecdn.com host, but the SDK's hosted iframe
  // injects its own inline <script> tags at runtime with a different hash every load (confirmed
  // in a real production build — without 'unsafe-inline' here, Square's own SDK fails to connect
  // to its backend and the card form never loads). Scoped to /checkout only, not sitewide — user
  // explicitly authorized this tradeoff after reviewing it. (Google Pay's own pay.google.com host
  // is deliberately NOT allowed here — the express-checkout button is a separate, smaller scope
  // the user hasn't signed off on; the Card form, the primary path, doesn't need it.)
  `script-src 'self' 'unsafe-inline' ${SQUARE_JS_HOST}`,
  `frame-src 'self' ${SQUARE_JS_HOST}`,
  `connect-src 'self' ${SQUARE_JS_HOST} ${SQUARE_PCI_HOST}`,
  // The card form's own stylesheet (card-wrapper.css) is hosted on the same squarecdn.com host as
  // the SDK script, not inlined — style-src needs that host, not just 'unsafe-inline'.
  `style-src 'self' 'unsafe-inline' ${SQUARE_JS_HOST}`,
  "font-src 'self' https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net",
].join("; ");

const nextConfig: NextConfig = {
  // @napi-rs/canvas (server-side production-file export, src/lib/studio/renderDesignForExport.ts)
  // ships a native .node binary — Turbopack can't bundle that into an ESM chunk ("asset is not
  // placeable in ESM chunks"), so it needs to stay a real require()'d external at runtime instead
  // of being bundled, same as any other native-addon dependency.
  serverExternalPackages: ["@napi-rs/canvas"],
  // Retired house products replaced by the client's price-listed versions (printCatalogue.ts).
  async redirects() {
    return [
      {
        source: "/products/signs-banners/vinyl-banners/vinyl-banner",
        destination: "/products/signs-banners/vinyl-banners/vinyl-banners",
        permanent: true,
      },
      {
        source: "/products/drinkware/mugs/ceramic-mugs",
        destination: "/products/drinkware/mugs/custom-ceramic-mugs",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/checkout/:path*",
        headers: [{ key: "Content-Security-Policy", value: SQUARE_CSP }],
      },
    ];
  },
  // The static-generation worker pool defaults to one worker per CPU core (32 here), which
  // exceeds this machine's ~16GB of RAM once the 545-product catalogue's ~600 static routes are
  // being generated concurrently and crashes the build with an OOM. Capping it keeps peak memory
  // bounded at the cost of some build wall-clock time.
  experimental: {
    cpus: 2,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "fastly.picsum.photos",
      },
      {
        // S&S Activewear's product-image CDN. Product images are hotlinked directly from the
        // supplier's own CDN for now, not re-hosted on our infrastructure — see
        // catalogue-engine/README.md "What I need from you" #6 (image-redistribution rights are
        // still unconfirmed in writing; hotlinking is a lower-risk stance than rehosting until
        // that's settled).
        protocol: "https",
        hostname: "cdn.ssactivewear.com",
      },
      {
        // SanMar Canada's product-image CDN — same hotlinking stance as S&S above, same open
        // image-rights question. Added 2026-09-12 with the first real SanMar products.
        protocol: "https",
        hostname: "media.sanmarcanada.com",
      },
    ],
  },
};

export default nextConfig;
