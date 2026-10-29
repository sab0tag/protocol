import { expect, test } from '@playwright/test';
import { device } from './helpers';

// ТЗ 2.0 (Workout 2.0, аудит P2 «мобильная компоновка»): on a narrow phone no screen scrolls sideways and nothing sticks out
// past the edge. An element inside a container that scrolls or clips on purpose (a chip row, a wide table) is not counted.
const routes = ['/', '/food', '/meal/new', '/workout', '/exercises', '/dishes', '/foods', '/menu', '/shopping', '/plan', '/plan/prescriptions',
  '/plan/constraints', '/plan/goals', '/progress', '/progress/labs', '/progress/motivation', '/progress/insights', '/week', '/weight', '/wellbeing',
  '/wellbeing/journal', '/report', '/assistant', '/more', '/reminders', '/sync', '/data', '/profiles', '/my-day', '/modules'];

for (const width of [320, 360]) test(`no screen is wider than a ${width}px phone, with the example's data`, async ({ browser }) => {
  const page = await device(browser, 'demo');
  await page.setViewportSize({ width, height: 800 });
  const out: string[] = [];
  for (const route of routes) {
    await page.goto('./#' + route);
    await page.waitForFunction((r) => location.hash === '#' + r, route);
    await page.locator('main h1').first().waitFor(); await page.waitForTimeout(250); // the new screen, laid out
    out.push(...await page.evaluate((route) => {
      const vw = document.documentElement.clientWidth, found: string[] = [];
      if (document.documentElement.scrollWidth > vw) found.push(`${route}: the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
      for (const el of document.querySelectorAll('main *')) {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height || (box.right <= vw + 1 && box.left >= -1)) continue;
        let p = el.parentElement, contained = false;
        for (; p && !contained; p = p.parentElement) contained = getComputedStyle(p).overflowX !== 'visible';
        if (!contained) found.push(`${route}: <${el.tagName.toLowerCase()}> «${((el as HTMLElement).innerText ?? '').slice(0, 30)}» at ${Math.round(box.left)}..${Math.round(box.right)}`);
      }
      return found.slice(0, 3);
    }, route));
  }
  expect(out).toEqual([]);
});
