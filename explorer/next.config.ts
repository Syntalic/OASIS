import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside the OASIS git worktree; pin the workspace root to
  // this folder so Next doesn't get confused by sibling lockfiles.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
