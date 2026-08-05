import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NXT Matching Lab | 매매체결 터미널",
  description: "가격·시간 우선 매칭 엔진을 체험하는 NXT 매매체결 시뮬레이터.",
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
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
