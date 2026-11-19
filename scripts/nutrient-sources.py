#!/usr/bin/env python3
# D188: builds src/data/nutrientSources.ts — sodium, fibre, sugars and saturated fat per 100 g for the base foods and for
# Харчоблок's products that are not mapped to the base, each row with its source in USDA FoodData Central (SR Legacy, 2018).
#
#   python3 -I scripts/nutrient-sources.py <SR Legacy CSV folder> > src/data/nutrientSources.ts
#   (the folder of FoodData_Central_sr_legacy_food_csv_2018-04.zip from https://fdc.nal.usda.gov/download-datasets)
#
# How a value is taken (the same for every row):
# - sodium — as the source has it (salt is not tied to the other numbers); `skip` drops it where the source is unsalted and
#   ours is not (salo, salted fish): unknown is honest, a wrong low number is not;
# - saturated fat — the source's share of fat × this base's own fat (a 2.5 % kefir from a 1 % one);
# - fibre and sugars — scaled by this base's carbohydrates when the source's are within ×0.5–2 (a baked or a dried form),
#   else as they are; sugars never above the carbohydrates;
# - a field the source does not have stays unknown; a food with no honest match is not here at all (unknown, «не відомо»).
import csv, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SR = Path(sys.argv[1])

# foodId → (FDC id | [(FDC id, share), …] for a simple mix, note, fields to skip)
BASE = {
    'oats': (173904,), 'buckwheat': (170685,), 'brown-rice': (169703,), 'quinoa': (168874,),
    'chicken-breast': (171077,), 'chicken-thigh': (173627,), 'egg': (171287,),
    'kefir': (170904, 'кефір 1 % (Lifeway), жир перераховано'), 'parmesan': (170848,), 'sardines': (175139,),
    'broccoli': (170379,), 'cucumber': (168409,), 'tomato': (170457,), 'apple': (171688,), 'olive-oil': (171413,),
    'buckwheat-boiled': (170686,), 'brown-rice-boiled': (169704,), 'white-rice-boiled': (168878,), 'oatmeal-water': (173905,),
    'quinoa-boiled': (168917,), 'pasta-boiled': (169737,), 'potato-boiled': (170440,), 'mashed-potato': (170037,),
    'beans-boiled': (173740,), 'lentils-boiled': (172421,), 'bread-rye': (172684,), 'bread-white': (174924,),
    'bread-wholegrain': (172688,), 'egg-boiled': (173424,), 'chicken-breast-cooked': (171477,), 'turkey': (171098,),
    'beef-lean': (174030, 'фарш 90/10, жир перераховано'), 'pork-lean': (168249, 'вирізка, жир перераховано'),
    'chicken-liver': (171060,), 'hake': (173713, 'мерланг (whiting) — близький вид, хека в таблиці немає'),
    'pollock': (173725,), 'salmon': (175167,), 'tuna-can': (173709, 'звичайний, із сіллю'),
    'kefir-1': (170904,), 'yogurt-plain': (171284, 'жир перераховано'),
    'cottage-cheese': (168114, 'сир без доданої солі — як наш кисломолочний; американський cottage солоний'),
    'milk': (171267,), 'lactose-free-milk': (170872, 'молоко 1 %, жир перераховано'), 'sour-cream': (171257, 'жир перераховано'),
    'hard-cheese': (171241,), 'brynza': (173420, 'фета — найближчий розсольний сир'), 'butter': (173430, 'несолоне'),
    'cabbage': (169975,), 'sauerkraut': (169279,), 'carrot': (170393,), 'beet': (169145,), 'spinach': (168462,),
    'bell-pepper': (170108,), 'zucchini': (169291,), 'cauliflower': (169986,), 'onion': (170000,), 'lettuce': (169249,),
    'potato-raw': (170026,), 'pickles': (168558,), 'banana': (173944,), 'orange': (169097,), 'pear': (169118,),
    'kiwi': (168153,), 'strawberry': (167762,), 'blueberry': (171711,), 'walnut': (170187,), 'almond': (170567,),
    'pumpkin-seeds': (170556,), 'sunflower-oil': (171025,), 'avocado': (171705,), 'hummus': (174289, 'жир перераховано'),
    'honey': (169640,), 'sugar': (169655,), 'mayonnaise': (171009,), 'sausage-boiled': (172013, 'болонська (яловичина й свинина)'),
    'frankfurter': (172964,), 'ham': (173864,), 'orange-juice': (169098,), 'balsamic': (172241,), 'salt': (173468,),
    'lemon-juice': (167747,), 'herbs': (170416, 'петрушка'), 'garlic': (169230,),
    'broth-chicken': (174536, 'готовий, із сіллю'), 'pancakes': (175009, 'млинці за рецептом pancakes'),
    'deruny': (170092,), 'millet-boiled': (168871,), 'barley-boiled': (170285,), 'bulgur-boiled': (170287,),
    'couscous-boiled': (169700,), 'chickpeas-boiled': (173757,), 'granola': (171646,), 'white-rice': (168877,),
    'pasta-dry': (169736,), 'beans-dry': (175193,), 'lentils-dry': (172420,), 'mac-cheese': (173342,),
    'crispbread': (172739, 'житні хлібці'), 'lavash': (174915, 'піта — найближчий тонкий хліб'), 'flour-wheat': (168894,),
    'croissant': (174987,), 'cookies': (174950, 'вершкове печиво'), 'chocolate-dark': (170273,), 'chocolate-milk': (167587,),
    'candies': (167587, 'молочний шоколад — найближче'), 'ice-cream': (167573,), 'jam': (169641,), 'condensed-milk': (171275,),
    'chicken-thigh-baked': (173625,), 'turkey-baked': (171496,), 'beef-stewed': (168667, 'тушкована лопатка, жир перераховано'),
    'pork-baked': (167821,), 'chicken-liver-stewed': (171061,), 'hake-baked': (175161, 'мерланг (whiting) — близький вид'),
    'salmon-baked': (175168,), 'mackerel-baked': (175120,), 'shrimp': (175180,), 'crab-sticks': (174203,), 'bacon': (167914,),
    'salo': (167811, 'сире несолоне сало: натрію не беремо — наше солоне', ['sodiumMg']),
    'egg-fried': (173423,), 'quail-eggs': (172191,), 'ryazhanka': (171265, 'молоко 3,25 % — найближче, жир перераховано'),
    'greek-yogurt': (170903,), 'cottage-cheese-0': (168114, 'сир без доданої солі, жир перераховано'),
    'cottage-cheese-9': (168114, 'сир без доданої солі, жир перераховано'), 'mozzarella': (170845,), 'feta': (173420,),
    'processed-cheese': (171290, 'плавлений (American), жир перераховано'), 'cream-10': (171255, 'half and half (11,5 %)'),
    'coffee': (171890,), 'espresso': (171891,), 'coffee-milk': ([(171890, 0.4), (171267, 0.6)], 'кава 40 % + молоко 60 %'),
    'tea': (173227,), 'tea-sugar': ([(173227, 0.96), (169655, 0.04)], 'чай + 4 % цукру'),
    'coffee-sugar': ([(171890, 0.948), (169655, 0.052)], 'кава + 5 % цукру'), 'cocoa-milk': (171277,),
    'apple-juice': (173933,), 'cola': (174852,), 'beer': (168746,), 'wine-dry': (173190,), 'tangerine': (169105,),
    'grapefruit': (174673,), 'peach': (169928,), 'apricot': (171697,), 'plum': (169949,), 'grapes': (174683,),
    'watermelon': (167765,), 'melon': (169911, 'диня медова (honeydew)'), 'raspberry': (167755,), 'cherry': (173954,),
    'blackcurrant': (173963,), 'pomegranate': (169134,), 'persimmon': (169941,), 'apple-baked': (173929,),
    'dried-apricots': (173941,), 'prunes': (168162,), 'raisins': (168165,), 'dates': (171726,), 'cherry-tomato': (170457,),
    'radish': (169276,), 'celery': (169988,), 'eggplant-baked': (169229,), 'pumpkin-baked': (168449,),
    'green-beans': (169961,), 'green-peas': (170419,), 'corn-can': (169214,), 'mushrooms': (169251,),
    'potato-baked': (170033,), 'fries': (170698,), 'zucchini-baked': (169292,), 'green-onion': (170005,), 'olives': (169094,),
    'cashew': (170162,), 'hazelnut': (170581,), 'peanut': (172430,), 'sunflower-seeds': (170562,), 'flax-seeds': (169414,),
    'chia': (170554,), 'peanut-butter': (174266, 'із сіллю'), 'sesame': (170150,), 'ketchup': (168556,), 'mustard': (172234,),
    'soy-sauce': (174277,), 'tomato-paste': (170459, 'без доданої солі'), 'horseradish': (173472,), 'black-pepper': (170931,),
    'apple-vinegar': (173469,), 'pesto': (171579,), 'flax-oil': (167702,), 'pizza': (170317,), 'burger': (170693,),
}
# Харчоблок's products that have no base food (its own kcal/БЖВ stay; these add the four)
HARCH = {
    'Вода': (173647,), 'Пшоно': (169702,), 'Крупа манна': (173916,), 'Перлова крупа': (170284,),
    'Крупа ячна': (170284, 'перлова — та сама крупа, інший помел'), 'Білок яєчний': (172183,), 'Борошно пшеничне': (168894,),
    'Лимон': (167746,), 'Какао-порошок': (169593,), 'Сухарі білі': (174928,), 'Сік томатний': (170458, 'із сіллю'),
    'Ягоди заморожені': (168209, 'малина заморожена — найближче'), 'Желатин': (169599,), 'Гарбуз': (168448,),
    'Печінка яловича': (169451,), 'Судак': (175128, 'судак (walleye)'),
}

