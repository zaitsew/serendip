import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The droplet image runs the standalone server (server.js + a pruned node_modules): see scripts/deploy.sh.
  output: "standalone",
  // TMDB images are plain <img>/background URLs; no optimizer (it needs a native dependency).
  images: { unoptimized: true },
  poweredByHeader: false,
  devIndicators: false,
  // The TV opens http://<mac-ip>:3000 from the same Wi-Fi.
  allowedDevOrigins: ["*.local", "192.168.*.*", "10.*.*.*"],
};

export default nextConfig;
