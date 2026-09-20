import type { Settings, Verdict } from '../shared/contracts';
import type { Candidate } from './adapters';

export interface Presentation { restore(): void; element: HTMLElement; mode: 'hide' | 'censor' | 'annotation'; }

const BASE_CSS = `
:host {
  all:initial;
  box-sizing:border-box!important;
  color-scheme:light!important;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif!important;
  font-size:12px!important;
  font-weight:400!important;
  line-height:1.5!important;
  text-align:left!important;
  --ink:#202020;
  --muted:#646464;
  --surface:rgba(255,255,255,.94);
  --edge:rgba(32,32,32,.12);
  --red:#bd3049;
  --wash:rgba(255,255,255,.08);
  --button:#202020;
  --button-ink:#fff;
}
:host([data-tone="dark"]) {
  color-scheme:dark!important;
  --ink:#f5f5f5;
  --muted:#c4c4c4;
  --surface:rgba(28,28,28,.94);
  --edge:rgba(255,255,255,.18);
  --red:#ffb4c0;
  --wash:rgba(0,0,0,.12);
  --button:#f5f5f5;
  --button-ink:#202020;
}
* { box-sizing:border-box; }
button {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  flex-shrink:0;
  font:inherit;
  font-weight:500;
  line-height:1;
  cursor:pointer;
  border:1px solid transparent;
  border-radius:999px;
  padding:8px 12px;
  min-height:32px;
  background:var(--button);
  color:var(--button-ink);
}
button:hover { opacity:.85; }
button:focus-visible { outline:2px solid var(--ink); outline-offset:3px; }
button svg { display:block; flex-shrink:0; width:14px; height:14px; }
.mask {
  position:absolute;
  inset:0;
  display:grid;
  grid-template-columns:minmax(0,1fr);
  grid-template-rows:minmax(0,1fr);
  place-items:center;
  padding:clamp(6px,4cqi,20px);
  overflow:hidden;
  border-radius:inherit;
  background:var(--wash);
  backdrop-filter:blur(10px) saturate(.7);
  -webkit-backdrop-filter:blur(10px) saturate(.7);
  color:var(--ink);
}
.treatment {
  display:grid;
  justify-items:center;
  gap:10px;
  width:max-content;
  max-width:min(100%,300px);
  min-width:0;
  padding:16px 18px;
  border:1px solid var(--edge);
  border-radius:16px;
  background:var(--surface);
  box-shadow:0 2px 12px #0000000d;
  text-align:center;
}
.stamp {
  display:inline-block;
  flex-shrink:0;
  color:var(--red);
  border:1.5px solid currentColor;
  border-radius:3px;
  font-size:11px;
  font-weight:800;
  letter-spacing:-.25px;
  padding:3px 5px;
  line-height:1.15;
  transform:rotate(-4deg);
  white-space:nowrap;
}
.copy { display:grid; gap:4px; min-width:0; max-width:100%; }
.label { font-size:13px; line-height:1.4; font-weight:600; overflow-wrap:anywhere; }
.reason {
  font-size:12px;
  color:var(--muted);
  line-height:1.5;
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
  overflow-wrap:anywhere;
}
/* Respond to the card, including changes after insertion — not the viewport. */
@container no-slop-censor (max-height: 220px) {
  .treatment { grid-template-columns:auto minmax(0,1fr) auto; gap:12px; padding:10px 12px; max-width:min(100%,440px); border-radius:12px; text-align:left; align-items:center; }
  .reason { -webkit-line-clamp:1; font-size:11px; }
  .label { font-size:12px; }
}
@container no-slop-censor (max-width: 280px) {
  .mask { padding:8px; }
  .treatment { padding:12px; gap:8px; max-width:100%; }
  .label { font-size:12px; }
  .reason { font-size:11px; }
}
@container no-slop-censor (max-height: 120px) or ((max-width: 360px) and (max-height: 220px)) {
  .treatment { display:flex; justify-content:center; gap:12px; padding:8px 10px; border-radius:999px; }
  .copy { display:none; }
}
@container no-slop-censor (max-width: 180px) {
  .mask { padding:4px; }
  .treatment { display:flex; justify-content:center; gap:6px; padding:6px; border-radius:999px; }
  .stamp,.copy { display:none; }
}
@container no-slop-censor (max-height: 48px) {
  .mask { padding:2px; }
  .treatment { display:flex; justify-content:center; gap:8px; padding:2px 6px; border-radius:999px; }
  .copy { display:none; }
  button { min-height:26px; padding:5px 8px; font-size:11px; }
  .stamp { font-size:10px; padding:2px 4px; }
}
@container no-slop-censor (max-width: 80px) or (max-height: 30px) {
  .stamp,.button-label { display:none; }
  .treatment { padding:0; border:0; background:transparent; box-shadow:none; }
  button { min-height:22px; width:26px; padding:3px; }
}
.annotation {
  display:flex; align-items:flex-start; gap:8px; margin:6px 0 10px; padding:8px 10px;
  border:1px solid var(--edge); border-left:2px solid var(--red); border-radius:4px;
  background:var(--surface); color:var(--muted); font-size:12px;
}
.annotation strong { font-weight:600; color:var(--red); }
.annotation details { flex:1; min-width:0; }
.annotation summary { cursor:pointer; list-style:none; }
.annotation summary::-webkit-details-marker { display:none; }
.annotation summary:hover { color:var(--ink); }
.annotation summary:focus-visible { outline:2px solid var(--ink); outline-offset:2px; }
.annotation p { margin:8px 0 2px; line-height:1.55; }
.annotation button { font-size:12px; min-height:28px; padding:3px 8px; }
.evidence { font-size:11px; line-height:1.5; color:var(--muted); margin-top:8px; }
@keyframes soften {
  from { backdrop-filter:blur(0) saturate(1); -webkit-backdrop-filter:blur(0) saturate(1); }
  to { backdrop-filter:blur(10px) saturate(.7); -webkit-backdrop-filter:blur(10px) saturate(.7); }
}
@keyframes settle {
  from { opacity:0; transform:translateY(3px) scale(.98); }
  to { opacity:1; transform:translateY(0) scale(1); }
}
@keyframes stamp {
  from { opacity:0; transform:rotate(-7deg) scale(1.08); }
  to { opacity:1; transform:rotate(-4deg) scale(1); }
}
.animate { animation:soften 240ms ease-out both; }
.animate .treatment { animation:settle 200ms ease-out both; }
.animate .stamp { animation:stamp 240ms cubic-bezier(.2,.7,.2,1) both; }
@media(prefers-reduced-motion:reduce) {
  *,*::before,*::after { animation:none!important; transition:none!important; }
}
`;

