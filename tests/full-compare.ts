/**
 * Full Aethene vs Supermemory comparison - 15 questions
 * Tests EXTRACTION capability by ingesting raw content
 */
import 'dotenv/config';

const AETHENE_URL = 'http://localhost:3006';
const SUPERMEMORY_URL = 'https://api.supermemory.ai';
const AETHENE_KEY = 'ae_dev_test123';
const SM_KEY = process.env.SUPERMEMORY_API_KEY;

const TAG = `fulltest_${Date.now()}`;

// Raw content - NOT pre-split facts
const CONTENT = `
Alex Chen is a 32-year-old software architect working at Stripe. He graduated from UC Berkeley
with a Master's degree in Computer Science back in 2015. These days, Alex lives in Oakland,
California with his wife Michelle and their two cats, Luna and Mochi.

Alex is passionate about programming - his favorite language is Rust, though he works with
many others at Stripe. Every Wednesday evening, he plays basketball at the local YMCA to
stay active. He's originally from Seattle, Washington, where his mother Patricia still lives.
She's a retired nurse.

Alex drives a Tesla Model 3 and is vegetarian - he absolutely loves Thai food. Last year,
he started learning piano as a new hobby. His salary at Stripe is $280,000 per year.

His younger sister Emily works at Google as a product manager. Alex ran his first marathon
in November 2024 and is now planning a trip to Japan for April 2026.
`;

