// Shared Sheet focus lifecycle; background state belongs to the topmost sheet in this document.
interface FocusState { stack: HTMLElement[]; inert: Map<HTMLElement, boolean>; pending?: { opener: HTMLElement | null } }
const documents = new WeakMap<Document, FocusState>();
const selector = 'button, input:not([type="hidden"]), select, textarea, a[href], summary, [tabindex], [contenteditable="true"]';

function usable(element: HTMLElement): boolean {
  return !element.matches(':disabled') && !element.closest('[inert], [hidden]') && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden';
}
function stops(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(selector)].filter(element =>
    !element.hasAttribute('data-sheet-focus-guard') && element.tabIndex >= 0 && usable(element));
}
export function focusSheet(panel: HTMLElement | null, last = false) {
  if (!panel) return;
  const elements = stops(panel);
  (last ? elements.at(-1) : elements[0])?.focus();
  if (!elements.length) panel.querySelector<HTMLElement>('[data-sheet-title]')?.focus();
}
function background(state: FocusState) {
  for (const [element, previous] of state.inert) element.inert = previous;
  state.inert.clear();
  let branch: HTMLElement | undefined = state.stack.at(-1);
  while (branch && branch !== branch.ownerDocument.body && branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        state.inert.set(sibling, sibling.inert); sibling.inert = true;
      }
    }
    branch = branch.parentElement;
  }
}

export function activateSheet(panel: HTMLElement, close: () => void): () => void {
  const doc = panel.ownerDocument;
  const state: FocusState = documents.get(doc) ?? { stack: [], inert: new Map<HTMLElement, boolean>() };
  documents.set(doc, state);
  const active = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const opener = active && active !== doc.body && !active.closest('[inert]') ? active : state.pending?.opener ?? active;
  let lastFocused: HTMLElement | null = null;
  state.stack.push(panel); background(state);
  const top = () => state.stack.at(-1) === panel;
  const onFocus = (event: FocusEvent) => {
    if (!top()) return;
    const target = event.target;
    if (target instanceof HTMLElement && panel.contains(target)) {
      if (!target.hasAttribute('data-sheet-focus-guard')) lastFocused = target;
    } else if (lastFocused?.isConnected && usable(lastFocused)) lastFocused.focus();
    else focusSheet(panel);
  };
  const onKey = (event: KeyboardEvent) => {
    if (top() && event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  };
  doc.addEventListener('focusin', onFocus, true);
  doc.addEventListener('keydown', onKey);
  const body = panel.querySelector<HTMLElement>('[data-body]');
  const first = body ? stops(body)[0] : undefined;
  const bounds = panel.getBoundingClientRect(), position = first?.getBoundingClientRect();
  if (first && position && position.top >= bounds.top && position.bottom <= bounds.bottom) first.focus({ preventScroll: true });
  else panel.querySelector<HTMLElement>('[data-sheet-title]')?.focus({ preventScroll: true });
  return () => {
    doc.removeEventListener('focusin', onFocus, true); doc.removeEventListener('keydown', onKey);
    const wasTop = top(), index = state.stack.indexOf(panel);
    if (index >= 0) state.stack.splice(index, 1);
    background(state);
    const next = state.stack.at(-1);
    const pending = { opener };
    if (wasTop) { state.pending = pending; queueMicrotask(() => {
      // A replacement sheet may already have opened during the same React update.
      if (state.pending === pending) delete state.pending;
      if (state.stack.at(-1) !== next) return;
      if (opener?.isConnected && usable(opener) && (!next || next.contains(opener))) opener.focus();
      else if (next) focusSheet(next);
    }); }
  };
}
