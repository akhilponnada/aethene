/**
 * Real LoCoMo Test - Jon and Gina Story
 * Data from locomo-benchmark/data/locomo10.json[1]
 */
import 'dotenv/config';
import { readFileSync } from 'fs';

const AETHENE_URL = 'http://localhost:3006';
const API_KEY = 'ae_dev_test123';
const TAG = `locomo_real_${Date.now()}`;

// Load real LoCoMo data
const locomoData = JSON.parse(readFileSync('locomo-benchmark/data/locomo10.json', 'utf-8'));
const jonGina = locomoData[1];

// Extract facts from event summaries
const FACTS: string[] = [];
const eventSummaries = jonGina.event_summary;
Object.keys(eventSummaries).forEach(key => {
  const events = eventSummaries[key];
  if (events.Jon) FACTS.push(...events.Jon.map((e: string) => `Jon: ${e}`));
  if (events.Gina) FACTS.push(...events.Gina.map((e: string) => `Gina: ${e}`));
  if (events.date) FACTS.push(`Date: ${events.date}`);
});

// Get sample questions from the benchmark
const QUESTIONS = jonGina.qa.slice(0, 10).map((q: any) => ({
  q: q.question,
  expected: q.answer
}));

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function checkMatch(context: string, expected: string): boolean {
  const c = context.toLowerCase();
  const e = expected.toLowerCase();
  // Check for key words
  const keywords = e.split(/[\s,]+/).filter(w => w.length > 3);
  const matched = keywords.filter(k => c.includes(k));
  return matched.length >= Math.ceil(keywords.length * 0.5);
}

async function main() {
  console.log('='.repeat(60));
  console.log('REAL LoCoMo TEST: Jon and Gina');
  console.log('='.repeat(60));
  console.log(`\nTag: ${TAG}`);
  console.log(`Facts to ingest: ${FACTS.length}`);
  console.log(`Questions: ${QUESTIONS.length}\n`);

  // Show some sample facts
  console.log('Sample facts:');
  FACTS.slice(0, 5).forEach((f, i) => console.log(`  ${i+1}. ${f}`));
  console.log('  ...\n');

  // Ingest facts
  console.log('📥 Ingesting to Aethene...');
  const entityContext = "Conversation between Jon (former banker starting a dance studio) and Gina (former Door Dash driver starting a cleaning business)";
  
  for (const fact of FACTS.slice(0, 30)) { // Limit to first 30 facts for speed
    await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ content: fact, containerTag: TAG, entityContext })
    });
  }
  console.log(`✓ Ingested ${Math.min(30, FACTS.length)} facts\n`);

  console.log('⏳ Waiting 30s for processing...\n');
  await sleep(30000);

  // Test questions
  console.log('📝 Testing questions:\n');
  let correct = 0;

  for (const test of QUESTIONS) {
    const resp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ query: test.q, containerTag: TAG, limit: 5, mode: 'memories' })
    });
    const data = await resp.json();
    const context = data.results?.map((r: any) => r.memory).join(' ') || '';
    
    const match = checkMatch(context, test.expected);
    if (match) correct++;

    console.log(`${match ? '✅' : '❌'} ${test.q}`);
    console.log(`   Expected: ${test.expected}`);
    console.log(`   Context: ${context.slice(0, 120)}...\n`);
  }

  console.log('='.repeat(60));
  console.log(`SCORE: ${correct}/${QUESTIONS.length} = ${(correct/QUESTIONS.length*100).toFixed(0)}%`);
  console.log('='.repeat(60));
}

main().catch(console.error);
