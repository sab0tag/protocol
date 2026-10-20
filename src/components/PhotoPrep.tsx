// D112 (step 0, part 4): before a doctor's paper leaves the phone, the person cuts it and paints over what is theirs —
// the name, the date of birth, the card number. The header, where these usually are, comes painted over already (it can be
// taken off); a finger drags a new black box; two sliders cut the top and the bottom. Only the result is sent; the pieces
// of paper shown beside the lines later are cut from it too, as the person left it.
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { t } from '../i18n/uk';
import { redact, type Box } from '../sync/shrink';

const L = t.conclusion.prep;
/** Where a form's header with the person's name and date of birth usually is — suggested, never assumed. */
export const HEADER: Box = { x: 0, y: 0, w: 1, h: 0.2 };
interface Page { src: string; crop: { top: number; bottom: number }; boxes: Box[] }

export function PhotoPrep({ pages: given, onDone, onCancel }: { pages: string[]; onDone: (pages: string[]) => void; onCancel: () => void }) {
  const [pages, setPages] = useState<Page[]>(() => given.map((src) => ({ src, crop: { top: 0, bottom: 0 }, boxes: [HEADER] })));
  const [at, setAt] = useState(0);
  const [drag, setDrag] = useState<Box | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const p = pages[at]!;
  const url = useMemo(() => `data:image/jpeg;base64,${p.src}`, [p.src]);
  const put = (fn: (x: Page) => Page) => setPages((ps) => ps.map((x, i) => (i === at ? fn(x) : x)));

  const point = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const boxOf = (a: { x: number; y: number }, b: { x: number; y: number }): Box =>
    ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const send = async () => {
    setBusy(true);
    try { onDone(await Promise.all(pages.map((x) => redact(x.src, x.crop, x.boxes)))); } finally { setBusy(false); }
  };

  return (
    <section aria-label={L.title} className="space-y-2">
      <p className="font-medium">{L.title}</p>
      <p className="text-sm text-muted">{L.hint}</p>
      {pages.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <button type="button" disabled={at === 0} onClick={() => setAt(at - 1)} aria-label={L.prev} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line disabled:opacity-40"><ChevronLeft size={18} aria-hidden /></button>
          <span>{L.page(at + 1, pages.length)}</span>
          <button type="button" disabled={at === pages.length - 1} onClick={() => setAt(at + 1)} aria-label={L.next} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line disabled:opacity-40"><ChevronRight size={18} aria-hidden /></button>
        </div>
      )}
      <div ref={area} data-page={at + 1} className="relative touch-none select-none overflow-hidden rounded-lg border border-line"
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; start.current = point(e); area.current!.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (start.current) setDrag(boxOf(start.current, point(e))); }}
        onPointerUp={(e) => {
          const b = start.current ? boxOf(start.current, point(e)) : null;
          start.current = null; setDrag(null);
          if (b && b.w > 0.02 && b.h > 0.01) put((x) => ({ ...x, boxes: [...x.boxes, b] }));
        }}>
        <img src={url} alt={L.alt(at + 1)} className="block w-full" draggable={false} />
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-bg/80" style={{ height: `${p.crop.top * 100}%` }} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-bg/80" style={{ height: `${p.crop.bottom * 100}%` }} />
        {p.boxes.map((b, i) => (
          <div key={i} data-box className="absolute bg-black" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
            <button type="button" onClick={() => put((x) => ({ ...x, boxes: x.boxes.filter((_, j) => j !== i) }))} aria-label={b === HEADER ? L.removeHeader : L.removeBox}
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-surface text-ink"><X size={14} aria-hidden /></button>
            {b === HEADER && <span className="pointer-events-none absolute bottom-1 left-2 right-10 text-xs text-white">{L.headerNote}</span>}
          </div>
        ))}
        {drag && <div className="pointer-events-none absolute border-2 border-warn bg-black/60" style={{ left: `${drag.x * 100}%`, top: `${drag.y * 100}%`, width: `${drag.w * 100}%`, height: `${drag.h * 100}%` }} />}
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>{L.cutTop}<input type="range" min={0} max={0.6} step={0.01} value={p.crop.top} onChange={(e) => put((x) => ({ ...x, crop: { ...x.crop, top: Number(e.target.value) } }))} className="block w-full" /></label>
        <label>{L.cutBottom}<input type="range" min={0} max={0.6} step={0.01} value={p.crop.bottom} onChange={(e) => put((x) => ({ ...x, crop: { ...x.crop, bottom: Number(e.target.value) } }))} className="block w-full" /></label>
      </div>
      {!p.boxes.includes(HEADER) && <button type="button" onClick={() => put((x) => ({ ...x, boxes: [HEADER, ...x.boxes] }))} className="min-h-tap text-sm text-accent underline">{L.addHeader}</button>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void send()} className="min-h-tap rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{L.send(pages.length)}</button>
        <button type="button" onClick={onCancel} className="min-h-tap rounded-xl border border-line px-4">{t.meal.cancel}</button>
      </div>
    </section>
  );
}
