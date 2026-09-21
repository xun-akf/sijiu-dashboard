import type { Metadata } from "next";
import "./globals.css";
import "./support-overrides.css";

export const metadata: Metadata = {
  title: "充电站运营智能看板",
  description: "查看2026年1月至今的充电站经营数据、利润、尖峰平谷与单站明细。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}