/** Restore only our properties. Virtualized feeds can update other inline styles
 * while a card is covered; restoring a whole attribute would discard those writes. */
function ownStyles(element: HTMLElement | SVGElement) {
  const originalAttribute = element.getAttribute('style');
  const originalCss = element.style.cssText;
  const changes = new Map<string, { original: string; priority: string; value: string; writtenPriority: string }>();
  return {
    set(property: string, value: string, priority = 'important') {
      const previous = changes.get(property);
      const original = previous?.original ?? element.style.getPropertyValue(property);
      const originalPriority = previous?.priority ?? element.style.getPropertyPriority(property);
      element.style.setProperty(property, value, priority);
      changes.set(property, { original, priority: originalPriority, value: element.style.getPropertyValue(property), writtenPriority: element.style.getPropertyPriority(property) });
    },
    restore() {
      for (const [property, change] of changes) {
        // If the application has since changed this property, its latest value wins.
        if (element.style.getPropertyValue(property) !== change.value || element.style.getPropertyPriority(property) !== change.writtenPriority) continue;
        if (change.original) element.style.setProperty(property, change.original, change.priority);
        else element.style.removeProperty(property);
      }
      // Preserve exact initial markup when no application styles changed.
      if (element.style.cssText === originalCss) {
        if (originalAttribute === null) element.removeAttribute('style');
        else element.setAttribute('style', originalAttribute);
      }
    },
  };
}

function createHost(doc: Document): {host: HTMLElement; root: ShadowRoot} {
  const host = doc.createElement('span');
  host.dataset.noSlopRoot = '';
  const root = host.attachShadow({ mode: 'closed' });
  // Do not let a card's delegated click/keyboard handlers treat extension controls
  // as engagement with the original post or video.
  for (const type of ['click', 'pointerdown', 'keydown', 'keyup']) host.addEventListener(type, event => event.stopPropagation());
  const style = doc.createElement('style');
  style.textContent = BASE_CSS;
  root.append(style);
  return { host, root };
}

