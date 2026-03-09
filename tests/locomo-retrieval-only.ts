/**
 * LoCoMo Benchmark - Retrieval Only Test
 * Ingests once, waits longer, then tests retrieval
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

async function main() {
  console.log('='.repeat(60));
  console.log('  LoCoMo RETRIEVAL TEST (longer ingestion wait)');
  console.log('='.repeat(60));

  if (!SM_KEY) {
    console.log('\n[!] SUPERMEMORY_API_KEY not set');
    return;
  }

  // Use conversation 2 (Jon & Gina) - simpler
  const conv = locomoData[1];
  const facts = extractFacts(conv);
  const questions = conv.qa.filter((q: any) => q.category <= 2).slice(0, 15);

  const firstSession = conv.event_summary['events_session_1'];
  const speakers = Object.keys(firstSession).filter(k => k !== 'date');

  console.log(`\nConversation: ${speakers.join(' & ')}`);
  console.log(`Facts: ${facts.length} | Questions: ${questions.length}`);

  const tagA = `ret_ae_${Date.now()}`;
  const tagS = `ret_sm_${Date.now()}`;

  // INGEST BOTH IN PARALLEL
  console.log('\n--- INGESTION PHASE ---');
  console.log('Ingesting to both systems in parallel...');

  const ingestStart = Date.now();

  await Promise.all([
    // Aethene ingestion
    (async () => {
      const entityContext = `Conversation between ${speakers.join(' and ')}.`;
      for (const fact of facts) {
        await fetch(`${AETHENE_URL}/v3/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
          body: JSON.stringify({ content: fact, containerTag: tagA, entityContext })
        });
      }
      console.log('  Aethene: done ingesting');
    })(),
    // Supermemory ingestion
    (async () => {
      for (const fact of facts) {
        try {
          await fetch(`${SUPERMEMORY_URL}/v3/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
            body: JSON.stringify({ content: fact, containerTag: tagS })
          });
        } catch (e) {}
      }
      console.log('  Supermemory: done ingesting');
    })()
  ]);

  console.log(`Ingestion took: ${Date.now() - ingestStart}ms`);

  // WAIT FOR PROCESSING
  console.log('\nWaiting 45 seconds for both to process...');
  await sleep(45000);

  // RETRIEVAL PHASE
  console.log('\n--- RETRIEVAL PHASE ---\n');

  let aetheneCorrect = 0;
  let smCorrect = 0;

  for (const qa of questions) {
    // Aethene search
    const aResp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ query: qa.question, containerTag: tagA, limit: 5, mode: 'memories' })
    });
    const aData = await aResp.json();
    const aContext = aData.results?.map((r: any) => r.memory).join(' ') || '';
    const aMatch = checkAnswer(aContext, qa.answer);
    if (aMatch) aetheneCorrect++;

    // Supermemory search
    let sMatch = false;
    try {
      const sResp = await fetch(`${SUPERMEMORY_URL}/v3/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
        body: JSON.stringify({ q: qa.question, containerTags: [tagS] })
      });
      const sData = await sResp.json();
      const sContext = sData.results?.flatMap((r: any) => r.chunks?.map((c: any) => c.content) || []).join(' ') || '';
      sMatch = checkAnswer(sContext, qa.answer);
      if (sMatch) smCorrect++;
    } catch (e) {}

    const aIcon = aMatch ? 'Y' : 'X';
    const sIcon = sMatch ? 'Y' : 'X';
    console.log(`[A:${aIcon} S:${sIcon}] ${qa.question.slice(0, 45)}...`);
  }

  // RESULTS
  console.log('\n' + '='.repeat(60));
  console.log('  RESULTS (after 45s processing time)');
  console.log('='.repeat(60));
  console.log(`\n  Aethene:     ${aetheneCorrect}/${questions.length} (${(aetheneCorrect/questions.length*100).toFixed(0)}%)`);
  console.log(`  Supermemory: ${smCorrect}/${questions.length} (${(smCorrect/questions.length*100).toFixed(0)}%)`);
  console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