const QUESTIONS = [
  { q: "Where does Alex work?", expected: "Stripe" },
  { q: "What degree does Alex have?", expected: "Master" },
  { q: "Who is Alex's wife?", expected: "Michelle" },
  { q: "What pets does Alex have?", expected: "cat" },
  { q: "What programming language does Alex prefer?", expected: "Rust" },
  { q: "What sport does Alex play?", expected: "basketball" },
  { q: "Where is Alex originally from?", expected: "Seattle" },
  { q: "What is Alex's mother's name?", expected: "Patricia" },
  { q: "What car does Alex drive?", expected: "Tesla" },
  { q: "What is Alex's diet?", expected: "vegetarian" },
  { q: "What instrument is Alex learning?", expected: "piano" },
  { q: "How much does Alex earn?", expected: "280" },
  { q: "Where does Alex's sister work?", expected: "Google" },
  { q: "When did Alex run a marathon?", expected: "November" },
  { q: "Where is Alex planning to travel?", expected: "Japan" },
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function checkMatch(ctx: string, exp: string): boolean {
  return ctx.toLowerCase().includes(exp.toLowerCase());
}

async function testAethene(): Promise<{ score: number; details: string[]; errors: string[] }> {
  const errors: string[] = [];
  const details: string[] = [];

  console.log('\n[Aethene] Ingesting raw content (1 document)...');
  try {
    const resp = await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ content: CONTENT, containerTag: TAG })
    });
    if (!resp.ok) {
      const err = await resp.text();
      errors.push(`Ingest ${resp.status}: ${err.slice(0, 100)}`);
      console.log(`  ERROR: ${err.slice(0, 100)}`);
    } else {
      const data = await resp.json();
      console.log(`  ✓ Ingested - extracted ${data.memoriesCreated || '?'} memories`);
    }
  } catch (e: any) {
    errors.push(`Ingest: ${e.message}`);
  }

  console.log('[Aethene] Waiting 35s for processing...');
  await sleep(35000);

  let score = 0;
  console.log('[Aethene] Testing retrieval:');
  for (const test of QUESTIONS) {
    try {
      const resp = await fetch(`${AETHENE_URL}/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
        body: JSON.stringify({ query: test.q, containerTag: TAG, limit: 5, mode: 'memories' })
      });
      if (!resp.ok) {
        errors.push(`Search ${resp.status}`);
        details.push(`✗ ${test.q}`);
        continue;
      }
      const data = await resp.json();
      const memories = data.results?.map((r: any) => r.memory) || [];
      const ctx = memories.join(' ');
      const match = checkMatch(ctx, test.expected);
      if (match) score++;
      const mark = match ? '✓' : '✗';
      console.log(`  ${mark} ${test.q} [${test.expected}]`);
      if (!match) {
        details.push(`✗ ${test.q} - expected "${test.expected}" - got: ${memories[0]?.slice(0, 60) || 'nothing'}...`);
      }
    } catch (e: any) {
      errors.push(`Search: ${e.message}`);
    }
  }

  return { score, details, errors };
}

async function testSupermemory(): Promise<{ score: number; details: string[]; errors: string[] }> {
  if (!SM_KEY) {
    return { score: -1, details: [], errors: ['No API key'] };
  }

  const errors: string[] = [];
  const details: string[] = [];
  const smTag = `${TAG}_sm`;

  console.log('\n[Supermemory] Ingesting raw content (1 document)...');
  try {
    const resp = await fetch(`${SUPERMEMORY_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
      body: JSON.stringify({ content: CONTENT, containerTag: smTag })
    });
    if (!resp.ok) {
      errors.push(`SM Ingest ${resp.status}`);
    } else {
      console.log('  ✓ Ingested');
    }
  } catch (e: any) {
    errors.push(`SM: ${e.message}`);
  }

  console.log('[Supermemory] Waiting 35s for processing...');
  await sleep(35000);

  let score = 0;
  console.log('[Supermemory] Testing retrieval:');
  for (const test of QUESTIONS) {
    try {
      const resp = await fetch(`${SUPERMEMORY_URL}/v3/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
        body: JSON.stringify({ q: test.q, containerTags: [smTag] })
      });
      if (!resp.ok) {
        errors.push(`SM Search ${resp.status}`);
        details.push(`✗ ${test.q}`);
        continue;
      }
      const data = await resp.json();
      const chunks = data.results?.flatMap((r: any) => r.chunks?.map((c: any) => c.content) || []) || [];
      const ctx = chunks.join(' ');
      const match = checkMatch(ctx, test.expected);
      if (match) score++;
      const mark = match ? '✓' : '✗';
      console.log(`  ${mark} ${test.q} [${test.expected}]`);
      if (!match) {
        details.push(`✗ ${test.q} - expected "${test.expected}" - got: ${chunks[0]?.slice(0, 60) || 'nothing'}...`);
      }
    } catch (e: any) {
      errors.push(`SM: ${e.message}`);
    }
  }

  return { score, details, errors };
}

async function main() {
  console.log('='.repeat(60));
  console.log('  FULL EXTRACTION TEST: 15 Questions');
  console.log('  (Single document ingestion - tests extraction quality)');
  console.log('='.repeat(60));

  const aResult = await testAethene();
  const sResult = await testSupermemory();

  console.log('\n' + '='.repeat(60));
  console.log('  FINAL RESULTS');
  console.log('='.repeat(60));

  const aPercent = (aResult.score / QUESTIONS.length * 100).toFixed(0);
  console.log(`\n  AETHENE:     ${aResult.score}/${QUESTIONS.length} (${aPercent}%)`);
  if (aResult.errors.length) console.log(`    Errors: ${aResult.errors.slice(0, 3).join(', ')}`);

  if (sResult.score >= 0) {
    const sPercent = (sResult.score / QUESTIONS.length * 100).toFixed(0);
    console.log(`  SUPERMEMORY: ${sResult.score}/${QUESTIONS.length} (${sPercent}%)`);
    if (sResult.errors.length) console.log(`    Errors: ${sResult.errors.slice(0, 3).join(', ')}`);
  } else {
    console.log('  SUPERMEMORY: SKIPPED (no API key)');
  }

  // Show misses
  if (aResult.details.length > 0) {
    console.log('\n  Aethene Misses:');
    aResult.details.forEach(d => console.log(`    ${d}`));
  }
  if (sResult.details.length > 0) {
    console.log('\n  Supermemory Misses:');
    sResult.details.forEach(d => console.log(`    ${d}`));
  }

  console.log('\n' + '='.repeat(60));

  // Compare
  if (sResult.score >= 0) {
    if (aResult.score > sResult.score) {
      console.log('🏆 AETHENE WINS');
    } else if (sResult.score > aResult.score) {
      console.log('🏆 SUPERMEMORY WINS');
    } else {
      console.log('🤝 TIE');
    }
  }

  if (aResult.score >= QUESTIONS.length * 0.8) {
    console.log('✓ Aethene quality OK (80%+ accuracy)');
  } else if (aResult.score >= QUESTIONS.length * 0.6) {
    console.log('⚠️ Aethene quality degraded (60-80%)');
  } else {
    console.log('❌ Aethene quality issues (<60%)');
    process.exit(1);
  }
}

main().catch(console.error);
