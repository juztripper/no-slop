// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Verdict } from '../src/shared/contracts';
import type { Candidate } from '../src/content/adapters';
import { presentCandidate } from '../src/content/presentation';

const verdict: Verdict = { id: 'item', category: 'slop', confidence: 0.95, reasons: ['Low-quality evidence.'], signals: { lowQuality: 0.99, synthetic: 0.4, clickbait: 0.99 }, evidence: { text: true, thumbnail: false, destination: false }, model: 'test' };
function candidate(): Candidate {
  const element = document.querySelector('article')!;
  return { element, fingerprint: 'item', preserveContext: false, item: { id: 'item', title: '', text: 'Untrusted content.', kind: 'post', platform: 'generic' } };
}
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('presentation ownership and complete-unit coverage', () => {
  it('keeps hidden content hidden and restores the original surface and inert state', () => {
    document.body.innerHTML = '<article style="background-color: #080808; border-radius: 14px; overflow: hidden"><div>Visible content</div><div style="visibility: hidden">Hidden content</div><div inert="inert" style="visibility: collapse">Collapsed content</div></article>';
    const record = candidate();
    const original = record.element.outerHTML;
    const children = [...record.element.children] as HTMLElement[];
    const presentation = presentCandidate(record, verdict, { ...DEFAULT_SETTINGS, animations: false }, vi.fn());
    expect(children.map(child => child.style.visibility)).toEqual(['visible', 'hidden', 'collapse']);
    expect(children.every(child => child.hasAttribute('inert'))).toBe(true);
    const backdrop = record.element.querySelector<HTMLElement>('[data-no-slop-backdrop]')!;
    expect(backdrop.style.backgroundColor).toBe('rgb(8, 8, 8)');
    expect(backdrop.style.borderRadius).toBe('14px');
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    presentation.restore();
    expect(record.element.outerHTML).toBe(original);
    expect([...record.element.children]).toEqual(children);
  });

  it.each([
    ['rgb(8, 8, 8)', 'dark'],
    ['rgb(255, 255, 255)', 'light'],
  ])('matches the actual ancestor surface %s', (background, tone) => {
    document.body.innerHTML = `<main style="background: ${background}"><article><div>Visible content</div></article></main>`;
    const shadow = vi.spyOn(Element.prototype, 'attachShadow');
    presentCandidate(candidate(), verdict, { ...DEFAULT_SETTINGS, animations: false }, vi.fn());
    const root = shadow.mock.results[0].value as ShadowRoot;
    expect((root.host as HTMLElement).dataset.tone).toBe(tone);
    expect(root.querySelector('button')!.getAttribute('aria-description')).toContain(verdict.reasons[0]);
  });

  it.each([
    [true, false, true],
    [false, false, false],
    [true, true, false],
  ])('respects animation preference %s and reduced motion %s', (animations, reducedMotion, expected) => {
    document.body.innerHTML = '<article><div>Original content</div></article>';
    const shadow = vi.spyOn(Element.prototype, 'attachShadow');
    presentCandidate(candidate(), verdict, { ...DEFAULT_SETTINGS, animations }, vi.fn(), reducedMotion);
    const root = shadow.mock.results[0].value as ShadowRoot;
    expect(root.querySelector('.mask')!.classList.contains('animate')).toBe(expected);
  });

  it('covers direct text, SVG and a focusable root while leaving the mask explicitly visible', () => {
    document.body.innerHTML = '<article tabindex="0">Direct text<svg tabindex="0"><text>SVG content</text></svg><a href="/">Original link</a></article>';
    const record = candidate(); const original = record.element.innerHTML;
    const presentation = presentCandidate(record, verdict, { ...DEFAULT_SETTINGS, animations: false }, vi.fn());
    expect(record.element.style.visibility).toBe('hidden');
    expect(record.element.querySelector('svg')!.style.visibility).toBe('visible');
    expect(record.element.querySelector('svg')!.hasAttribute('inert')).toBe(true);
    expect(record.element.querySelector('a')!.hasAttribute('inert')).toBe(true);
    expect((record.element.querySelector('[data-no-slop-root]') as HTMLElement).style.visibility).toBe('visible');
    presentation.restore();
    expect(record.element.hasAttribute('style')).toBe(false);
    expect(record.element.innerHTML).toBe(original);
    expect(record.element.getAttribute('tabindex')).toBe('0');
  });

  it('preserves app layout updates made while a card is censored', () => {
    document.body.innerHTML = '<article style="width: 300px"><a href="/" style="color: red">Original link</a></article>';
    const record = candidate(); const child = record.element.querySelector('a')!;
    const presentation = presentCandidate(record, verdict, { ...DEFAULT_SETTINGS, animations: false }, vi.fn());
    record.element.style.width = '460px';
    record.element.style.transform = 'translateY(200px)';
    child.style.color = 'blue';
    presentation.restore();
    expect(record.element.style.width).toBe('460px');
    expect(record.element.style.transform).toBe('translateY(200px)');
    expect(record.element.style.visibility).toBe('');
    expect(record.element.style.isolation).toBe('');
    expect(child.style.color).toBe('blue');
    expect(child.style.visibility).toBe('');
  });

  it('does not overwrite a property the app changed after NO SLOP wrote it', () => {
    document.body.innerHTML = '<article style="display: flex">Original content</article>';
    const record = candidate();
    const presentation = presentCandidate(record, verdict, { ...DEFAULT_SETTINGS, mode: 'hide', animations: false }, vi.fn());
    record.element.style.setProperty('display', 'grid');
    record.element.style.height = '300px';
    presentation.restore();
    expect(record.element.style.display).toBe('grid');
    expect(record.element.style.height).toBe('300px');
  });

  it('Show does not trigger the original card click and returns keyboard focus to restored controls', () => {
    document.body.innerHTML = '<article><a href="/">Original link</a></article>';
    const shadow = vi.spyOn(Element.prototype, 'attachShadow');
    const record = candidate(); const cardClick = vi.fn(); record.element.addEventListener('click', cardClick);
    const reveal = vi.fn();
    presentCandidate(record, verdict, { ...DEFAULT_SETTINGS, animations: false }, reveal);
    const root = shadow.mock.results[0].value as ShadowRoot;
    const button = root.querySelector('button')!;
    button.focus();
    button.click();
    expect(cardClick).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(record.element.querySelector('a'));
  });
});
