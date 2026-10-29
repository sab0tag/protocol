import { expect, test } from '@playwright/test';
import { device } from './helpers';
const routes = ['/progress', '/progress/labs', '/assistant', '/plan', '/report', '/wellbeing', '/workout', '/menu', '/more', '/food', '/week', '/weight', '/data', '/progress/motivation', '/progress/insights', '/shopping', '/dishes', '/reminders', '/sync', '/profiles'];
// ТЗ P2 «контраст поверх фотографий» (D147): white text in a photo header, measured against the photo actually behind it
// (text made transparent, the 5th percentile of the per-pixel contrast — a few stray highlights do not decide it). WCAG
// thresholds: 4.5:1, or 3:1 for large text. The text shadow is not counted.
for (const width of [320, 390, 1024]) test(`text over the header photos keeps its contrast at ${width}px (D147)`, async ({ browser }) => {
  const page = await device(browser); await page.setViewportSize({ width, height: 900 });
  const out: string[] = []; // the failures
  for (const r of routes) {
    await page.goto('./#' + r); const h = page.locator('.protocol-scene-header').first();
    await h.waitFor(); await page.waitForTimeout(300); // the photo is decoded before it is measured
    const boxes = await h.evaluate((el) => { const hb = el.getBoundingClientRect();
      return [...el.querySelectorAll('h1, p')].filter((n) => (n as HTMLElement).innerText.trim()).map((n) => { const b = n.getBoundingClientRect(); const cs = getComputedStyle(n);
        return { tag: n.tagName, x: b.x - hb.x, y: b.y - hb.y, w: b.width, h: b.height, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), color: cs.color }; }); });
    const tag = await page.addStyleTag({ content: '.protocol-scene-header *{color:transparent!important;text-shadow:none!important}' });
    const shot = (await h.screenshot()).toString('base64');
    await tag.evaluate((n) => n.remove());
    const res = await page.evaluate(async ({ shot, boxes }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + shot; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
      const dpr = img.width / document.querySelector('.protocol-scene-header')!.getBoundingClientRect().width;
      const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const L = (r: number, gg: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
      return boxes.map((b) => { const d = g.getImageData(Math.round(b.x * dpr), Math.round(b.y * dpr), Math.max(1, Math.round(b.w * dpr)), Math.max(1, Math.round(b.h * dpr))).data;
        const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?/.exec(b.color)!; const a = m[4] ? Number(m[4]) : 1;
        const ls: number[] = [];
        for (let i = 0; i < d.length; i += 4) { const r = d[i]!, gg = d[i + 1]!, bb = d[i + 2]!;
          const fr = a * Number(m[1]) + (1 - a) * r, fg = a * Number(m[2]) + (1 - a) * gg, fb = a * Number(m[3]) + (1 - a) * bb;
          const lt = L(fr, fg, fb), lb = L(r, gg, bb); ls.push((Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05)); }
        ls.sort((x, y) => x - y); const large = b.size >= 24 || (b.size >= 18.66 && b.weight >= 700);
        return { tag: b.tag, size: b.size, p5: ls[Math.floor(ls.length * 0.05)]!.toFixed(2), need: large ? 3 : 4.5 }; });
    }, { shot, boxes });
    for (const x of res) if (Number(x.p5) < x.need) out.push(`${r} ${x.tag} ${x.size}px: ${x.p5} < ${x.need}`);
  }
  expect(out).toEqual([]);
});