IDS = {'1008': 'kcal', '1003': 'protein', '1004': 'fat', '1005': 'carbs', '1093': 'sodiumMg', '1079': 'fiberG', '2000': 'sugarsG', '1258': 'satFatG'}

def load():
    need = {x for v in list(BASE.values()) + list(HARCH.values()) for x in ([v[0]] if isinstance(v[0], int) else [c for c, _ in v[0]])}
    rows = {i: {} for i in need}
    desc = {}
    for r in csv.DictReader(open(SR / 'food.csv', encoding='utf-8')):
        if int(r['fdc_id']) in need: desc[int(r['fdc_id'])] = r['description']
    for r in csv.DictReader(open(SR / 'food_nutrient.csv', encoding='utf-8')):
        i = int(r['fdc_id'])
        if i in rows and r['nutrient_id'] in IDS: rows[i][IDS[r['nutrient_id']]] = float(r['amount'])
    missing = need - set(desc)
    if missing: sys.exit(f'not in SR Legacy: {sorted(missing)}')
    return rows, desc

def ours_base():
    src = (ROOT / 'src/data/foods.ts').read_text(encoding='utf-8')
    out = {}
    for m in re.finditer(r"^  f\('([^']+)', '[^']+', ([0-9.]+), ([0-9.]+), ([0-9.]+), ([0-9.]+)", src, re.M):
        out[m.group(1)] = {'kcal': float(m.group(2)), 'protein': float(m.group(3)), 'fat': float(m.group(4)), 'carbs': float(m.group(5))}
    return out

