import { presentCandidate, type Presentation } from '../src/content/presentation';
import { DEFAULT_SETTINGS, type Verdict } from '../src/shared/contracts';

let treatments: Presentation[] = [];
const status = document.querySelector<HTMLElement>('#status')!;
const motion = document.querySelector<HTMLInputElement>('#motion')!;
function restore() { treatments.forEach(treatment => treatment.restore()); treatments = []; }
function censor() {
  restore();
  document.querySelectorAll<HTMLElement>('[data-fixture]').forEach((element, index) => {
    const id = String(index);
    const verdict: Verdict = { id, category: 'slop', confidence: .94, reasons: ['Repeated promises with no useful supporting detail. The available text does not substantiate the claims.'], signals: {lowQuality:.99,synthetic:.5,clickbait:.95}, evidence:{text:true,thumbnail:false,destination:false}, model:'fixture' };
    treatments.push(presentCandidate({element,fingerprint:id,preserveContext:false,item:{id,platform:'generic',kind:'post',title:'Authored example',text:''}},verdict,{...DEFAULT_SETTINGS,animations:motion.checked},()=>{status.textContent='Original content revealed. Its links and controls are available again.';},matchMedia('(prefers-reduced-motion: reduce)').matches));
  });
  status.textContent='All examples use a pre-labeled verdict. Resize a card or reveal its content.';
}
document.querySelector('#censor')!.addEventListener('click',censor);
document.querySelector('#restore')!.addEventListener('click',()=>{restore();status.textContent='Original content restored.';});
motion.addEventListener('change',censor);
document.querySelector<HTMLSelectElement>('#size')!.addEventListener('change',event=>{
  const value = (event.target as HTMLSelectElement).value;
  const card = document.querySelector<HTMLElement>('#resize')!;
  card.style.width = value === 'tiny' ? '128px' : value === 'narrow' ? '230px' : '100%';
  card.style.height = value === 'tiny' ? '64px' : value === 'narrow' ? '180px' : '150px';
});
censor();
