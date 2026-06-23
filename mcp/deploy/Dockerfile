# syntax=docker/dockerfile:1
# OASIS reference MCP server (Streamable HTTP) — how the stewards host the free public
# instance. NOT part of the OASIS standard; anyone may self-host this image or host
# differently. Build CONTEXT is the REPO ROOT (needs package.json, dist/, mcp/):
#   fly deploy --config mcp/deploy/fly.toml        # run from the repo root
#
# Debian-based Node, NOT Alpine: the native @lancedb/lancedb and onnxruntime
# (via @xenova/transformers) binaries need glibc. Build the index first on your
# machine:  pnpm install && pnpm build && pnpm embed
FROM node:22-slim

# libgomp1: required by onnxruntime-node. ca-certificates: HTTPS model download.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# 1) Root runtime deps. Use npm here (the repo uses pnpm for dev): npm runs dependency
#    build scripts by default, so sharp's native binary builds cleanly. pnpm 11 gates
#    build scripts, which blocks sharp — and @xenova/transformers require()s sharp at
#    import even for text embeddings, so it must be present or the server won't start.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 2) MCP server deps (@modelcontextprotocol/sdk).
COPY mcp/package.json mcp/package-lock.json ./mcp/
RUN cd mcp && npm ci --omit=dev

# 3) Prebuilt index + compiled JS. The server loads index.json + the LanceDB table only,
#    so drop the big published-artifact duplicates and the host-built vectors.
COPY dist ./dist
RUN rm -f dist/endpoints.json dist/providers.json && rm -rf dist/lance

# 4) Taxonomy sources the SERVER reads at runtime (not just at build):
#      - ontology/intents — loaded synchronously at startup by curated-search.js (tools.mjs
#        builds capById from it on import; missing dir => ENOENT crash on boot)
#      - spec/*.json schemas + ontology/intents — used by oasis_taxonomy / oasis_validate /
#        oasis_validate_binding
#    Both are tiny and required. (dist/cli.js embed in step 6 reads only dist/index.json.)
COPY ontology ./ontology
COPY spec ./spec

# 5) Server source.
COPY mcp ./mcp

# 6) Re-embed the curated capabilities INSIDE the image: regenerates dist/lance for THIS
#    platform and fails the build early if retrieval is broken. Reads dist/index.json only.
#    GOOGLE_API_KEY is passed as a BUILD SECRET so the table is built with the SAME embedder
#    the server uses at runtime (gemini-embedding-001, 3072-dim). Without it the table would
#    be MiniLM 384-dim and every gemini query would dimension-mismatch into the keyword
#    fallback. Absent secret => keyless MiniLM build (dev/offline). Deploy with:
#      fly deploy --config mcp/deploy/fly.toml --build-secret GOOGLE_API_KEY=$GOOGLE_API_KEY
RUN --mount=type=secret,id=GOOGLE_API_KEY \
    GOOGLE_API_KEY="$(cat /run/secrets/GOOGLE_API_KEY 2>/dev/null || true)" \
    node dist/cli.js embed --scope curated

ENV PORT=8080
EXPOSE 8080
CMD ["node", "mcp/http-server.mjs"]
