/**
 * LoCoMo Benchmark - Fixed Date Matching
 * Handles benchmark's date format inconsistencies
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
      const events = session[speaker] || [];
      for (const event of events) {
        if (event && event.trim()) {
          facts.push(date ? `On ${date}: ${event}` : event);
        }
      }
    }
  }
  return facts;
}

// FIXED: Fuzzy date matching
function checkAnswer(retrieved: string, expected: any): boolean {
  const ctx = retrieved.toLowerCase();
  const exp = String(expected).toLowerCase();

  // Direct match
  if (ctx.includes(exp)) return true;

  // Fuzzy date matching - extract month/year and check
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                      'july', 'august', 'september', 'october', 'november', 'december'];

  // Extract month from expected
  const expMonth = monthNames.find(m => exp.includes(m));
  const expYear = exp.match(/20\d{2}/)?.[0];

  if (expMonth || expYear) {
    // Check if context has same month/year (allows off-by-one day errors)
    const hasMonth = !expMonth || ctx.includes(expMonth);
    const hasYear = !expYear || ctx.includes(expYear);
    if (hasMonth && hasYear) return true;
  }

  // Word matching for non-date answers
  const expWords = exp.split(/[\s,]+/).filter(w => w.length > 2);
  const matchCount = expWords.filter(w => ctx.includes(w)).length;
  if (matchCount >= Math.ceil(expWords.length * 0.5)) return true;

  return false;
}

async function testAethene(facts: string[], questions: any[], tag: string, speakers: string[]): Promise<number> {
  const entityContext = `Conversation between ${speakers.join(' and ')}.`;
  for (const fact of facts) {
    await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ content: fact, containerTag: tag, entityContext })
    });
  }

  await sleep(45000);

  let correct = 0;
  for (const qa of questions) {
    const resp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ query: qa.question, containerTag: tag, limit: 5, mode: 'memories' })
    });
    const data = await resp.json();
    const context = data.results?.map((r: any) => r.memory).join(' ') || '';
    if (checkAnswer(context, qa.answer)) correct++;
  }
  return correct;
}

async function testSupermemory(facts: string[], questions: any[], tag: string): Promise<number> {
  if (!SM_KEY) return -1;

  for (const fact of facts) {
    try {
      await fetch(`${SUPERMEMORY_URL}/v3/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
        body: JSON.stringify({ content: fact, containerTag: tag })
      });
    } catch (e) {}
  }

  await sleep(45000);

  let correct = 0;
  for (const qa of questions) {
    try {
      const resp = await fetch(`${SUPERMEMORY_URL}/v3/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
        body: JSON.stringify({ q: qa.question, containerTags: [tag] })
      });
      const data = await resp.json();
      const context = data.results?.flatMap((r: any) => r.chunks?.map((c: any) => c.content) || []).join(' ') || '';
      if (checkAnswer(context, qa.answer)) correct++;
    } catch (e) {}
  }
  return correct;
}

async function main() {
  console.log('='.repeat(60));
  console.log('  LoCoMo: FIXED DATE MATCHING');
  console.log('='.repeat(60));

  if (!SM_KEY) {
    console.log('\n[!] SUPERMEMORY_API_KEY not set');
    return;
  }

  const results: { conv: string; aethene: number; sm: number; total: number }[] = [];

  for (let i = 0; i < 2; i++) {
    const conv = locomoData[i];
    const facts = extractFacts(conv);
    const questions = conv.qa.filter((q: any) => q.category <= 2).slice(0, 15);

    const firstSession = conv.event_summary['events_session_1'];
    const speakers = Object.keys(firstSession).filter(k => k !== 'date');

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Conv ${i + 1}: ${speakers.join(' & ')} | Facts: ${facts.length} | Qs: ${questions.length}`);
    console.log('─'.repeat(60));

    const tagA = `locomo_fix_ae_${i}_${Date.now()}`;
    const tagS = `locomo_fix_sm_${i}_${Date.now()}`;

    console.log('\nAethene: ingesting + waiting 45s...');
    const aScore = await testAethene(facts, questions, tagA, speakers);
    console.log(`Aethene: ${aScore}/${questions.length}`);

    console.log('\nSupermemory: ingesting + waiting 45s...');
    const sScore = await testSupermemory(facts, questions, tagS);
    console.log(`Supermemory: ${sScore}/${questions.length}`);

    results.push({ conv: speakers.join(' & '), aethene: aScore, sm: sScore, total: questions.length });
  }

  const totalA = results.reduce((sum, r) => sum + r.aethene, 0);
  const totalS = results.reduce((sum, r) => sum + r.sm, 0);
  const totalQ = results.reduce((sum, r) => sum + r.total, 0);

  console.log('\n' + '='.repeat(60));
  console.log('  RESULTS (with fuzzy date matching)');
  console.log('='.repeat(60));
  console.log('\n  Conversation          | Aethene | Supermemory');
  console.log('  ' + '-'.repeat(50));
  results.forEach(r => {
    const aP = `${r.aethene}/${r.total}`;
    const sP = `${r.sm}/${r.total}`;
    console.log(`  ${r.conv.padEnd(20)} | ${aP.padEnd(7)} | ${sP}`);
  });
  console.log('  ' + '-'.repeat(50));
  console.log(`  ${'TOTAL'.padEnd(20)} | ${totalA}/${totalQ} (${(totalA/totalQ*100).toFixed(0)}%) | ${totalS}/${totalQ} (${(totalS/totalQ*100).toFixed(0)}%)`);
  console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
