import type { Settings, Verdict } from '../shared/contracts';
import type { Candidate } from './adapters';

export interface Presentation { restore(): void; element: HTMLElement; mode: 'hide' | 'censor' | 'annotation'; }

const BASE_CSS = `
:host{all:initial;box-sizing:border-box!important;color-scheme:light!important;font-family:Arial,Helvetica,sans-serif!important;font-size:12px!important;line-height:1.4!important;text-align:left!important}
*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:0;border-radius:7px;padding:6px 10px;min-height:30px;background:#fff;color:#25222a;box-shadow:0 0 0 1px #25222a28}button:hover{background:#f1eef6}button:focus-visible{outline:3px solid #c5354d;outline-offset:3px}
.mask{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:14px;overflow:hidden;background:#f1eef6;color:#25222a;border:1px solid #25222a1a;border-radius:8px;isolation:isolate}
.stamp{display:inline-block;color:#742034;border:2px solid currentColor;border-radius:4px;font-size:clamp(12px,2vw,20px);font-weight:900;letter-spacing:.12em;padding:2px 8px;line-height:1.25;transform:rotate(-5deg);white-space:nowrap}
.reason{font-size:11px;max-width:320px;text-align:center;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.actions{display:flex;align-items:center;gap:8px}.label{font-size:10px;letter-spacing:.03em;color:#777080}.compact{flex-direction:row;gap:10px;padding:6px 10px}.compact .stamp{font-size:11px;padding:1px 5px}.compact .reason{display:none}.compact .label{display:none}
.annotation{display:flex;align-items:flex-start;gap:8px;margin:6px 0 12px;padding:8px 10px;border-left:2px solid #c5354d;background:#fcfcfeee;border-radius:0 5px 5px 0;color:#514958;font-size:12px}.annotation strong{font-weight:700;color:#742034}.annotation details{flex:1}.annotation summary{cursor:pointer;list-style:none}.annotation summary::-webkit-details-marker{display:none}.annotation summary:focus-visible{outline:2px solid #c5354d;outline-offset:2px}.annotation p{margin:7px 0 2px;line-height:1.5}.annotation button{font-size:11px;min-height:26px;padding:3px 8px}.evidence{font-size:10px;color:#777080;margin-top:6px}
@keyframes stamp{0%{transform:rotate(-10deg) scale(1.18);opacity:0}65%{transform:rotate(-5deg) scale(.97);opacity:1}100%{transform:rotate(-5deg) scale(1)}}
.animate .stamp{animation:stamp 240ms cubic-bezier(.2,.7,.2,1) both}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
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
  return `Assessed ${evidence || 'available content'} · ${Math.round(verdict.confidence * 100)}% model confidence. This is a quality judgment, not proof of authorship.`;
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
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = mode === 'annotation' ? 'Dismiss' : 'Show';
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
    if (computed?.position === 'static' || !computed?.position) styles.set('position', 'relative');
    styles.set('isolation', 'isolate');
    // Cover direct Text nodes and pseudo-elements too. The mask explicitly restores
    // visibility; the original root cannot remain a hidden keyboard-focus target.
    styles.set('visibility', 'hidden');
    // Keep framework-owned nodes in place. Inert prevents focusing covered links or controls.
    for (const child of [...element.children]) {
      if (!(child instanceof HTMLElement) && !(child instanceof SVGElement)) continue;
      const inert = child.getAttribute('inert');
      const childStyles = ownStyles(child);
      restores.push(() => {
        childStyles.restore();
        if (child.getAttribute('inert') === '') {
          if (inert === null) child.removeAttribute('inert'); else child.setAttribute('inert', inert);
        }
      });
      child.setAttribute('inert', '');
      childStyles.set('visibility', 'hidden');
    }
    host.style.cssText = 'position:absolute!important;inset:0!important;display:block!important;z-index:2147483647!important;visibility:visible!important;pointer-events:auto!important;';
    const wrapper = doc.createElement('div');
    wrapper.className = `mask${settings.animations && !reducedMotion ? ' animate' : ''}${element.getBoundingClientRect().height < 110 ? ' compact' : ''}`;
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', 'Content filtered by NO SLOP');
    const stamp = doc.createElement('span');
    stamp.className = 'stamp';
    stamp.textContent = 'NO SLOP';
    const explanation = doc.createElement('div');
    explanation.className = 'reason';
    explanation.textContent = reason;
    const actions = doc.createElement('div');
    actions.className = 'actions';
    const label = doc.createElement('span');
    label.className = 'label';
    label.textContent = verdict.category === 'ai-slop' ? 'Likely AI slop' : 'Likely low-value content';
    actions.append(label, button);
    wrapper.title = `${reason}\n${evidenceText(verdict)}`;
    wrapper.append(stamp, explanation, actions);
    surface.root.append(wrapper);
    element.append(host);
  }
  return { element, mode, restore };
}
