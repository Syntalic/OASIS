# AGENTS.md

Agent and contributor guidance for this repository lives in **[CLAUDE.md](CLAUDE.md)** —
setup, build & run, the reference MCP server, repo layout, and conventions.

This file exists so the guidance has **one source of truth** across agent tools (Claude Code,
Cursor, Codex, etc., which look for `AGENTS.md`). Read `CLAUDE.md`.

Quick start: `pnpm install && pnpm run build` (needs `GOOGLE_API_KEY` for the gemini build;
falls back to MiniLM without it). Just want to query the index? Download `dist/` from Releases.
