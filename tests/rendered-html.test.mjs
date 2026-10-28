import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html", host: "tradingstocksysyem.coders.kr", "x-forwarded-proto": "https" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the task-focused trading product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Trading Stock System \| 자동 매매체결 시스템<\/title>/i);
  assert.match(html, /내 자동화/);
  assert.match(html, /실거래 주문/);
  assert.match(html, /매칭엔진 검증/);
  assert.match(html, /운영 모니터/);
  assert.match(html, /시스템 아키텍처/);
  assert.match(html, /VALUE-FIRST AUTOMATION/);
  assert.match(html, /가상 운용 시작/);
  assert.match(html, /가격 기록 재생/);
  assert.match(html, /실계좌 영향 없음/);
  assert.match(html, /https:\/\/tradingstocksysyem\.coders\.kr\/og\.png/);
  assert.doesNotMatch(html, /appSecret|BROKER_APP_SECRET|12345678|test-app-secret/i);
});

test("keeps real-money routing visually and semantically separate from the engine lab", async () => {
  const [page, panel, automation, css, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/LiveTradingPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AutomationStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.ok(page.indexOf("<LiveTradingPanel") < page.indexOf('className="instrument-bar"'));
  assert.match(page, /실제 현금 주문은 위/);
  assert.match(panel, /실제 증권사로 주문 전송/);
  assert.match(panel, /이 단계에서는 주문을 전송하지 않습니다/);
  assert.match(panel, /60초/);
  assert.match(panel, /AES-GCM/);
  assert.match(automation, /실시간 시세가 아닌 사용자 설정값/);
  assert.match(automation, /실제 주문 전송 없음/);
  assert.match(automation, /실주문 없음/);
  assert.match(css, /\.live-console/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(layout, /결정론적 매칭/);
});
