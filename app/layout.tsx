import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${protocol}://${host}` : "https://tradingstocksysyem.coders.kr";
  const title = "TradingStockSysyem | 실시간 주식 주문·체결 서비스";
  const description = "사용자별 암호화 증권계좌 연결, 실시간 잔고·시세, 주문 사전위험검사, KRX·NXT·SOR 라우팅, 주문·체결 대사를 제공하는 주식 거래 시스템.";
  return {
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", url: origin, images: [{ url: `${origin}/og-live.png`, width: 1200, height: 630, alt: "TradingStockSysyem live stock trading console" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og-live.png`] },
  };
}

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
