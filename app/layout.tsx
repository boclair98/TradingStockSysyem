import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NXT Matching Core | 매매체결 운영 콘솔",
  description: "가격·시간 우선 체결 규칙과 주문원장을 검증하는 개인용 매매체결 운영 콘솔. 외부 거래소 API는 아직 연결되지 않았습니다.",
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
