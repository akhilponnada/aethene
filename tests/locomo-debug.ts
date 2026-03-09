/**
 * Debug: See exactly what each system returns
 */
import 'dotenv/config';
import { readFileSync } from 'fs';

const AETHENE_URL = 'http://localhost:3006';
const SUPERMEMORY_URL = 'https://api.supermemory.ai';
const AETHENE_KEY = 'ae_dev_test123';
const SM_KEY = process.env.SUPERMEMORY_API_KEY;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const locomoData = JSON.parse(readFileSync('locomo-benchmark/data/locomo10.json', 'utf-8'));

function extractFacts(conv: any): string[] {
  const facts: string[] = [];
  const eventSummary = conv.event_summary;
  for (const sessionKey of Object.keys(eventSummary)) {
    const session = eventSummary[sessionKey];
    const date = session.date || '';
    for (const speaker in session) {
      if (speaker === 'date') continue;
      (session[speaker] || []).forEach((event: string) => {
        if (event?.trim()) facts.push(date ? `On ${date}: ${event}` : event);
      });
    }
  }
  return facts;
}

function checkAnswer(ctx: string, exp: string): boolean {
  ctx = ctx.toLowerCase();
  exp = exp.toLowerCase();
  if (ctx.includes(exp)) return true;
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                      'july', 'august', 'september', 'october', 'november', 'december'];
  const expMonth = monthNames.find(m => exp.includes(m));
  const expYear = exp.match(/20\d{2}/)?.[0];
  if (expMonth || expYear) {
    if ((!expMonth || ctx.includes(expMonth)) && (!expYear || ctx.includes(expYear))) return true;
  }
  const expWords = exp.split(/[\s,]+/).filter(w => w.length > 2);
  const matchCount = expWords.filter(w => ctx.includes(w)).length;
  return matchCount >= Math.ceil(expWords.length * 0.5);
}

async function main() {
  console.log('='.repeat(70));
  console.log('  DEBUG: Caroline & Melanie - Question by Question');
  console.log('='.repeat(70));

  const conv = locomoData[0];
  const facts = extractFacts(conv);
  const questions = conv.qa.filter((q: any) => q.category <= 2).slice(0, 15);
  const speakers = ['Caroline', 'Melanie'];

  const tagA = `debug_ae_${Date.now()}`;
  const tagS = `debug_sm_${Date.now()}`;

  // Ingest both
  console.log('\nIngesting to both...');
  const entityContext = `Conversation between ${speakers.join(' and ')}.`;

  await Promise.all([
    (async () => {
      for (const fact of facts) {
        await fetch(`${AETHENE_URL}/v3/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
          body: JSON.stringify({ content: fact, containerTag: tagA, entityContext })
        });
      }
    })(),
    (async () => {
      for (const fact of facts) {
        await fetch(`${SUPERMEMORY_URL}/v3/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
          body: JSON.stringify({ content: fact, containerTag: tagS })
        });
      }
    })()
  ]);

  console.log('Waiting 50s...');
  await sleep(50000);

  // Test each question
  console.log('\n' + '-'.repeat(70));
  let aTotal = 0, sTotal = 0;

  for (let i = 0; i < questions.length; i++) {
    const qa = questions[i];

    // Aethene
    const aResp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ query: qa.question, containerTag: tagA, limit: 3, mode: 'memories' })
    });
    const aData = await aResp.json();
    const aCtx = aData.results?.map((r: any) => r.memory).join(' | ') || '';
    const aMatch = checkAnswer(aCtx, String(qa.answer));
    if (aMatch) aTotal++;

    // Supermemory
    const sResp = await fetch(`${SUPERMEMORY_URL}/v3/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
      body: JSON.stringify({ q: qa.question, containerTags: [tagS] })
    });
    const sData = await sResp.json();
    const sCtx = sData.results?.flatMap((r: any) => r.chunks?.map((c: any) => c.content) || []).slice(0, 3).join(' | ') || '';
    const sMatch = checkAnswer(sCtx, String(qa.answer));
    if (sMatch) sTotal++;

    // Only show differences
    if (aMatch !== sMatch) {
      console.log(`\nQ${i+1}: ${qa.question}`);
      console.log(`Expected: ${qa.answer}`);
      console.log(`Aethene [${aMatch ? 'Y' : 'X'}]: ${aCtx.slice(0, 100)}...`);
      console.log(`SM      [${sMatch ? 'Y' : 'X'}]: ${sCtx.slice(0, 100)}...`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Aethene: ${aTotal}/15 | Supermemory: ${sTotal}/15`);
  console.log('='.repeat(70));
}

main().catch(console.error);
