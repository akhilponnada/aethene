/**
 * Aethene vs Supermemory Comparison Test
 */
import 'dotenv/config';

const AETHENE_URL = 'http://localhost:3006';
const SUPERMEMORY_URL = 'https://api.supermemory.ai';
const AETHENE_KEY = 'ae_dev_test123';
const SUPERMEMORY_KEY = process.env.SUPERMEMORY_API_KEY;

const TAG = `compare_${Date.now()}`;

// Test data - same for both
const FACTS = [
  "Sarah is a software engineer at Google who specializes in machine learning",
  "Sarah has a golden retriever named Luna who is 3 years old",
  "Sarah's favorite programming language is Python",
  "Sarah moved to San Francisco in 2021 from Boston",
  "Sarah's husband is named David and he works as a doctor",
  "Sarah enjoys hiking on weekends in Yosemite",
  "Sarah is learning to play piano and practices every evening",
  "Sarah's birthday is on March 15th",
];

const QUESTIONS = [
  { q: "Where does Sarah work?", expected: "Google" },
  { q: "What pet does Sarah have?", expected: "dog" },
  { q: "What city does Sarah live in?", expected: "San Francisco" },
  { q: "What is Sarah's hobby?", expected: "hiking" },
  { q: "Who is David?", expected: "husband" },
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function checkMatch(context: string, expected: string): boolean {
  const ctx = context.toLowerCase();
  const exp = expected.toLowerCase();

  // Direct match
  if (ctx.includes(exp)) return true;

  // Synonym matching for common terms
  const synonyms: Record<string, string[]> = {
    'dog': ['retriever', 'puppy', 'canine', 'golden retriever', 'labrador'],
    'cat': ['kitten', 'feline'],
    'wife': ['spouse', 'partner', 'married'],
    'husband': ['spouse', 'partner', 'married'],
  };

  if (synonyms[exp]) {
    return synonyms[exp].some(syn => ctx.includes(syn));
  }

  return false;
}

async function testAethene(): Promise<number> {
  console.log('\n📦 AETHENE TEST');
  console.log('─'.repeat(40));

  // Ingest
  console.log('Ingesting...');
  for (const fact of FACTS) {
    await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ content: fact, containerTag: TAG })
    });
  }

  console.log('Waiting 15s for processing...');
  await sleep(15000);

  // Test
  let correct = 0;
  for (const test of QUESTIONS) {
    const resp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ query: test.q, containerTag: TAG, limit: 5, mode: 'memories' })
    });
    const data = await resp.json();
    const context = data.results?.map((r: any) => r.memory).join(' ') || '';
    const match = checkMatch(context, test.expected);
    if (match) correct++;
    console.log(`${match ? '✅' : '❌'} ${test.q} → ${test.expected}`);
  }

  return correct;
}

async function testSupermemory(): Promise<number> {
  if (!SUPERMEMORY_KEY) {
    console.log('\n⚠️  SUPERMEMORY_API_KEY not set, skipping');
    return -1;
  }

  console.log('\n🧠 SUPERMEMORY TEST');
  console.log('─'.repeat(40));

  // Ingest
  console.log('Ingesting...');
  for (const fact of FACTS) {
    try {
      await fetch(`${SUPERMEMORY_URL}/v3/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPERMEMORY_KEY}` },
        body: JSON.stringify({ content: fact, containerTag: TAG })
      });
    } catch (e) {
      // Continue
    }
  }

  console.log('Waiting 15s for processing...');
  await sleep(15000);

  // Test
  let correct = 0;
  for (const test of QUESTIONS) {
    try {
      const resp = await fetch(`${SUPERMEMORY_URL}/v3/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPERMEMORY_KEY}` },
        body: JSON.stringify({ q: test.q, containerTags: [TAG] })
      });
      const data = await resp.json();
      const context = data.results?.flatMap((r: any) => r.chunks?.map((c: any) => c.content) || []).join(' ') || '';
      const match = checkMatch(context, test.expected);
      if (match) correct++;
      console.log(`${match ? '✅' : '❌'} ${test.q} → ${test.expected}`);
    } catch (e) {
      console.log(`❌ ${test.q} → ERROR`);
    }
  }

  return correct;
}

async function main() {
  console.log('═'.repeat(50));
  console.log('   AETHENE vs SUPERMEMORY COMPARISON');
  console.log('═'.repeat(50));
  console.log(`\nFacts: ${FACTS.length} | Questions: ${QUESTIONS.length}`);

  const aetheneScore = await testAethene();
  const supermemoryScore = await testSupermemory();

  console.log('\n' + '═'.repeat(50));
  console.log('   RESULTS');
  console.log('═'.repeat(50));
  console.log(`\n  AETHENE:     ${aetheneScore}/${QUESTIONS.length} (${(aetheneScore/QUESTIONS.length*100).toFixed(0)}%)`);
  if (supermemoryScore >= 0) {
    console.log(`  SUPERMEMORY: ${supermemoryScore}/${QUESTIONS.length} (${(supermemoryScore/QUESTIONS.length*100).toFixed(0)}%)`);
  } else {
    console.log(`  SUPERMEMORY: (skipped - no API key)`);
  }
  console.log('\n' + '═'.repeat(50));
}

main().catch(console.error);