def ours_harch():
    return {p['name']: {'kcal': p['kcal'], 'protein': p['protein'], 'fat': p['fat'], 'carbs': p['carbs']}
            for p in json.load(open(ROOT / 'src/data/harch/products.json', encoding='utf-8'))}

def source(spec, rows, desc):
    if isinstance(spec, int): return dict(rows[spec]), f'FDC {spec} · {desc[spec]}'
    mix = {}
    for k in IDS.values():
        if all(k in rows[c] for c, _ in spec): mix[k] = sum(rows[c][k] * s for c, s in spec)
    return mix, ' + '.join(f'FDC {c} × {s:g}' for c, s in spec)

def value(src, ours, skip):
    out = {}
    if 'sodiumMg' in src and 'sodiumMg' not in skip: out['sodiumMg'] = round(src['sodiumMg'])
    if 'satFatG' in src and 'satFatG' not in skip:
        f = src.get('fat', 0)
        out['satFatG'] = round(src['satFatG'] * (ours['fat'] / f) if f > 0 else src['satFatG'], 1)
    c = src.get('carbs', 0)
    ratio = ours['carbs'] / c if c > 0 else 1
    if not 0.5 <= ratio <= 2: ratio = 1
    for k in ('fiberG', 'sugarsG'):
        if k in src and k not in skip:
            v = src[k] * ratio
            if k == 'sugarsG': v = min(v, ours['carbs'])
            out[k] = round(v, 1)
    return out

def main():
    rows, desc = load()
    base, harch = ours_base(), ours_harch()
    unknown = sorted(set(base) - set(BASE))
    lines = [
        '// D188 — GENERATED by scripts/nutrient-sources.py from USDA FoodData Central, SR Legacy (2018); do not edit by hand.',
        '// Sodium, fibre, sugars and saturated fat per 100 g; every row names its source. A food that is not here, or a field',
        '// a row does not have, is unknown («не відомо») — never zero. The method is in the script\'s header.',
        "import type { Nutrients } from '../domain/types';",
        '',
        "export type Extra = Pick<Nutrients, 'sodiumMg' | 'fiberG' | 'sugarsG' | 'satFatG'>;",
        'export interface Sourced extends Extra { src: string; note?: string }',
        '',
        '/** By the base food\'s id. */',
        'export const BASE_EXTRA: Record<string, Sourced> = {',
    ]
    def row(key, spec, ours):
        fdc, note, skip = spec[0], (spec[1] if len(spec) > 1 else ''), (spec[2] if len(spec) > 2 else [])
        src, label = source(fdc, rows, desc)
        v = value(src, ours, skip)
        body = ', '.join(f'{k}: {v[k]:g}' for k in ('sodiumMg', 'fiberG', 'sugarsG', 'satFatG') if k in v)
        return f"  {json.dumps(key, ensure_ascii=False)}: {{ {body}, src: {json.dumps(label, ensure_ascii=False)}{', note: ' + json.dumps(note, ensure_ascii=False) if note else ''} }},"
    for k in base:
        if k in BASE: lines.append(row(k, BASE[k], base[k]))
    lines += ['};', '', "/** Харчоблок's products without a base food, by the product's name. */", 'export const HARCH_EXTRA: Record<string, Sourced> = {']
    for k in HARCH:
        if k not in harch: sys.exit(f'no Харчоблок product {k}')
        lines.append(row(k, HARCH[k], harch[k]))
    lines += ['};', '', f'/** Base foods with no honest match in the table — every field unknown ({len(unknown)}). */',
              f'export const NO_SOURCE: readonly string[] = {json.dumps(unknown, ensure_ascii=False)};', '']
    sys.stdout.write('\n'.join(lines))
    print(f'{len(BASE)} base rows, {len(HARCH)} Харчоблок rows, {len(unknown)} base foods unknown', file=sys.stderr)

main()
