import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.bilibili.com/toy/green-hell-web/"),
  title: "CANOPY: First Night｜雨林第一夜",
  description: "一款原创第一人称硬核雨林生存网页版：诊断伤口、净化水源、建立营地，并在暴雨后取回信标电池。",
  applicationName: "CANOPY: First Night",
  category: "game",
  keywords: ["雨林生存", "网页游戏", "第一人称", "survival game", "Three.js"],
  authors: [{ name: "CANOPY Web Game Project" }],
  creator: "CANOPY Web Game Project",
  openGraph: {
    type: "website",
    url: "https://www.bilibili.com/toy/green-hell-web/index.html",
    locale: "zh_CN",
    title: "CANOPY: First Night｜雨林第一夜",
    description: "雨林不会给你答案。观察、诊断、准备，然后活着回来。",
    siteName: "CANOPY: First Night",
    images: [
      {
        url: "https://www.bilibili.com/toy/green-hell-web/og-canopy-first-night.png",
        alt: "暴雨中的原创低多边形雨林营地、坠毁飞机与远方气象站",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CANOPY: First Night",
    description: "观察环境、处理伤口、建立营地，在暴雨夜发出求救信号。",
    images: ["https://www.bilibili.com/toy/green-hell-web/og-canopy-first-night.png"],
  },
  alternates: {
    canonical: "https://www.bilibili.com/toy/green-hell-web/index.html",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06140e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" href="./icon.svg" type="image/svg+xml" />
      </head>
      <body>
        {children}
        <Script src="https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
