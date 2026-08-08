import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradingStockSysyem | Matching Core",
  description: "TradingStockSysyem 매매체결 운영 콘솔. 가격·시간 우선 체결 규칙과 주문원장을 검증하고 증권사 API 어댑터를 통해 KRX·NEXTRADE 연동을 준비합니다.",
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
