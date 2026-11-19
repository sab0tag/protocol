// D182 (task 7, step 7): patient Б — a fracture. The traumatologist issues a plan with a rehabilitation complex in the clinic
// cabinet; the patient's clean phone takes it by the code, checks it against the paper, adds the doctor's limit, does the
// complex with pain and swelling; nothing is composed; the stage waits for «Так»; the report to the doctor carries ЛФК.
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const API = 'http://localhost:8099';

test('patient Б (fracture): the clinic’s complex → «звірив(ла)» → limits, sessions, stage on «Так» → the report’s ЛФК (D182)', async ({ browser, request }) => {
  const output = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/clinic/createOrg.ts', 'Травмпункт Б', 'Адмін'],
    { env: { ...process.env, DB_PATH: '.e2e/api.db' }, encoding: 'utf8' });
  const admin = /admin token \(shown once, store it safely\): (\S+)/.exec(output)![1]!;
  const doc = await (await request.post(`${API}/v1/clinic/staff`, { headers: { Authorization: `Bearer ${admin}` }, data: { displayName: 'Травматолог', role: 'doctor' } })).json() as { token: string };

  // 1. The doctor writes the complex in the cabinet — stage 2 planned for a date already past
  const doctorCtx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const doctor = await doctorCtx.newPage();
  await doctor.goto('./#/clinic');
  await doctor.getByText('Службовий токен (тимчасово)', { exact: true }).click();
  await doctor.getByLabel('Токен доступу').fill(doc.token);
  await doctor.getByRole('button', { name: 'Увійти', exact: true }).click();
  await doctor.getByLabel('Назва плану').fill('Перелом лівої гомілки');
  await doctor.getByLabel(/^Обмеження/).fill('Без опори на ліву ногу 6 тижнів');
  await doctor.getByLabel(/^ЛФК, необовʼязково/).fill('Етап 1: без опори\nЗгинання стопи | 3 × 10 | повільно\nНапруження чотириголового мʼяза | 10 × 5 с\nЕтап 2 з 01.01.2020: часткова опора\nХодьба з милицями | 5 хв');
  await doctor.getByLabel('ЛФК разів на день').fill('3');
  await doctor.getByRole('checkbox', { name: 'Пацієнт погодився отримати цей план у застосунок.' }).check();
  const issued = doctor.waitForResponse((r) => r.url().endsWith('/v1/clinic/plans') && r.request().method() === 'POST');
  await doctor.getByRole('button', { name: 'Створити QR', exact: true }).click();
  const { code } = await (await issued).json() as { code: string };

  // 2. A clean phone: the code, the preview with the complex, «звірив(ла)»
  const patientCtx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const patient = await patientCtx.newPage();
  await patient.goto(`./#/plan/import?code=${code}`);
  await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
  await expect(patient.getByText('Комплекс ЛФК')).toBeVisible();
  await expect(patient.getByText(/Згинання стопи 3 × 10/)).toBeVisible();
  await patient.getByRole('checkbox', { name: 'Я звірив(ла) кожен пункт із призначенням лікаря' }).check();
  await patient.getByRole('button', { name: 'Додати до мого плану' }).click();
  await expect(patient).toHaveURL(/#\/plan\/prescriptions/);

  // 3. The doctor's limit as a structure (the clinic's line stays words)
  await patient.goto('./#/plan/constraints');
  await expect(patient.getByText('Без опори на ліву ногу 6 тижнів')).toBeVisible();
  await expect(patient.getByText(/зараз: Етап 1: без опори · 3 раз\(и\) на день/)).toBeVisible();
  await patient.getByRole('button', { name: 'Додати обмеження' }).click();
  await patient.getByRole('dialog').getByLabel('До якої дати (включно)').fill('2099-12-31');
  await patient.getByRole('dialog').getByLabel('Хто призначив').fill('Травматолог');
  await patient.getByRole('dialog').getByRole('button', { name: 'Зберегти' }).click();

  // 4. «Сьогодні»: ЛФК 0 з 3; the complex — nothing composed, stage 2 waits for «Так»
  await patient.goto('./#/');
  await expect(patient.getByTestId('quick-marks').getByRole('button', { name: /ЛФК/ }).first()).toContainText('0 з 3');
  await patient.goto('./#/workout');
  const rehab = patient.getByTestId('rehab');
  await expect(rehab.getByRole('heading', { name: 'Етап 1: без опори' })).toBeVisible();
  await expect(patient.getByRole('region', { name: 'Скласти тренування з ІІ' })).toHaveCount(0);
  for (const [pain, swelling] of [[2, 'Ні'], [4, 'Так']] as const) {
    await rehab.getByRole('button', { name: 'Зробив(ла) комплекс' }).click();
    await rehab.getByRole('button', { name: String(pain), exact: true }).click();
    await rehab.getByRole('button', { name: swelling, exact: true }).click();
    await rehab.getByRole('button', { name: 'Записати' }).click();
  }
  await expect(rehab.getByTestId('rehab-count')).toHaveText('Сьогодні: 2 з 3');
  await rehab.getByRole('button', { name: 'Так, дозволив' }).click();
  await expect(rehab.getByRole('heading', { name: 'Етап 2: часткова опора' })).toBeVisible();

  // 5. The report to the doctor: ЛФК sessions of due, pain by day, swelling, the limit
  await patient.goto('./#/report');
  const section = patient.getByTestId('report-rehab');
  await expect(section).toContainText('ЛФК (Етап 2: часткова опора): зроблено 2 з 3 призначених (3 на день)');
  await expect(section).toContainText(/Біль після занять, найбільший за день \(0–10\): \d{2}\.\d{2} — 4/);
  await expect(section).toContainText(/Набряк відмічено: \d{2}\.\d{2}/);
  await expect(section).toContainText('Обмеження лікаря: без опори на ліву ногу до 31.12');
  expect(await patient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await doctorCtx.close(); await patientCtx.close();
});

test('two profiles on one phone — rehab and fitness — do not mix: modes, history and what goes to the model (D182)', async ({ browser }) => {
  const { device, syncOn } = await import('./helpers');
  const page = await device(browser, 'example', { sw: false }); // the owner: kettlebell, sugar, no limits
  await syncOn(page);
  // a second profile with a fracture and its complex
  await page.goto('./#/profiles');
  await page.getByRole('button', { name: 'Додати профіль', exact: true }).click();
  await page.getByLabel('Ім’я', { exact: true }).fill('Олена');
  await page.getByRole('button', { name: 'Зберегти профіль', exact: true }).click();
  await page.getByRole('button', { name: 'Відкрити профіль: Олена', exact: true }).click();
  await page.getByText('Інші способи почати').click(); await page.getByRole('button', { name: /^Пропустити/ }).click();
  await expect(page.getByTestId('active-profile')).toContainText('Олена'); // the switch has reloaded
  if (process.env.VITE_MODULE_POLICY_ENABLED === 'true') { // a skipped onboarding starts with training off; switched on as a person would
    await page.goto('./#/modules');
    const training = page.getByRole('switch', { name: 'Тренування', exact: true });
    if (!(await training.isChecked())) await training.click();
    await expect(training).toBeChecked();
  }
  await page.goto('./#/plan/constraints');
  await expect(page.getByRole('button', { name: 'Додати комплекс' })).toBeVisible();
  await page.getByRole('button', { name: 'Додати комплекс' }).click();
  await page.getByRole('dialog').getByLabel('Вправи й етапи').fill('Згинання стопи | 3 × 10');
  await page.getByRole('dialog').getByRole('button', { name: 'Зберегти' }).click();
  await page.goto('./#/workout');
  await expect(page.getByTestId('rehab')).toBeVisible();

  // back to the owner: the kettlebell as before, and nothing of Олена's goes to the model
  await page.goto('./#/profiles');
  await page.getByRole('button', { name: 'Відкрити профіль: Мій профіль', exact: true }).click(); // the unnamed main profile is read out by its role now
  await expect(page.getByTestId('active-profile')).not.toContainText('Олена');
  let sent = '';
  await page.route('**/workout', async (r) => { sent = r.request().postData() ?? ''; await r.fulfill({ json: { advice: 'ok', exercises: [{ id: 'goblet-squat', sets: 3, reps: 10, seconds: null }] } }); });
  await page.goto('./#/workout');
  await expect(page.getByTestId('rehab')).toHaveCount(0);
  const panel = page.getByRole('region', { name: 'Скласти тренування з ІІ' });
  const asked = page.waitForRequest((r) => r.url().endsWith('/workout') && r.method() === 'POST');
  await panel.getByRole('button', { name: 'Скласти тренування' }).click();
  await panel.getByRole('button', { name: 'Дозволити й скласти' }).click();
  sent = (await asked).postData() ?? '';
  expect(sent).toContain('goblet-squat');
  expect(sent).not.toMatch(/Згинання стопи|Обмеження лікаря|ЛФК/);
});
