// D86: the phrase corpus through the screen itself — each phrase typed into «Записати їжу», and what the person sees read
// back: the «Розпізнано» rows, or the first line of the list for one part. The unit run checks the same function for units,
// grams and plan flags; this one catches a screen that does not use it (17.10: a single word still went to the old list).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { device } from './helpers';

interface Row { id: string; phrase: string; profile: 'clean' | 'demo'; expect: { name: string }[]; not_found?: string[]; status: 'fixed' | 'open' }
const rows = parse(readFileSync('tests/fixtures/meal-phrases.yaml', 'utf8')) as Row[];

async function onScreen(page: Page, phrase: string): Promise<{ names: string[]; missing: string[] }> {
  await page.goto('./#/meal/new');
  await page.getByRole('searchbox', { name: /^Що з’їли/ }).fill(phrase);
  await page.waitForTimeout(150);
  const panel = page.locator('div', { has: page.getByText('Розпізнано', { exact: true }) }).last();
  const first = page.locator('ul button[data-item]').first();
  const names = await panel.isVisible()
    ? await panel.locator('label[data-item]').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-item')!))
    : await first.count() ? [(await first.getAttribute('data-item'))!] : [];
  const missing = (await page.getByText(/ — не знайдено/).allInnerTexts()).map((x) => /«(.+)» — не знайдено/.exec(x)?.[1] ?? x);
  return { names, missing };
}

for (const profile of ['clean', 'demo'] as const) {
  test(`the corpus on the screen — ${profile} profile (D86)`, async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await device(browser, profile === 'clean' ? 'skip' : 'demo');
    const report: string[] = [];
    for (const row of rows.filter((r) => r.profile === profile)) {
      const { names, missing } = await onScreen(page, row.phrase);
      const want = row.expect.map((e) => e.name);
      const diff = [
        ...(names.join(' | ') !== want.join(' | ') ? [`на екрані: ${names.join(' | ') || '—'}; очікується: ${want.join(' | ') || '—'}`] : []),
        ...(row.not_found ?? []).filter((n) => !missing.includes(n)).map((n) => `«${n}» мало дати «не знайдено»`),
      ];
      if (row.status === 'fixed' && diff.length) report.push(`${row.id} «${row.phrase}»: ${diff.join('; ')}`);
      if (row.status === 'open' && !diff.length) report.push(`${row.id} «${row.phrase}» проходить на екрані — переведіть у fixed`);
    }
    expect(report, report.join('\n')).toEqual([]);
  });
}
