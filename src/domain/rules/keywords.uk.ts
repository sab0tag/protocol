// Keyword stems for the dish check (SPEC.md §6.1 and decisions Q1–Q3). Matched at the start of a word
// in the normalised name (lower case, no apostrophes), so «молок» does not catch «кисломолочний».

/** High-oxalate: «Замінити». Nuts and seeds only above NUTS_OXALATE_G. */
export const OXALATE_HIGH = ['шпинат', 'щавел', 'буряк', 'бурак', 'ревін', 'мангольд'];
export const OXALATE_NUTS = ['мигдал', 'кунжут'];
export const NUTS_OXALATE_G = 30;
/** Q1: moderately oxalate — only the «add calcium to this meal» advice, never «Замінити». */
export const OXALATE_MODERATE = ['помідор', 'томат', 'картопл', 'морква', 'какао', 'горіх', 'шоколад'];
/** A calcium source in the meal (besides foods tagged `calcium`). */
export const CALCIUM_SOURCES = ['сир твердий', 'пармезан', 'grana', 'кефір', 'сардин', 'йогурт', 'бринз'];

export const GALLBLADDER = ['смажен', 'майонез', 'вершковий соус', 'сало', 'фрі', 'чебурек', 'бекон'];

export const LACTOSE = ['молоко', 'молочн', 'вершки', 'мякий сир', 'кисломолочний сир', 'кисломолочним сир', 'сир кисломолочний', 'творог', 'рікот', 'моцарел',
  'молоці', 'сирник', 'сирок', 'морозив', 'згущ', 'плавлен', 'лате', 'капучино']; // D45: the bigger base

/** Q3: fast carbs — «Замінити» (has a slow-carb counterpart) or «Прибрати» (nothing to keep). */
export const GLYCEMIC_REPLACE = ['пюре', 'білий хліб', 'батон', 'білий рис', 'рис білий', 'вермішел', 'макарон'];
export const GLYCEMIC_REMOVE = ['булк', 'булоч', 'цукор', 'джем', 'варення', 'мед', 'сік', 'солодк напій', 'газован', 'кола', 'лимонад', 'круасан', 'печиво', 'торт',
  'вафл', 'цукерк', 'морозив', 'компот', 'згущ', 'глазурован', 'фінік', 'родзинк']; // D45

export const LIVER = ['печінк', 'печінь'];
export const LIVER_MAX_G = 120;
export const LIVER_EVERY_DAYS = 7;

/** Q2: one portion of salty foods = SODIUM_PORTION_G; more than SODIUM_MAX_PORTIONS a day is «Багато солі». */
export const SALTY = ['соління', 'солоні огірки', 'солоний огірок', 'кімчі', 'квашена капуста', 'ковбас', 'сосиск', 'сардельк', 'шинк', 'бекон', 'оселедець',
  'копчен', 'шпрот', 'соєвий соус', 'оливк', 'маслин', 'фета']; // D45
export const SODIUM_PORTION_G = 50;
export const SODIUM_MAX_PORTIONS = 2;

/** «Записати заміну» to a dry grain when the replaced item's carbs are unknown. */
export const DEFAULT_GRAIN_PORTION_G = 60;
