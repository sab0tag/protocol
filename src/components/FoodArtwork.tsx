const FOOD_ARTWORK = [
  { words: ['яйц', 'омлет'], image: '🍳', color: 'bg-amber-500/10' },
  { words: ['кур', 'індич', 'котлет', 'м’яс', 'мяс'], image: '🍗', color: 'bg-orange-500/10' },
  { words: ['риб', 'хек', 'лосос'], image: '🐟', color: 'bg-sky-500/10' },
  { words: ['салат', 'огір', 'помід', 'брокол', 'овоч'], image: '🥗', color: 'bg-emerald-500/10' },
  { words: ['рис', 'греч', 'вівсян', 'каша', 'булгур'], image: '🍚', color: 'bg-yellow-500/10' },
  { words: ['молок', 'кефір', 'йогур', 'сир', 'творог'], image: '🥛', color: 'bg-blue-500/10' },
  { words: ['яблук', 'банан', 'ягод', 'фрукт'], image: '🍎', color: 'bg-rose-500/10' },
  { words: ['суп', 'борщ', 'юшк'], image: '🍲', color: 'bg-red-500/10' },
  { words: ['хліб', 'лаваш', 'сендвіч', 'бутерброд'], image: '🥪', color: 'bg-orange-500/10' },
] as const;

function artworkFor(name: string) {
  const normalized = name.toLocaleLowerCase('uk');
  return FOOD_ARTWORK.find(({ words }) => words.some((word) => normalized.includes(word)));
}

export function FoodArtwork({ name }: { name: string }) {
  const artwork = artworkFor(name);
  return (
    <span aria-hidden="true" className={`protocol-food-artwork flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${artwork?.color ?? 'bg-accent/10'}`}>
      <span className="text-3xl leading-none">{artwork?.image ?? '🍽️'}</span>
    </span>
  );
}
