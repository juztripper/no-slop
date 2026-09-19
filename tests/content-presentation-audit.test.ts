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
  it('covers direct text, SVG and a focusable root while leaving the mask explicitly visible', () => {
    document.body.innerHTML = '<article tabindex="0">Direct text<svg tabindex="0"><text>SVG content</text></svg><a href="/">Original link</a></article>';
    const record = candidate(); const original = record.element.innerHTML;
    const presentation = presentCandidate(record, verdict, { ...DEFAULT_SETTINGS, animations: false }, vi.fn());
    expect(record.element.style.visibility).toBe('hidden');
    expect(record.element.querySelector('svg')!.style.visibility).toBe('hidden');
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
