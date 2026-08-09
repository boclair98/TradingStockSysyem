import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${protocol}://${host}` : "https://tradingstocksysyem.coders.kr";
  const title = "TradingStockSysyem | ATS 매매체결 코어";
  const description = "결정론적 가격·시간 우선 매칭, 회원사 주문 게이트웨이, 사전위험통제, 내구성 저널과 복구를 갖춘 ATS 기술실사·적합성 기준선.";
  return {
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", url: origin, images: [{ url: `${origin}/og-ats.png`, width: 1200, height: 630, alt: "TradingStockSysyem ATS venue core engineering evaluation" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og-ats.png`] },
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
