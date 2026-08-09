import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html", host: "tradingstocksysyem.coders.kr", "x-forwarded-proto": "https" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the live trading product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>TradingStockSysyem \| 실시간 주식 주문·체결 서비스<\/title>/i);
  assert.match(html, /LIVE BROKER ROUTING/);
  assert.match(html, /실거래 콘솔/);
  assert.match(html, /ATS ENGINE LAB/);
  assert.match(html, /https:\/\/tradingstocksysyem\.coders\.kr\/og-live\.png/);
  assert.doesNotMatch(html, /appSecret|BROKER_APP_SECRET|12345678|test-app-secret/i);
});

test("keeps real-money routing visually and semantically separate from the engine lab", async () => {
  const [page, panel, css, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/LiveTradingPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.ok(page.indexOf("<LiveTradingPanel") < page.indexOf('className="instrument-bar"'));
  assert.match(page, /실제 현금 주문은 위/);
  assert.match(panel, /실제 증권사로 주문 전송/);
  assert.match(panel, /아직 주문 전송 안 함/);
  assert.match(panel, /60초/);
  assert.match(panel, /AES-GCM/);
  assert.match(css, /\.live-console/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(layout, /KRX·NXT·SOR/);
});
