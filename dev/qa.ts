import { extractCandidates } from '../src/content/adapters';
import { presentCandidate, type Presentation } from '../src/content/presentation';
import { AnalyzeResponseSchema, DEFAULT_SETTINGS, shouldFilter } from '../src/shared/contracts';

const status = document.querySelector<HTMLElement>('#status')!;
const result = document.querySelector<HTMLElement>('#results')!;
const button = document.querySelector<HTMLButtonElement>('#analyze')!;
let presentations: Presentation[] = [];
// Fixture links retain realistic extraction URLs but must never navigate to a fake video.
document.querySelector('#fixtures')!.addEventListener('click', event => {
  if ((event.target as Element).closest('a')) event.preventDefault();
});
function restore() { presentations.forEach(p => p.restore()); presentations=[]; status.textContent='All original content and controls restored.'; }
document.querySelector('#restore')!.addEventListener('click',restore);
button.addEventListener('click',async()=>{
  restore(); button.disabled=true; status.textContent='Inspecting the authored examples with the real local detector…';
  try {
    const candidates=extractCandidates(document,new URL('https://www.youtube.com/results'),false);
    const response=await fetch('http://localhost:8787/v1/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:candidates.map(c=>c.item),inspectThumbnails:false,inspectDestinations:false}),signal:AbortSignal.timeout(29000)});
    if(!response.ok) throw new Error(`Detector returned ${response.status}.`);
    const parsed=AnalyzeResponseSchema.parse(await response.json());
    const settings={...DEFAULT_SETTINGS,consent:true,mode:document.querySelector<HTMLSelectElement>('#mode')!.value as 'censor'|'hide',animations:document.querySelector<HTMLInputElement>('#motion')!.checked};
    let applied=0;
    for(const candidate of candidates){
      const verdict=parsed.verdicts.find(v=>v.id===candidate.item.id);
      if(verdict&&shouldFilter(verdict,settings)){applied++; presentations.push(presentCandidate(candidate,verdict,settings,()=>{status.textContent='Original content revealed.';},matchMedia('(prefers-reduced-motion: reduce)').matches));}
    }
    result.textContent=JSON.stringify(parsed,null,2);
    status.textContent=`${candidates.length} complete cards extracted; ${parsed.verdicts.length} real verdicts; ${applied} filtered; ${parsed.errors.length} errors.`;
  } catch(error){status.textContent=error instanceof Error?error.message:'Analysis failed. Content stays visible.';}finally{button.disabled=false;}
});
button.disabled=false;
