import type { NextConfig } from "next";

const githubPagesBase =
  process.env.DEPLOY_TARGET === "github-pages" ? "/green-hell-web" : undefined;

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: githubPagesBase,
  assetPrefix: githubPagesBase,
  images: { unoptimized: true },
};

export default nextConfig;
