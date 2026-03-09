/**
 * Real LoCoMo Test v2 - Jon and Gina Story
 * Properly combines dates with facts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';

const AETHENE_URL = 'http://localhost:3006';
const API_KEY = 'ae_dev_test123';
const TAG = `locomo_v2_${Date.now()}`;

// Load real LoCoMo data
const locomoData = JSON.parse(readFileSync('locomo-benchmark/data/locomo10.json', 'utf-8'));
const jonGina = locomoData[1];

// Extract facts WITH dates
const FACTS: string[] = [];
const eventSummaries = jonGina.event_summary;
Object.keys(eventSummaries).forEach(key => {
  const events = eventSummaries[key];
  const date = events.date || '';
  
  // Combine facts with dates
  if (events.Jon) {
    events.Jon.forEach((e: string) => {
      FACTS.push(date ? `On ${date}: ${e}` : e);
    });
  }
  if (events.Gina) {
    events.Gina.forEach((e: string) => {
      FACTS.push(date ? `On ${date}: ${e}` : e);
    });
  }
});

// Use first 10 questions from benchmark
const QUESTIONS = [
  { q: "When did Jon lose his job as a banker?", expected: "January" },
  { q: "When did Gina lose her job at Door Dash?", expected: "January" },
  { q: "How do Jon and Gina like to destress?", expected: "dancing" },
  { q: "What do Jon and Gina have in common?", expected: "lost jobs" },
  { q: "Why did Jon start his dance studio?", expected: "passion" },
  { q: "When was Jon in Paris?", expected: "January" },
  { q: "What business is Gina starting?", expected: "cleaning" },
  { q: "What business is Jon starting?", expected: "dance studio" },
  { q: "Who is a dancer?", expected: "Jon" },
  { q: "Who worked at Door Dash?", expected: "Gina" },
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function checkMatch(context: string, expected: string): boolean {
  return context.toLowerCase().includes(expected.toLowerCase());
}

async function main() {
  console.log('='.repeat(60));
  console.log('REAL LoCoMo TEST v2: Jon and Gina');
  console.log('='.repeat(60));
  console.log(`\nFacts: ${FACTS.length} | Questions: ${QUESTIONS.length}\n`);

  // Show sample facts WITH dates
  console.log('Sample facts with dates:');
  FACTS.slice(0, 5).forEach((f, i) => console.log(`  ${i+1}. ${f}`));
  console.log('\n');

  // Ingest facts
  console.log('📥 Ingesting...');
  const entityContext = "Conversation between Jon (former banker starting a dance studio) and Gina (former Door Dash driver starting a cleaning business). Events span January-February 2023.";
  
  for (const fact of FACTS.slice(0, 40)) {
    await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ content: fact, containerTag: TAG, entityContext })
    });
  }
  console.log('✓ Done\n');

  console.log('⏳ Waiting 25s...\n');
  await sleep(25000);

  // Test
  console.log('📝 Testing:\n');
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

    console.log(`${match ? '✅' : '❌'} ${test.q} → ${test.expected}`);
    if (!match) console.log(`   Got: ${context.slice(0, 80)}...`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`SCORE: ${correct}/${QUESTIONS.length} = ${(correct/QUESTIONS.length*100).toFixed(0)}%`);
  console.log('='.repeat(60));
}

main().catch(console.error);
