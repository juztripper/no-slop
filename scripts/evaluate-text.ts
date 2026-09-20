import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readConfig } from '../server/config';
import { OpenRouterProvider, POLICY_VERSION, QUESTIONS } from '../server/provider';
import { verdictFromDecision } from '../server/detector';
import { DailyBudget } from '../server/limits';
import { DEFAULT_SETTINGS, shouldFilter, type ContentItem } from '../src/shared/contracts';
import { textExamples } from './fixtures/text-quality';

const name = process.argv.includes('--baseline') ? 'text-baseline' : 'text-candidate';
const config = readConfig();
if (!config.apiKey) throw new Error('Configure an OpenRouter key for this live evaluation.');
// A separate bounded ledger avoids racing the running service's single-process ledger.
const model = new OpenRouterProvider(config, new DailyBudget(200, '.data/text-evaluation-budget.json'));
const rows = [];
for (const example of textExamples) {
  const item: ContentItem = { id:example.id, platform:example.kind === 'video' ? 'youtube' : example.kind === 'search' ? 'google' : 'forum', kind:example.kind, title:example.title, text:example.text, context:example.context };
  const started = Date.now();
  try {
    const decision = await model.decide({ platform:item.platform, kind:item.kind, title:item.title, text:item.text, context:item.context || '' });
    const verdict = verdictFromDecision(item, decision, {text:true, thumbnail:false, destination:false});
    const modes = Object.fromEntries([['gentle',.95],['balanced',.85],['strict',.7]].map(([preset,threshold])=>[preset,shouldFilter(verdict,{...DEFAULT_SETTINGS,threshold:Number(threshold)})?'filter':'keep']));
    rows.push({ ...example, actual:modes.balanced, modes, passed:modes.balanced === example.expected, elapsedMs:Date.now()-started, verdict, answers:decision.answers, usage:decision.usage });
    console.log(`${modes.balanced === example.expected ? 'PASS' : 'MISS'} ${example.id}: ${verdict.category} ${verdict.confidence}`);
  } catch (error) {
    rows.push({...example,actual:'error',passed:false,elapsedMs:Date.now()-started,error:error instanceof Error?error.message:'Failed'});
    console.log(`ERROR ${example.id}`);
  }
}
const report = {
  generatedAt:new Date().toISOString(), policy:POLICY_VERSION, requestedModel:config.jevModel,
  corpus:'40 authored text contrast cases; no image requests. Synthetic development comparison, not a real-world accuracy estimate.',
  corpusHash:createHash('sha256').update(JSON.stringify(textExamples)).digest('hex'),
  questions:QUESTIONS,total:rows.length,passed:rows.filter(r=>r.passed).length,
  falsePositives:rows.filter(r=>r.expected==='keep'&&r.actual==='filter').length,
  falseNegatives:rows.filter(r=>r.expected==='filter'&&r.actual==='keep').length,
  errors:rows.filter(r=>r.actual==='error').length,
  measuredCost:rows.reduce((sum,r)=>sum+('usage' in r?r.usage?.cost||0:0),0),rows,
};
await mkdir('docs/evaluations',{recursive:true});
await writeFile(`docs/evaluations/${name}.json`,`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify({...report,rows:undefined,questions:undefined}));
if (report.passed !== report.total) process.exitCode=1;
