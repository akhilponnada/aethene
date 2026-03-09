/**
 * LoCoMo Benchmark - 2 Conversations
 * Tests actual LoCoMo data with real questions
 */
import 'dotenv/config';
import { readFileSync } from 'fs';

const AETHENE_URL = 'http://localhost:3006';
const API_KEY = 'ae_dev_test123';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Load LoCoMo data
const locomoData = JSON.parse(readFileSync('locomo-benchmark/data/locomo10.json', 'utf-8'));

interface QA {
  question: string;
  answer: any;
  category: number;
  evidence: string[];
}

function extractFacts(conv: any): string[] {
  const facts: string[] = [];
  const eventSummary = conv.event_summary;

  for (const sessionKey of Object.keys(eventSummary)) {
    const session = eventSummary[sessionKey];
    const date = session.date || '';

    // Get all speaker names (excluding 'date')
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

  // Direct match
  if (ctx.includes(exp)) return true;

  // Check each word of expected (for multi-word answers)
  const expWords = exp.split(/[\s,]+/).filter(w => w.length > 2);
  const matchCount = expWords.filter(w => ctx.includes(w)).length;
  if (matchCount >= Math.ceil(expWords.length * 0.5)) return true;

  return false;
}

async function testConversation(convIndex: number): Promise<{ correct: number; total: number; details: string[] }> {
  const conv = locomoData[convIndex];
  const TAG = `locomo_conv${convIndex}_${Date.now()}`;

  // Get speaker names from first session
  const firstSession = conv.event_summary['events_session_1'];
  const speakers = Object.keys(firstSession).filter(k => k !== 'date');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`CONVERSATION ${convIndex + 1}: ${speakers.join(' & ')}`);
  console.log(`${'='.repeat(60)}`);

  // Extract facts
  const facts = extractFacts(conv);
  console.log(`Facts: ${facts.length}`);

  // Get questions (limit to 20 for speed, category 1 & 2 only - skip multi-hop)
  const questions: QA[] = conv.qa
    .filter((q: QA) => q.category <= 2)
    .slice(0, 20);
  console.log(`Questions: ${questions.length} (category 1-2 only)`);

  // Ingest facts
  console.log('\nIngesting...');
  const entityContext = `Conversation between ${speakers.join(' and ')}. Events from LoCoMo benchmark.`;

  for (const fact of facts) {
    await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ content: fact, containerTag: TAG, entityContext })
    });
  }
  console.log('Done');

  console.log('Waiting 20s for processing...');
  await sleep(20000);

  // Test
  console.log('\nTesting:\n');
  let correct = 0;
  const details: string[] = [];

  for (const qa of questions) {
    const resp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ query: qa.question, containerTag: TAG, limit: 5, mode: 'memories' })
    });
    const data = await resp.json();
    const context = data.results?.map((r: any) => r.memory).join(' ') || '';

    const match = checkAnswer(context, qa.answer);
    if (match) correct++;

    const status = match ? 'Y' : 'X';
    const cat = `[cat${qa.category}]`;
    console.log(`${status} ${cat} ${qa.question.slice(0, 50)}...`);

    if (!match) {
      details.push(`Q: ${qa.question}\nExpected: ${qa.answer}\nGot: ${context.slice(0, 100)}...\n`);
    }
  }

  return { correct, total: questions.length, details };
}

async function main() {
  console.log('='.repeat(60));
  console.log('  LoCoMo BENCHMARK - 2 CONVERSATIONS');
  console.log('='.repeat(60));

  const results: { conv: number; correct: number; total: number }[] = [];

  // Test first 2 conversations
  for (let i = 0; i < 2; i++) {
    const result = await testConversation(i);
    results.push({ conv: i + 1, correct: result.correct, total: result.total });

    console.log(`\nConv ${i + 1} Score: ${result.correct}/${result.total} (${(result.correct/result.total*100).toFixed(0)}%)`);

    if (result.details.length > 0 && result.details.length <= 5) {
      console.log('\nMissed:');
      result.details.forEach(d => console.log(d));
    }
  }

  // Summary
  const totalCorrect = results.reduce((sum, r) => sum + r.correct, 0);
  const totalQuestions = results.reduce((sum, r) => sum + r.total, 0);

  console.log('\n' + '='.repeat(60));
  console.log('  FINAL RESULTS');
  console.log('='.repeat(60));
  results.forEach(r => {
    console.log(`  Conv ${r.conv}: ${r.correct}/${r.total} (${(r.correct/r.total*100).toFixed(0)}%)`);
  });
  console.log('  ' + '-'.repeat(20));
  console.log(`  TOTAL: ${totalCorrect}/${totalQuestions} (${(totalCorrect/totalQuestions*100).toFixed(0)}%)`);
  console.log('='.repeat(60));
}

main().catch(console.error);
