/**
 * Quick Aethene vs Supermemory comparison
 */
import 'dotenv/config';

const AETHENE_URL = 'http://localhost:3006';
const SUPERMEMORY_URL = 'https://api.supermemory.ai';
const AETHENE_KEY = 'ae_dev_test123';
const SM_KEY = process.env.SUPERMEMORY_API_KEY;

const TAG = `test_${Date.now()}`;

const FACTS = [
  "Emma works as a data scientist at Netflix",
  "Emma has a golden retriever named Max",
  "Emma graduated from Stanford in 2019",
  "Emma lives in San Francisco",
  "Emma's favorite food is sushi",
];

const QUESTIONS = [
  { q: "Where does Emma work?", expected: "Netflix" },
  { q: "What pet does Emma have?", expected: "golden" },
  { q: "Where did Emma go to school?", expected: "Stanford" },
  { q: "What food does Emma like?", expected: "sushi" },
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function checkMatch(ctx: string, exp: string): boolean {
  return ctx.toLowerCase().includes(exp.toLowerCase());
}

async function testAethene(): Promise<{ score: number; errors: string[] }> {
  const errors: string[] = [];

  console.log('\n[Aethene] Ingesting 5 facts...');
  for (const fact of FACTS) {
    try {
      const resp = await fetch(`${AETHENE_URL}/v3/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
        body: JSON.stringify({ content: fact, containerTag: TAG })
      });
      if (!resp.ok) {
        const err = await resp.text();
        errors.push(`Ingest ${resp.status}: ${err.slice(0, 50)}`);
      }
    } catch (e: any) {
      errors.push(`Ingest: ${e.message}`);
    }
  }

  console.log('[Aethene] Waiting 20s for processing...');
  await sleep(20000);

  let score = 0;
  for (const test of QUESTIONS) {
    try {
      const resp = await fetch(`${AETHENE_URL}/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
        body: JSON.stringify({ query: test.q, containerTag: TAG, limit: 5, mode: 'memories' })
      });
      if (!resp.ok) {
        errors.push(`Search ${resp.status}`);
        console.log(`  ✗ ${test.q} -> ERROR`);
        continue;
      }
      const data = await resp.json();
      const ctx = data.results?.map((r: any) => r.memory).join(' ') || '';
      const match = checkMatch(ctx, test.expected);
      if (match) score++;
      console.log(`  ${match ? '✓' : '✗'} ${test.q}`);
    } catch (e: any) {
      errors.push(`Search: ${e.message}`);
    }
  }

  return { score, errors };
}

async function testSupermemory(): Promise<{ score: number; errors: string[] }> {
  if (!SM_KEY) {
    return { score: -1, errors: ['No API key'] };
  }

  const errors: string[] = [];
  const smTag = `${TAG}_sm`;

  console.log('\n[Supermemory] Ingesting 5 facts...');
  for (const fact of FACTS) {
    try {
      const resp = await fetch(`${SUPERMEMORY_URL}/v3/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
        body: JSON.stringify({ content: fact, containerTag: smTag })
      });
      if (!resp.ok) {
        errors.push(`SM Ingest ${resp.status}`);
      }
    } catch (e: any) {
      errors.push(`SM: ${e.message}`);
    }
  }

  console.log('[Supermemory] Waiting 20s for processing...');
  await sleep(20000);

  let score = 0;
  for (const test of QUESTIONS) {
    try {
      const resp = await fetch(`${SUPERMEMORY_URL}/v3/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
        body: JSON.stringify({ q: test.q, containerTags: [smTag] })
      });
      if (!resp.ok) {
        errors.push(`SM Search ${resp.status}`);
        console.log(`  ✗ ${test.q} -> ERROR`);
        continue;
      }
      const data = await resp.json();
      const ctx = data.results?.flatMap((r: any) => r.chunks?.map((c: any) => c.content) || []).join(' ') || '';
      const match = checkMatch(ctx, test.expected);
      if (match) score++;
      console.log(`  ${match ? '✓' : '✗'} ${test.q}`);
    } catch (e: any) {
      errors.push(`SM: ${e.message}`);
    }
  }

  return { score, errors };
}

async function main() {
  console.log('='.repeat(50));
  console.log('  QUICK TEST: Aethene vs Supermemory');
  console.log('='.repeat(50));

  const [aResult, sResult] = await Promise.all([
    testAethene(),
    testSupermemory()
  ]);

  console.log('\n' + '='.repeat(50));
  console.log('  RESULTS');
  console.log('='.repeat(50));

  const aPercent = (aResult.score / QUESTIONS.length * 100).toFixed(0);
  console.log(`\n  Aethene:     ${aResult.score}/${QUESTIONS.length} (${aPercent}%)`);
  if (aResult.errors.length) console.log(`    Errors: ${aResult.errors.join(', ')}`);

  if (sResult.score >= 0) {
    const sPercent = (sResult.score / QUESTIONS.length * 100).toFixed(0);
    console.log(`  Supermemory: ${sResult.score}/${QUESTIONS.length} (${sPercent}%)`);
    if (sResult.errors.length) console.log(`    Errors: ${sResult.errors.join(', ')}`);
  } else {
    console.log('  Supermemory: SKIPPED (no API key)');
  }

  console.log('\n' + '='.repeat(50));

  if (aResult.score >= 3) {
    console.log('✓ Aethene OK');
  } else {
    console.log('⚠️ Aethene has issues!');
    process.exit(1);
  }
}

main().catch(console.error);
