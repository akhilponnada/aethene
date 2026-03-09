/**
 * Aethene vs Supermemory Comparison Test #2
 * Different dataset - Tech startup founder
 */
import 'dotenv/config';

const AETHENE_URL = 'http://localhost:3006';
const SUPERMEMORY_URL = 'https://api.supermemory.ai';
const AETHENE_KEY = 'ae_dev_test123';
const SUPERMEMORY_KEY = process.env.SUPERMEMORY_API_KEY;

const TAG = `compare2_${Date.now()}`;

// Different test data - tech founder
const FACTS = [
  "Michael founded a startup called NeuralPath in 2022",
  "Michael's company NeuralPath focuses on AI-powered healthcare diagnostics",
  "Michael graduated from MIT with a PhD in Computer Science",
  "Michael has raised $15 million in Series A funding",
  "Michael's co-founder is Emily Chen who handles business operations",
  "Michael lives in Austin, Texas with his wife Rachel",
  "Michael has two cats named Pixel and Byte",
  "Michael's favorite hobby is playing chess competitively",
  "Michael previously worked at Google as a research scientist",
  "Michael is originally from Chicago and moved to Austin in 2021",
];

const QUESTIONS = [
  { q: "What company did Michael start?", expected: "NeuralPath" },
  { q: "Where did Michael go to school?", expected: "MIT" },
  { q: "How much funding did Michael raise?", expected: "15 million" },
  { q: "Who is Michael's co-founder?", expected: "Emily" },
  { q: "What pets does Michael have?", expected: "cat" },
  { q: "Where does Michael live?", expected: "Austin" },
  { q: "What does Michael like to do for fun?", expected: "chess" },
  { q: "Where did Michael work before?", expected: "Google" },
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function checkMatch(context: string, expected: string): boolean {
  const ctx = context.toLowerCase();
  const exp = expected.toLowerCase();
  if (ctx.includes(exp)) return true;

  const synonyms: Record<string, string[]> = {
    'cat': ['cats', 'kitten', 'feline', 'pixel', 'byte'],
    'dog': ['retriever', 'puppy', 'canine', 'golden retriever'],
  };

  if (synonyms[exp]) {
    return synonyms[exp].some(syn => ctx.includes(syn));
  }
  return false;
}

async function testAethene(): Promise<number> {
  console.log('\n AETHENE TEST');
  console.log('-'.repeat(40));

  console.log('Ingesting 10 facts...');
  for (const fact of FACTS) {
    await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ content: fact, containerTag: TAG })
    });
  }

  console.log('Waiting 15s for processing...');
  await sleep(15000);

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
    console.log(`${match ? 'Y' : 'X'} ${test.q} -> ${test.expected}`);
  }

  return correct;
}

async function testSupermemory(): Promise<number> {
  if (!SUPERMEMORY_KEY) {
    console.log('\n[!] SUPERMEMORY_API_KEY not set, skipping');
    return -1;
  }

  console.log('\n SUPERMEMORY TEST');
  console.log('-'.repeat(40));

  console.log('Ingesting 10 facts...');
  for (const fact of FACTS) {
    try {
      await fetch(`${SUPERMEMORY_URL}/v3/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPERMEMORY_KEY}` },
        body: JSON.stringify({ content: fact, containerTags: [TAG] })
      });
    } catch (e) {
      // Continue
    }
  }

  console.log('Waiting 10s for processing...');
  await sleep(10000);

  let correct = 0;
  for (const test of QUESTIONS) {
    try {
      const resp = await fetch(`${SUPERMEMORY_URL}/v4/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPERMEMORY_KEY}` },
        body: JSON.stringify({ q: test.q, containerTags: [TAG], limit: 5 })
      });
      const data = await resp.json();
      const context = data.results?.map((r: any) => r.memory).join(' ') || '';
      const match = checkMatch(context, test.expected);
      if (match) correct++;
      console.log(`${match ? 'Y' : 'X'} ${test.q} -> ${test.expected}`);
    } catch (e) {
      console.log(`X ${test.q} -> ERROR`);
    }
  }

  return correct;
}

async function main() {
  console.log('='.repeat(50));
  console.log('  COMPARISON TEST #2: Tech Founder (Michael)');
  console.log('='.repeat(50));
  console.log(`\nFacts: ${FACTS.length} | Questions: ${QUESTIONS.length}`);

  const aetheneScore = await testAethene();
  const supermemoryScore = await testSupermemory();

  console.log('\n' + '='.repeat(50));
  console.log('  RESULTS');
  console.log('='.repeat(50));
  console.log(`\n  AETHENE:     ${aetheneScore}/${QUESTIONS.length} (${(aetheneScore/QUESTIONS.length*100).toFixed(0)}%)`);
  if (supermemoryScore >= 0) {
    console.log(`  SUPERMEMORY: ${supermemoryScore}/${QUESTIONS.length} (${(supermemoryScore/QUESTIONS.length*100).toFixed(0)}%)`);
  } else {
    console.log(`  SUPERMEMORY: (skipped - no API key)`);
  }
  console.log('\n' + '='.repeat(50));
}

main().catch(console.error);
