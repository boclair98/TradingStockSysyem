import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${protocol}://${host}` : "https://tradingstocksysyem.coders.kr";
  const title = "TradingStockSysyem | Institutional ATS Certification Venue";
  const description = "회원사 주문 게이트웨이, 결정론적 가격·시간 우선 매칭, 시장정보 시퀀스, Drop Copy, 사전위험검사와 장애복구를 갖춘 ATS 적합성 시험 시스템.";
  return {
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", url: origin, images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "TradingStockSysyem institutional ATS certification venue" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
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
