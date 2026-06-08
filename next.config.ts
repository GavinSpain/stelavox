import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only packages — Next.js skips them during client bundling and
  // resolves them at runtime from node_modules in the server process.
  //
  // - @anthropic-ai/sdk: LLM SDK, used from server routes only.
  // - docx, epub-gen-memory: Phase 7 export renderers in lib/export/*,
  //   only reached from /api/exports/* server routes. Phase 8.5b B.7
  //   added these to close the ~41 KB gzipped client leak the Phase 8.5
  //   baseline identified (lib/export/docx.ts and lib/export/epub.ts
  //   statically import these libraries; without serverExternalPackages
  //   Next.js can pull them into shared chunks).
  serverExternalPackages: [
    "@anthropic-ai/sdk",
    "docx",
    "epub-gen-memory",
  ],
};

export default nextConfig;
