import type { NextConfig } from "next";

const deployTarget = process.env.DEPLOY_TARGET;
const githubPagesBase = deployTarget === "github-pages" ? "/green-hell-web" : undefined;
const toyAssetPrefix = deployTarget === "toy" ? "." : undefined;

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: githubPagesBase,
  assetPrefix: githubPagesBase ?? toyAssetPrefix,
  images: { unoptimized: true },
};

export default nextConfig;
