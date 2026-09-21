import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_SITE_BASE_PATH === "/" ? "" : "/sijiu-dashboard",
  assetPrefix: process.env.NEXT_PUBLIC_SITE_BASE_PATH === "/" ? "" : "/sijiu-dashboard",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
