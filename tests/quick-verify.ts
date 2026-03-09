/**
 * Quick verification test for containerTag fix
 */
import 'dotenv/config';

const AETHENE_URL = 'http://localhost:3006';
const API_KEY = 'ae_dev_test123';
const TAG = `verify_${Date.now()}`;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Quick Verification Test ===\n');
  console.log(`ContainerTag: ${TAG}\n`);

  // Ingest some facts
  const facts = [
    "Alice works at Google as a software engineer",
    "Alice loves hiking and photography",
    "Bob is Alice's brother who lives in Seattle",
    "Alice has a dog named Max",
  ];

  console.log('1. Ingesting facts...');
  for (const fact of facts) {
    await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ content: fact, containerTag: TAG })
    });
  }
  console.log('   Done\n');

  console.log('2. Waiting 15s for processing...\n');
  await sleep(15000);

  // Test queries
  const tests = [
    { q: "Where does Alice work?", expected: "Google" },
    { q: "What does Alice like to do?", expected: "hiking" },
    { q: "Who is Bob?", expected: "brother" },
    { q: "What pet does Alice have?", expected: "dog" },
  ];

  console.log('3. Testing recall:\n');
  let passed = 0;

  for (const test of tests) {
    const resp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ query: test.q, containerTag: TAG, limit: 3, mode: 'memories' })
    });
    const data = await resp.json();
    const context = data.results?.map((r: any) => r.memory).join(' ') || '';
    const match = context.toLowerCase().includes(test.expected.toLowerCase());

    if (match) passed++;
    console.log(`   ${match ? '✅' : '❌'} ${test.q}`);
    console.log(`      Expected: ${test.expected}`);
    console.log(`      Got: ${context.slice(0, 100)}...\n`);
  }

  console.log(`=== Result: ${passed}/${tests.length} (${(passed/tests.length*100).toFixed(0)}%) ===`);
}

main().catch(console.error);
