import type { Metadata } from "next";
import "./globals.css";

const repositoryName =
  process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "green-hell-web";
const assetPrefix =
  process.env.GITHUB_ACTIONS === "true" ? `/${repositoryName}` : "";

export const metadata: Metadata = {
  title: "绿色地狱网页版｜亚马逊生存日志",
  description: "一场可交互的亚马逊雨林生存实验：检查伤口、管理水分与理智，在第一个雨夜来临前生起营火。",
  icons: {
    icon: `${assetPrefix}/favicon.svg`,
    shortcut: `${assetPrefix}/favicon.svg`,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
