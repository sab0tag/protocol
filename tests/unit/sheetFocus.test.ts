import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement as h, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sheet } from '../../src/components/Sheet';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const mount = () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host); return root;
};
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); });
const sheet = (title: string, children = h('p', null, 'Details')) => h(Sheet, { key: title, title, onClose: () => {}, children });

describe('Sheet lifecycle', () => {
  it('does not reset focus or a draft when the parent supplies a new close callback', async () => {
    const r = mount();
    const content = () => h('div', null, h('input', { 'aria-label': 'First' }), h('input', { 'aria-label': 'Draft' }));
    await act(async () => r.render(h(Sheet, { title: 'Editor', onClose: () => {}, children: content() })));
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!;
    act(() => { input.focus(); input.value = 'Keep this text'; });
    await act(async () => r.render(h(Sheet, { title: 'Editor', onClose: () => {}, children: content() })));
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Keep this text');
  });

  it('keeps the background inert until the last stacked sheet closes', async () => {
    const background = document.createElement('button'); document.body.append(background);
    const r = mount();
    await act(async () => r.render(h(Fragment, null, sheet('First'), sheet('Second'))));
    const first = document.querySelector<HTMLElement>('[role="dialog"][aria-label="First"]')!;
    const second = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Second"]')!;
    expect(background.inert).toBe(true);
    expect(first.parentElement!.inert).toBe(true);
    expect(second.parentElement!.inert).toBeFalsy();
    await act(async () => r.render(h(Fragment, null, sheet('First'))));
    expect(first.parentElement!.inert).toBeFalsy();
    expect(background.inert).toBe(true);
    await act(async () => r.unmount()); root = undefined;
    expect(background.inert).toBeFalsy();
  });

  it('preserves a pre-existing inert state after cleanup', async () => {
    const background = document.createElement('div'); background.inert = true; document.body.append(background);
    const r = mount();
    await act(async () => r.render(sheet('Read')));
    await act(async () => r.unmount()); root = undefined;
    expect(background.inert).toBe(true);
  });
});
