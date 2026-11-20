// D201: package labels with a known answer for the label eval — a nutrition table rendered by the browser and photographed as a
// JPEG, with the traps a real package has: kJ beside kcal, only per serving, a per-pack column, English, a tilt and blur, a
// front with no table. `node scripts/eval-labels.mjs` → tests/fixtures/eval-labels/*.jpg + truth.json (per 100 g, as the
// app saves it). Values are made up for the test, not taken from real products.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = new URL('../tests/fixtures/eval-labels/', import.meta.url).pathname;
const row = (k, ...v) => `<tr><th>${k}</th>${v.map((x) => `<td>${x}</td>`).join('')}</tr>`;
const table = (head, rows) => `<table><tr><th></th>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>`;
const labels = [
  { id: 'yogurt-greek', title: 'Йогурт грецький 2 %', truth: { readable: true, kcal: 69, protein: 7.5, fat: 2, carbs: 4, calciumMg: 110 },
    body: table(['на 100 г'], [row('Енергетична цінність', '290 кДж / 69 ккал'), row('Білки', '7,5 г'), row('Жири', '2,0 г'), row('Вуглеводи', '4,0 г'), row('Кальцій', '110 мг')]) },
  { id: 'buckwheat', title: 'Крупа гречана ядриця', truth: { readable: true, kcal: 343, protein: 13, fat: 3.4, carbs: 62 },
    body: table(['на 100 г продукту'], [row('Енергія', '1430 кДж', '343 ккал'), row('Білки', '13 г'), row('Жири', '3,4 г'), row('Вуглеводи', '62 г')]) },
  { id: 'cottage-pack', title: 'Сир кисломолочний 5 %, 200 г', truth: { readable: true, kcal: 121, protein: 17, fat: 5, carbs: 1.8 },
    body: table(['на 100 г', 'на упаковку 200 г'], [row('Енергетична цінність, ккал', '121', '242'), row('Білки, г', '17', '34'), row('Жири, г', '5', '10'), row('Вуглеводи, г', '1,8', '3,6')]) },
  { id: 'cookies-serving', title: 'Печиво вівсяне', truth: { readable: true, kcal: 467, protein: 6.7, fat: 20, carbs: 66.7 },
    body: `<p>Харчова цінність 1 порції (30 г, 3 шт.):</p>${table(['1 порція'], [row('Енергія', '140 ккал'), row('Білки', '2 г'), row('Жири', '6 г'), row('Вуглеводи', '20 г')])}` },
  { id: 'milk', title: 'Молоко 2,5 %', truth: { readable: true, kcal: 52, protein: 2.8, fat: 2.5, carbs: 4.7, calciumMg: 120 },
    body: table(['в 100 мл'], [row('Енергетична цінність', '218 кДж / 52 ккал'), row('Білки', '2,8 г'), row('Жири', '2,5 г'), row('Вуглеводи', '4,7 г'), row('Кальцій', '120 мг')]) },
  { id: 'chocolate-kj-first', title: 'Шоколад чорний 70 %', truth: { readable: true, kcal: 545, protein: 7.8, fat: 39, carbs: 37 },
    body: table(['100 г'], [row('Енергетична цінність', '2280 кДж'), row('', '545 ккал'), row('Жири', '39 г'), row('Вуглеводи', '37 г'), row('Білки', '7,8 г')]) },
  { id: 'hummus-english', title: 'Hummus classic', truth: { readable: true, kcal: 266, protein: 7, fat: 21, carbs: 9 },
    body: table(['per 100 g'], [row('Energy', '1105 kJ / 266 kcal'), row('Fat', '21 g'), row('Carbohydrate', '9 g'), row('Protein', '7 g'), row('Salt', '1.1 g')]) },
  { id: 'buckwheat-tilted', title: 'Крупа гречана ядриця', style: 'transform: rotate(-5deg); filter: blur(0.7px);', truth: { readable: true, kcal: 343, protein: 13, fat: 3.4, carbs: 62 },
    body: table(['на 100 г продукту'], [row('Енергія', '1430 кДж', '343 ккал'), row('Білки', '13 г'), row('Жири', '3,4 г'), row('Вуглеводи', '62 г')]) },
  { id: 'front-no-table', title: 'ГРЕЧКА ядриця • 900 г • ґатунок перший', truth: { readable: false },
    body: '<p style="font-size:42px;font-weight:800;margin:40px 0">Смачно щодня!</p><p>Виготовлено в Україні</p>' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 560 } });
mkdirSync(OUT, { recursive: true });
const truth = {};
for (const l of labels) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#c9b48f;padding:30px;font-family:Arial,sans-serif">
    <div id="pack" style="background:#fffdf6;padding:24px 28px;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.35);${l.style ?? ''}">
    <h2 style="margin:0 0 12px">${l.title}</h2>${l.body}
    <p style="font-size:12px;color:#555;margin-top:14px">Склад: див. на упаковці. Зберігати при температурі від +2 до +6 °C.</p></div>
    <style>table{border-collapse:collapse;font-size:18px}th,td{border:1px solid #333;padding:6px 12px;text-align:left}</style></body>`);
  await page.screenshot({ path: `${OUT}${l.id}.jpg`, type: 'jpeg', quality: 78, fullPage: true });
  truth[l.id] = l.truth;
}
writeFileSync(`${OUT}truth.json`, JSON.stringify(truth, null, 1));
await browser.close();
console.log(`${labels.length} labels → tests/fixtures/eval-labels`);
