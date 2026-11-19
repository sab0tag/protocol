// D175 (Soniox, PR 4, «Адаптация под домен»): the one normalisation before the reading. The voice corpus showed forms the
// reading did not take — the same in typed text, so it is fixed here, not with code for one engine:
// - numbers said in words beyond the small ones («шістдесят грамів», «дві тисячі», «двісті п’ятдесят») → digits;
// - a decimal comma («0,5 л») and a space in thousands («2 000») — the reading splits clauses at commas;
// - «мілілітрів» → «мл», «міліграм» → «мг»;
// - the Russian words of food and meals people mix in («гречка с курицей», «кофе», «на завтрак»), word for word —
//   no translation of a phrase, only what the food base and the meal words know in Ukrainian.
// The small number words (один…десять, пів, півтори) stay: the reading knows them and their gender carries meaning.

const UNITS: Record<string, number> = {
  один: 1, одна: 1, одне: 1, одну: 1, два: 2, дві: 2, три: 3, чотири: 4, пять: 5, шість: 6, сім: 7, вісім: 8, девять: 9,
  две: 2, четыре: 4, шесть: 6, семь: 7, восемь: 8, // «девять», «девяносто» are spelt the same once the apostrophe goes
};
const TEENS: Record<string, number> = {
  десять: 10, одинадцять: 11, дванадцять: 12, тринадцять: 13, чотирнадцять: 14, пятнадцять: 15, шістнадцять: 16, сімнадцять: 17,
  вісімнадцять: 18, девятнадцять: 19,
};
const TENS: Record<string, number> = {
  двадцять: 20, тридцять: 30, сорок: 40, пятдесят: 50, шістдесят: 60, сімдесят: 70, вісімдесят: 80, девяносто: 90,
  двадцать: 20, тридцать: 30, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80,
};
const HUNDREDS: Record<string, number> = {
  сто: 100, двісті: 200, триста: 300, чотириста: 400, пятсот: 500, шістсот: 600, сімсот: 700, вісімсот: 800, девятсот: 900,
  двести: 200, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800,
};
const THOUSAND = /^(тисяч[аіу]?|тысяч[аи]?)$/u;

const RU: Record<string, string> = {
  и: 'і', с: 'з', со: 'зі', кофе: 'кава', хлеб: 'хліб', хлеба: 'хліба',
  овсянка: 'вівсянка', овсянку: 'вівсянку', овсянки: 'вівсянки', курица: 'курка', курицу: 'курку', курицей: 'куркою', курицы: 'курки',
  яйцо: 'яйце', яйца: 'яйця', яиц: 'яєць', сметаной: 'сметаною', завтрак: 'сніданок', завтрака: 'сніданку', обед: 'обід', ужин: 'вечеря',
  выпил: 'випив', выпила: 'випила', съел: 'зїв', съела: 'зїла', воды: 'води', стакан: 'склянка', стакана: 'склянки',
  грамм: 'грамів', граммов: 'грамів',
};

const key = (w: string) => w.toLocaleLowerCase('uk').replace(/['’ʼ`]/g, '');
const valueOf = (w: string): number | undefined => UNITS[w] ?? TEENS[w] ?? TENS[w] ?? HUNDREDS[w];

/** The words as the reading takes them; anything it does not touch stays as it was said. */
export function spokenForm(text: string): string {
  let s = text.replace(/(\d),(\d)/g, '$1.$2').replace(/(\d) (?=\d{3}(?!\d))/g, '$1');
  s = s.replace(/(^|[^\p{L}])(мілілітр\p{L}*)/giu, '$1мл').replace(/(^|[^\p{L}])(міліграм\p{L}*|миллиграмм\p{L}*)/giu, '$1мг');
  s = s.replace(/(^|[^\p{L}])на ужин(?=$|[^\p{L}])/giu, '$1на вечерю');
  // numbers in words: a run of number words becomes one number when it is past ten or has tens, hundreds or a thousand in it
  const parts = s.split(/([\p{L}'’ʼ`]+)/u);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const w = parts[i]!;
    if (i % 2 === 0) { out.push(w); continue; } // the separators
    const k = key(w);
    const v = valueOf(k);
    if (v === undefined && !THOUSAND.test(k)) { out.push(RU[k] ?? w); continue; }
    // gather the run: word, space, word…
    let total = 0, cur = 0, big = false, j = i, last = i;
    while (j < parts.length) {
      const kk = key(parts[j]!), n = valueOf(kk);
      if (THOUSAND.test(kk)) { total += (cur || 1) * 1000; cur = 0; big = true; }
      else if (n === undefined) break;
      else { if (n >= 10) big = true; cur += n; }
      last = j;
      if (j + 2 < parts.length && parts[j + 1] === ' ') j += 2; else break;
    }
    if (!big) { out.push(RU[k] ?? w); continue; } // «два», «три» — the reading knows them
    out.push(String(total + cur));
    i = last;
  }
  return out.join('');
}
