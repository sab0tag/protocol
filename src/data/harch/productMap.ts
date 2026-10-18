// D90: Харчоблок's products (raw, as weighed for a dish card) → Протокол's foods, so a dish's ingredients carry this
// base's calcium, allergens and tags. Raw to raw: «Гречка» in a card is the dry grain, not «Гречка варена». null — no food
// here of that kind; such a line keeps Харчоблок's own numbers. Checked by hand 18.10.2026; a test keeps it complete.
export const HARCH_PRODUCT: Record<string, string | null> = {
  'Пластівці вівсяні': 'oats', 'Молоко 2.5%': 'milk', 'Масло вершкове': 'butter', 'Цукор': 'sugar', 'Сіль': 'salt', 'Вода': null,
  'Гречка': 'buckwheat', 'Рис': 'white-rice', 'Пшоно': null, 'Крупа манна': null, 'Перлова крупа': null, 'Крупа ячна': null,
  'Яйце куряче': 'egg', 'Білок яєчний': null, 'Сир твердий': 'hard-cheese', 'Сир кисломолочний 9%': 'cottage-cheese-9',
  'Борошно пшеничне': null, 'Сметана 15%': 'sour-cream', 'Олія соняшникова': 'sunflower-oil', 'Сир кисломолочний нежирний': 'cottage-cheese-0',
  'Цукрозамінник': null, 'Чай чорний': 'tea', 'Лимон': null, 'Какао-порошок': null, 'Шипшина суха': null,
  'Хліб білий': 'bread-white', 'Хліб житній': 'bread-rye', 'Хліб білий підсушений': 'bread-white', 'Хліб з отрубями': 'bread-wholegrain',
  'Сухарі білі': null, 'Яблука': 'apple', 'Банани': 'banana', 'Апельсини': 'orange', 'Груші': 'pear',
  'Кефір 2.5%': 'kefir', 'Кефір 1%': 'kefir-1', 'Йогурт натуральний': 'yogurt-plain', 'Ряжанка 2.5%': 'ryazhanka',
  'Сік яблучний': 'apple-juice', 'Сік томатний': null, 'Ягоди заморожені': null, 'Крохмаль картопляний': null,
  'Печиво галетне': null, 'Печиво дієтичне': null, 'Желатин': null, 'Буряк': 'beet', 'Капуста білокачанна': 'cabbage',
  'Картопля': 'potato-raw', 'Морква': 'carrot', 'Цибуля ріпчаста': 'onion', 'Томатна паста': 'tomato-paste',
  'Яловичина': 'beef-lean', 'Курятина': 'chicken-breast', 'Вермішель': 'pasta-dry', 'Гарбуз': null, 'Вершки 10%': 'cream-10',
  'Броколі': 'broccoli', 'Кабачки': 'zucchini', 'Зелень': 'herbs', 'Помідори': 'tomato', 'Філе куряче': 'chicken-breast',
  'Хек': 'hake', 'Мінтай': 'pollock', 'Печінка яловича': null, 'Судак': null, 'Індичка': 'turkey', 'Макаронні вироби': 'pasta-dry',
  'Цвітна капуста': 'cauliflower', 'Огірки свіжі': 'cucumber', 'Сухофрукти': null, 'Родзинки': 'raisins', 'Яловичина нежирна': 'beef-lean',
};
