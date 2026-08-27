import type { Metadata } from "next";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const configuredSiteUrl = process.env.SITE_URL ?? "https://tradingstocksysyem.coders.kr";
  let origin = "https://tradingstocksysyem.coders.kr";
  try { origin = new URL(configuredSiteUrl).origin; } catch { /* use the trusted fallback */ }
  const title = "Trading Stock System | 자동 매매체결 시스템";
  const description = "결정론적 매칭, 다중 증권사 주문 라우팅, 사전 위험통제와 장애 대사를 검증하는 자동 매매체결 엔지니어링 프로젝트.";
  return {
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", url: origin, images: [{ url: `${origin}/og.png`, width: 1733, height: 909, alt: "Trading Stock System automated trade execution dashboard" }] },
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
