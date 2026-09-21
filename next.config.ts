import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/sijiu-dashboard",
  assetPrefix: "/sijiu-dashboard",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
