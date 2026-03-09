/**
 * LoCoMo Benchmark - Aethene vs Supermemory
 * 2 Conversations, Category 1-2 questions
 */
import 'dotenv/config';
import { readFileSync } from 'fs';

const AETHENE_URL = 'http://localhost:3006';
const SUPERMEMORY_URL = 'https://api.supermemory.ai';
const AETHENE_KEY = 'ae_dev_test123';
const SM_KEY = process.env.SUPERMEMORY_API_KEY;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const locomoData = JSON.parse(readFileSync('locomo-benchmark/data/locomo10.json', 'utf-8'));

interface QA {
  question: string;
  answer: any;
  category: number;
}

function extractFacts(conv: any): string[] {
  const facts: string[] = [];
  const eventSummary = conv.event_summary;

  for (const sessionKey of Object.keys(eventSummary)) {
    const session = eventSummary[sessionKey];
    const date = session.date || '';
    const speakers = Object.keys(session).filter(k => k !== 'date');

    for (const speaker of speakers) {
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

function checkAnswer(retrieved: string, expected: any): boolean {
  const ctx = retrieved.toLowerCase();
  const exp = String(expected).toLowerCase();
  if (ctx.includes(exp)) return true;

  const expWords = exp.split(/[\s,]+/).filter(w => w.length > 2);
  const matchCount = expWords.filter(w => ctx.includes(w)).length;
  if (matchCount >= Math.ceil(expWords.length * 0.5)) return true;

  return false;
}

async function testAethene(facts: string[], questions: QA[], tag: string, speakers: string[]): Promise<number> {
  // Ingest
  const entityContext = `Conversation between ${speakers.join(' and ')}.`;
  for (const fact of facts) {
    await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ content: fact, containerTag: tag, entityContext })
    });
  }

  await sleep(45000);

  // Test
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

async function testSupermemory(facts: string[], questions: QA[], tag: string): Promise<number> {
  if (!SM_KEY) return -1;

  // Ingest
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

  // Test
  let correct = 0;
  for (const qa of questions) {
    try {
      const resp = await fetch(`${SUPERMEMORY_URL}/v3/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
        body: JSON.stringify({ q: qa.question, containerTags: [tag] })
      });
      const data = await resp.json();
      // SM response: { results: [{ docId, chunks: [{ content, score }] }] }
      const context = data.results?.flatMap((r: any) => r.chunks?.map((c: any) => c.content) || []).join(' ') || '';
      if (checkAnswer(context, qa.answer)) correct++;
    } catch (e) {}
  }
  return correct;
}

async function main() {
  console.log('='.repeat(60));
  console.log('  LoCoMo: AETHENE vs SUPERMEMORY');
  console.log('='.repeat(60));

  if (!SM_KEY) {
    console.log('\n[!] SUPERMEMORY_API_KEY not set');
    return;
  }

  const results: { conv: string; aethene: number; sm: number; total: number }[] = [];

  for (let i = 0; i < 2; i++) {
    const conv = locomoData[i];
    const facts = extractFacts(conv);
    const questions: QA[] = conv.qa.filter((q: QA) => q.category <= 2).slice(0, 15);

    const firstSession = conv.event_summary['events_session_1'];
    const speakers = Object.keys(firstSession).filter(k => k !== 'date');

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Conv ${i + 1}: ${speakers.join(' & ')} | Facts: ${facts.length} | Qs: ${questions.length}`);
    console.log('─'.repeat(60));

    const tagA = `locomo_ae_${i}_${Date.now()}`;
    const tagS = `locomo_sm_${i}_${Date.now()}`;

    console.log('\nAethene: ingesting + waiting 45s...');
    const aScore = await testAethene(facts, questions, tagA, speakers);
    console.log(`Aethene: ${aScore}/${questions.length}`);

    console.log('\nSupermemory: ingesting + waiting 45s...');
    const sScore = await testSupermemory(facts, questions, tagS);
    console.log(`Supermemory: ${sScore}/${questions.length}`);

    results.push({ conv: speakers.join(' & '), aethene: aScore, sm: sScore, total: questions.length });
  }

  // Summary
  const totalA = results.reduce((sum, r) => sum + r.aethene, 0);
  const totalS = results.reduce((sum, r) => sum + r.sm, 0);
  const totalQ = results.reduce((sum, r) => sum + r.total, 0);

  console.log('\n' + '='.repeat(60));
  console.log('  FINAL RESULTS');
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