function evidenceText(verdict: Verdict): string {
  const evidence = [verdict.evidence.text && 'text', verdict.evidence.thumbnail && 'thumbnail', verdict.evidence.destination && 'destination page'].filter(Boolean).join(', ');
  return `Assessed ${evidence || 'available content'} · ${Math.round(verdict.confidence * 100)}% model score. This is a quality judgment, not proof of authorship.`;
}

/** Match the actual page surface, which may differ from the OS color scheme. */
function surfaceTone(element: HTMLElement): 'light' | 'dark' {
  const win = element.ownerDocument.defaultView;
  if (!win) return 'light';
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const color = win.getComputedStyle(ancestor).backgroundColor;
    if (!color.startsWith('rgb')) continue;
    const channels = color.match(/[\d.]+/g)?.map(Number);
    if (!channels || channels.length < 3 || (channels[3] ?? 1) < .6) continue;
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 < 128 ? 'dark' : 'light';
  }
  const foreground = win.getComputedStyle(element).color.match(/[\d.]+/g)?.map(Number);
  if (foreground && foreground.length >= 3) return foreground[0] * .2126 + foreground[1] * .7152 + foreground[2] * .0722 > 160 ? 'dark' : 'light';
  return 'light';
}

export function presentCandidate(candidate: Candidate, verdict: Verdict, settings: Settings, onReveal: () => void, reducedMotion = false): Presentation {
  const element = candidate.element;
  const doc = element.ownerDocument;
  const restores: (() => void)[] = [];
  let animation: Animation | undefined;
  let host: HTMLElement | undefined;
  let restored = false;
  const mode = candidate.preserveContext ? 'annotation' : settings.mode;
  const restore = () => {
    if (restored) return;
    restored = true;
    animation?.cancel();
    host?.remove();
    for (const action of restores.reverse()) action();
  };
  const reveal = () => { restore(); onReveal(); };
  const reason = verdict.reasons[0] ?? 'This item met your low-quality filtering threshold.';

  if (mode === 'hide') {
    const styles = ownStyles(element);
    restores.push(styles.restore);
    const hide = () => { if (!restored) styles.set('display', 'none'); };
    if (settings.animations && !reducedMotion && typeof element.animate === 'function') {
      const height = element.getBoundingClientRect().height;
      styles.set('overflow', 'hidden');
      animation = element.animate([
        { opacity: 1, maxHeight: `${height}px`, transform: 'scale(1)' },
        { opacity: 0, maxHeight: '0px', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', transform: 'scale(.985)' },
      ], { duration: 240, easing: 'cubic-bezier(.2,.65,.2,1)', fill: 'forwards' });
      void animation.finished.then(hide).catch(() => { /* Restoring cancels the animation. */ });
    } else hide();
    return { element, mode, restore };
  }

  const surface = createHost(doc);
  host = surface.host;
  host.dataset.tone = surfaceTone(element);
  const button = doc.createElement('button');
  button.type = 'button';
  if (mode === 'annotation') button.textContent = 'Dismiss';
  else {
    const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.8');
    icon.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(icon.namespaceURI, 'path');
    path.setAttribute('d', 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
    icon.append(path);
    const text = doc.createElement('span');
    text.className = 'button-label';
    text.textContent = 'Show';
    button.append(icon, text);
  }
  button.setAttribute('aria-label', mode === 'annotation' ? 'Dismiss this NO SLOP quality note' : 'Show original content');
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const hadFocus = doc.activeElement === host;
    reveal();
    if (hadFocus) {
      const focusable = element.matches('a[href],button,input,select,textarea,[tabindex]') ? element : element.querySelector<HTMLElement>('a[href],button,input,select,textarea,[tabindex]');
      focusable?.focus({ preventScroll: true });
    }
  });

  if (mode === 'annotation') {
    host.style.setProperty('display', 'block', 'important');
    const wrapper = doc.createElement('div');
    wrapper.className = 'annotation';
    const details = doc.createElement('details');
    const summary = doc.createElement('summary');
    const label = doc.createElement('strong');
    label.textContent = 'Quality note';
    summary.append(label, doc.createTextNode(' · NO SLOP flagged this passage.'));
    const explanation = doc.createElement('p');
    explanation.textContent = `${reason} Kept visible to preserve the surrounding context.`;
    const evidence = doc.createElement('div');
    evidence.className = 'evidence';
    evidence.textContent = evidenceText(verdict);
    details.append(summary, explanation, evidence);
    wrapper.append(details, button);
    surface.root.append(wrapper);
    element.after(host);
  } else {
    const styles = ownStyles(element);
    restores.push(styles.restore);
    const computed = doc.defaultView?.getComputedStyle(element);
    const children = [...element.children].filter((child): child is HTMLElement | SVGElement => child instanceof HTMLElement || child instanceof SVGElement)
      .map(child => ({ child, visible: doc.defaultView?.getComputedStyle(child).visibility !== 'hidden' && doc.defaultView?.getComputedStyle(child).visibility !== 'collapse' }));
    if (computed?.position === 'static' || !computed?.position) styles.set('position', 'relative');
    styles.set('isolation', 'isolate');
    styles.set('overflow', 'clip');
    // Hide direct text, pseudo-elements and focusable roots. Structured children
    // remain painted underneath the blur, but inert keeps them out of interaction
    // and the accessibility tree. Never reparent or clone framework-owned nodes.
    styles.set('visibility', 'hidden');
    // Preserve the card's original surface behind its visible children. Hiding
    // the root also hides its background; this paint-only layer restores that
    // background without making the root focusable or exposing direct text.
    const backdrop = doc.createElement('span');
    backdrop.dataset.noSlopRoot = '';
    backdrop.dataset.noSlopBackdrop = '';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.style.cssText = 'all:initial!important;position:absolute!important;inset:0!important;display:block!important;z-index:-1!important;visibility:visible!important;pointer-events:none!important;';
    for (const property of ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-origin', 'background-clip', 'background-attachment']) {
      const value = computed?.getPropertyValue(property);
      if (value) backdrop.style.setProperty(property, value, 'important');
    }
    backdrop.style.setProperty('border-radius', computed?.borderRadius || '0px', 'important');
    element.append(backdrop);
    restores.push(() => backdrop.remove());
    for (const { child, visible } of children) {
      const inert = child.getAttribute('inert');
      const childStyles = ownStyles(child);
      restores.push(() => {
        childStyles.restore();
        if (child.getAttribute('inert') === '') {
          if (inert === null) child.removeAttribute('inert'); else child.setAttribute('inert', inert);
        }
      });
      child.setAttribute('inert', '');
      if (visible) childStyles.set('visibility', 'visible');
    }
    host.style.cssText = 'position:absolute!important;inset:0!important;display:block!important;z-index:2147483647!important;visibility:visible!important;pointer-events:auto!important;container-type:size!important;container-name:no-slop-censor!important;';
    host.style.setProperty('border-radius', computed?.borderRadius || '0px', 'important');
    const wrapper = doc.createElement('div');
    wrapper.className = `mask${settings.animations && !reducedMotion ? ' animate' : ''}`;
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', 'Content filtered by NO SLOP');
    const stamp = doc.createElement('span');
    stamp.className = 'stamp';
    stamp.textContent = 'NO SLOP';
    const explanation = doc.createElement('div');
    explanation.className = 'reason';
    explanation.textContent = reason;
    const treatment = doc.createElement('div');
    treatment.className = 'treatment';
    const copy = doc.createElement('div');
    copy.className = 'copy';
    const label = doc.createElement('span');
    label.className = 'label';
    label.textContent = verdict.category === 'ai-slop' ? 'Likely AI slop' : 'Likely low-value content';
    copy.append(label, explanation);
    button.title = `${reason}\n${evidenceText(verdict)}`;
    button.setAttribute('aria-description', `${reason} ${evidenceText(verdict)}`);
    wrapper.title = `${reason}\n${evidenceText(verdict)}`;
    treatment.append(stamp, copy, button);
    wrapper.append(treatment);
    surface.root.append(wrapper);
    element.append(host);
  }
  return { element, mode, restore };
}
