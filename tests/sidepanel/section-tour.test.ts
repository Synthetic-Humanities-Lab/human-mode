// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSectionTour } from '../../src/sidepanel/section-tour';

describe('tutorial budget example', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('uses the current search price and restores the actual budget when closed', () => {
    document.body.innerHTML = new DOMParser().parseFromString(readFileSync('src/sidepanel/sidepanel.html', 'utf8'), 'text/html').body.innerHTML;
    vi.stubGlobal('ResizeObserver', class { observe() {} });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    document.getElementById('assignedTaskSection')!.scrollIntoView = vi.fn();
    const dialog = document.getElementById('tutorialDialog') as HTMLDialogElement;
    dialog.show = () => dialog.setAttribute('open', '');
    dialog.close = () => { dialog.removeAttribute('open'); dialog.dispatchEvent(new Event('close')); };
    const remaining = document.getElementById('budgetRemaining')!;
    const meta = document.getElementById('budgetMeta')!;
    const fill = document.getElementById('budgetFill')!;
    remaining.textContent = '$8.583';
    meta.textContent = 'Spent · Actions $0.40 · Text $0.017 · Capacity $1.00';
    fill.style.width = '14.17%';
    const beforeOpen = vi.fn();
    const afterClose = vi.fn();
    initSectionTour(beforeOpen, afterClose);
    document.getElementById('openTutorialBtn')!.click();
    expect(beforeOpen).toHaveBeenCalledOnce();
    expect(remaining.textContent).toBe('$9.90');
    expect(meta.textContent).toBe('Spent · Actions $0.10 · Text $0.00 · Capacity $0.00');
    expect(fill.style.width).toBe('1%');
    document.getElementById('exitTutorialBtn')!.click();
    expect(afterClose).toHaveBeenCalledOnce();
    expect(remaining.textContent).toBe('$8.583');
    expect(meta.textContent).toBe('Spent · Actions $0.40 · Text $0.017 · Capacity $1.00');
    expect(fill.style.width).toBe('14.17%');
  });
});
