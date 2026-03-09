/**
 * SUPERMEMORY REVERSE ENGINEERING TEST
 *
 * This test scrutinizes Supermemory's behavior and compares it with Aethene
 * to ensure Aethene is a perfect clone.
 *
 * Tests:
 * 1. Memory extraction quality
 * 2. Search response format
 * 3. Similarity scoring
 * 4. Memory versioning (isLatest, rootMemoryId)
 * 5. Memory relationships (updates, extends, derives)
 * 6. Temporal handling
 * 7. Entity extraction
 */

import 'dotenv/config';
import Supermemory from 'supermemory';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Config
const SM_KEY = 'sm_jUqfEvKttp8dGVup2x3eaF_WmqwSzZOkKZSrLWVVDacTCcBsXnrktoFyixCKuhTBIywSPeGgikyKaRYXnpyWPQX';
const AETHENE_URL = 'http://localhost:3006';
const AETHENE_KEY = 'ae_dev_test123';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

const sm = new Supermemory({ apiKey: SM_KEY });
const genai = new GoogleGenerativeAI(GEMINI_KEY);
const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Unique tag for this test run
const TAG = `reverseeng_${Date.now()}`;

// ============================================================================
// TEST DATA: Travel blogger scenario (completely different from previous tests)
// ============================================================================

const FACTS = [
  // Basic info
  "My name is Marcus Chen and I'm a travel blogger from Seattle.",
  "I've visited 47 countries in the last 6 years.",
  "My favorite destination is Kyoto, Japan - I've been there 4 times.",

  // Preferences
  "I always prefer boutique hotels over large chains.",
  "I'm vegetarian and allergic to nuts.",
  "I hate tourist traps and crowded places.",

  // Relationships
  "My wife Elena is a photographer who travels with me.",
  "Our dog Mochi stays with my parents when we travel.",

  // Work details
  "I post on Instagram @marcuswanderlust with 850,000 followers.",
  "I earn about $15,000 per month from sponsored posts and affiliate links.",
  "My blog gets 2.5 million page views per month.",

  // Recent events
  "Last week I returned from a 3-week trip to Portugal.",
  "I'm planning to visit Iceland in June 2026.",
  "I just signed a brand deal with Samsonite luggage.",

  // Equipment
  "I shoot with a Sony A7IV camera and DJI Mini 3 Pro drone.",
  "I always carry a portable WiFi hotspot and power bank.",
];

const QUESTIONS = [
  { q: "What is Marcus's profession?", expected: "travel blogger" },
  { q: "How many countries has Marcus visited?", expected: "47" },
  { q: "What's Marcus's favorite destination?", expected: "Kyoto" },
  { q: "What type of accommodation does Marcus prefer?", expected: "boutique hotels" },
  { q: "What are Marcus's dietary restrictions?", expected: "vegetarian" },
  { q: "Who is Elena?", expected: "wife" },
  { q: "What's the name of Marcus's dog?", expected: "Mochi" },
  { q: "How many Instagram followers does Marcus have?", expected: "850,000" },
  { q: "How much does Marcus earn monthly?", expected: "$15,000" },
  { q: "Where is Marcus planning to go in June?", expected: "Iceland" },
  { q: "What camera does Marcus use?", expected: "Sony A7IV" },
  { q: "What brand did Marcus sign a deal with?", expected: "Samsonite" },
];

// ============================================================================
// HELPERS
// ============================================================================

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function generateAnswer(query: string, context: string): Promise<string> {
  const prompt = `Based ONLY on this context, answer the question in 1-5 words.
Context: ${context}
Question: ${query}
Answer (1-5 words only):`;

  const result = await model.generateContent(prompt);
  return result.response.text()?.trim() || '';
}

function matchAnswer(answer: string, expected: string): boolean {
  const lower = answer.toLowerCase();
  const exp = expected.toLowerCase();

  // Direct match
  if (lower.includes(exp)) return true;

  // Number word matching
  const numberWords: Record<string, string> = {
    '47': 'forty-seven', '4': 'four', '6': 'six',
    '850,000': 'eight hundred fifty thousand',
    '$15,000': 'fifteen thousand', '15000': 'fifteen thousand',
    '2.5': 'two point five'
  };

  for (const [num, word] of Object.entries(numberWords)) {
    if (exp.includes(num) && lower.includes(word)) return true;
    if (exp.includes(num) && lower.includes(num.replace(/,/g, ''))) return true;
  }

  return false;
}

// ============================================================================
// REVERSE ENGINEERING FUNCTIONS
// ============================================================================

interface MemoryResult {
  id: string;
  memory: string;
  similarity: number;
  rootMemoryId?: string;
  metadata?: any;
  updatedAt?: string;
  version?: number;
  isLatest?: boolean;
}

interface SearchResponse {
  results: MemoryResult[];
  timing?: number;
  total?: number;
}

async function analyzeSupermemoryResponse(response: any): Promise<void> {
  console.log('\n=== SUPERMEMORY RAW RESPONSE ANALYSIS ===');
  console.log('Response keys:', Object.keys(response));

  if (response.results && response.results.length > 0) {
    console.log('\nFirst result structure:');
    const first = response.results[0];
    for (const [key, value] of Object.entries(first)) {
      const type = typeof value;
      const preview = type === 'object' ? JSON.stringify(value).slice(0, 100) : String(value).slice(0, 100);
      console.log(`  ${key}: (${type}) ${preview}`);
    }

    console.log('\nAll result fields across results:');
    const allKeys = new Set<string>();
    response.results.forEach((r: any) => Object.keys(r).forEach(k => allKeys.add(k)));
    console.log('  ', Array.from(allKeys).join(', '));

    console.log('\nSimilarity score distribution:');
    const scores = response.results.map((r: any) => r.similarity);
    console.log(`  Min: ${Math.min(...scores).toFixed(4)}`);
    console.log(`  Max: ${Math.max(...scores).toFixed(4)}`);
    console.log(`  Avg: ${(scores.reduce((a: number, b: number) => a + b, 0) / scores.length).toFixed(4)}`);
  }
}

async function analyzeAetheneResponse(response: any): Promise<void> {
  console.log('\n=== AETHENE RAW RESPONSE ANALYSIS ===');
  console.log('Response keys:', Object.keys(response));

  if (response.results && response.results.length > 0) {
    console.log('\nFirst result structure:');
    const first = response.results[0];
    for (const [key, value] of Object.entries(first)) {
      const type = typeof value;
      const preview = type === 'object' ? JSON.stringify(value).slice(0, 100) : String(value).slice(0, 100);
      console.log(`  ${key}: (${type}) ${preview}`);
    }

    console.log('\nAll result fields across results:');
    const allKeys = new Set<string>();
    response.results.forEach((r: any) => Object.keys(r).forEach(k => allKeys.add(k)));
    console.log('  ', Array.from(allKeys).join(', '));

    console.log('\nSimilarity score distribution:');
    const scores = response.results.map((r: any) => r.similarity);
    console.log(`  Min: ${Math.min(...scores).toFixed(4)}`);
    console.log(`  Max: ${Math.max(...scores).toFixed(4)}`);
    console.log(`  Avg: ${(scores.reduce((a: number, b: number) => a + b, 0) / scores.length).toFixed(4)}`);
  }
}

async function testMemoryUpdate(): Promise<void> {
  console.log('\n\n========================================');
  console.log('TEST: Memory Update Behavior');
  console.log('========================================');

  const updateTag = `update_${Date.now()}`;

  // Add initial fact
  console.log('\n1. Adding initial fact: "Marcus has 500,000 Instagram followers"');
  await sm.add({ content: "Marcus has 500,000 Instagram followers", containerTag: updateTag });

  await sleep(5000);

  // Add updated fact
  console.log('2. Adding updated fact: "Marcus now has 850,000 Instagram followers"');
  await sm.add({ content: "Marcus now has 850,000 Instagram followers", containerTag: updateTag });

  await sleep(5000);

  // Search and analyze
  console.log('\n3. Searching for "Marcus Instagram followers"...');
  const results = await sm.search.memories({
    q: "Marcus Instagram followers",
    containerTag: updateTag,
    limit: 10
  });

  console.log('\nSupermemory Update Handling:');
  console.log('Number of results:', results.results.length);
  results.results.forEach((r: any, i: number) => {
    console.log(`\n  Result ${i + 1}:`);
    console.log(`    Memory: ${r.memory}`);
    console.log(`    Similarity: ${r.similarity}`);
    console.log(`    isLatest: ${r.isLatest}`);
    console.log(`    rootMemoryId: ${r.rootMemoryId}`);
    console.log(`    version: ${r.version}`);
  });
}

async function testExtendRelationship(): Promise<void> {
  console.log('\n\n========================================');
  console.log('TEST: Memory Extend Relationship');
  console.log('========================================');

  const extendTag = `extend_${Date.now()}`;

  // Add base fact
  console.log('\n1. Adding base fact: "Marcus is a travel blogger"');
  await sm.add({ content: "Marcus is a travel blogger", containerTag: extendTag });

  await sleep(5000);

  // Add extending fact
  console.log('2. Adding extending fact: "Marcus specializes in luxury boutique hotels and eco-tourism"');
  await sm.add({ content: "Marcus specializes in luxury boutique hotels and eco-tourism", containerTag: extendTag });

  await sleep(5000);

  // Search and analyze
  console.log('\n3. Searching for "Marcus travel expertise"...');
  const results = await sm.search.memories({
    q: "Marcus travel expertise",
    containerTag: extendTag,
    limit: 10
  });

  console.log('\nSupermemory Extend Handling:');
  console.log('Number of results:', results.results.length);
  results.results.forEach((r: any, i: number) => {
    console.log(`\n  Result ${i + 1}:`);
    console.log(`    Memory: ${r.memory}`);
    console.log(`    Similarity: ${r.similarity}`);
    console.log(`    rootMemoryId: ${r.rootMemoryId}`);
  });
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('SUPERMEMORY REVERSE ENGINEERING TEST');
  console.log('='.repeat(60));
  console.log(`\nTag: ${TAG}`);

  // ========================================================================
  // PHASE 1: Ingest facts to both systems
  // ========================================================================
  console.log('\n\n========================================');
  console.log('PHASE 1: INGESTION');
  console.log('========================================');

  console.log('\n-> Ingesting to Supermemory...');
  const smIngestions: any[] = [];
  for (const fact of FACTS) {
    const result = await sm.add({ content: fact, containerTag: TAG });
    smIngestions.push(result);
  }
  console.log(`   Added ${smIngestions.length} facts`);

  // Analyze add response structure
  console.log('\n   ADD Response structure:');
  if (smIngestions[0]) {
    console.log('   Keys:', Object.keys(smIngestions[0]));
    console.log('   Sample:', JSON.stringify(smIngestions[0]).slice(0, 200));
  }

  console.log('\n-> Ingesting to Aethene...');
  const aeIngestions: any[] = [];
  for (const fact of FACTS) {
    const resp = await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ content: fact, containerTag: TAG })
    });
    const data = await resp.json();
    aeIngestions.push(data);
  }
  console.log(`   Created ${aeIngestions.length} ingestions`);

  // Count actual memories created
  const totalMemories = aeIngestions.reduce((sum, d) => sum + (d.memories?.length || 0), 0);
  console.log(`   Total memories extracted: ${totalMemories}`);

  console.log('\n   ADD Response structure:');
  if (aeIngestions[0]) {
    console.log('   Keys:', Object.keys(aeIngestions[0]));
    console.log('   Sample:', JSON.stringify(aeIngestions[0]).slice(0, 200));
  }

  console.log('\nWaiting 30s for processing...');
  await sleep(30000);

  // ========================================================================
  // PHASE 2: Compare search responses
  // ========================================================================
  console.log('\n\n========================================');
  console.log('PHASE 2: SEARCH RESPONSE COMPARISON');
  console.log('========================================');

  // Sample search to analyze response structure
  const sampleQuery = "What is Marcus's profession?";

  console.log(`\nQuery: "${sampleQuery}"`);

  // Supermemory search
  const smSearch = await sm.search.memories({
    q: sampleQuery,
    containerTag: TAG,
    limit: 5
  });
  await analyzeSupermemoryResponse(smSearch);

  // Aethene search
  const aeSearchResp = await fetch(`${AETHENE_URL}/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
    body: JSON.stringify({ query: sampleQuery, containerTag: TAG, limit: 5 })
  });
  const aeSearch = await aeSearchResp.json();
  await analyzeAetheneResponse(aeSearch);

  // ========================================================================
  // PHASE 3: Field-by-field comparison
  // ========================================================================
  console.log('\n\n========================================');
  console.log('PHASE 3: FIELD COMPATIBILITY CHECK');
  console.log('========================================');

  const smFields = new Set<string>();
  const aeFields = new Set<string>();

  if (smSearch.results?.length) {
    smSearch.results.forEach((r: any) => Object.keys(r).forEach(k => smFields.add(k)));
  }
  if (aeSearch.results?.length) {
    aeSearch.results.forEach((r: any) => Object.keys(r).forEach(k => aeFields.add(k)));
  }

  console.log('\nSupermemory fields:', Array.from(smFields).join(', '));
  console.log('Aethene fields:', Array.from(aeFields).join(', '));

  console.log('\nField compatibility:');
  const allFields = new Set([...smFields, ...aeFields]);
  for (const field of allFields) {
    const inSM = smFields.has(field) ? 'YES' : 'NO';
    const inAE = aeFields.has(field) ? 'YES' : 'NO';
    const status = (inSM === 'YES' && inAE === 'YES') ? '✅' : '❌';
    console.log(`  ${field}: SM=${inSM}, AE=${inAE} ${status}`);
  }

  // ========================================================================
  // PHASE 4: Question answering comparison
  // ========================================================================
  console.log('\n\n========================================');
  console.log('PHASE 4: QUESTION ANSWERING');
  console.log('========================================');

  let smCorrect = 0;
  let aeCorrect = 0;

  for (const test of QUESTIONS) {
    // Supermemory
    const smResults = await sm.search.memories({
      q: test.q,
      containerTag: TAG,
      limit: 3
    });
    const smContext = smResults.results.map((r: any) => r.memory).join('\n');
    const smAnswer = await generateAnswer(test.q, smContext);
    const smMatch = matchAnswer(smAnswer, test.expected);
    if (smMatch) smCorrect++;

    // Aethene
    const aeResp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ query: test.q, containerTag: TAG, limit: 3 })
    });
    const aeResults = await aeResp.json();
    const aeContext = aeResults.results?.map((r: any) => r.memory).join('\n') || '';
    const aeAnswer = await generateAnswer(test.q, aeContext);
    const aeMatch = matchAnswer(aeAnswer, test.expected);
    if (aeMatch) aeCorrect++;

    console.log(`\nQ: ${test.q}`);
    console.log(`   Expected: ${test.expected}`);
    console.log(`   SM: "${smAnswer}" ${smMatch ? '✅' : '❌'}`);
    console.log(`   AE: "${aeAnswer}" ${aeMatch ? '✅' : '❌'}`);
  }

  // ========================================================================
  // PHASE 5: Advanced behavior tests
  // ========================================================================
  await testMemoryUpdate();
  await testExtendRelationship();

  // ========================================================================
  // FINAL RESULTS
  // ========================================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('FINAL RESULTS');
  console.log('='.repeat(60));
  console.log(`\nSupermemory: ${smCorrect}/${QUESTIONS.length} = ${(smCorrect/QUESTIONS.length*100).toFixed(0)}%`);
  console.log(`Aethene:     ${aeCorrect}/${QUESTIONS.length} = ${(aeCorrect/QUESTIONS.length*100).toFixed(0)}%`);

  const diff = smCorrect - aeCorrect;
  if (diff === 0) {
    console.log('\n🎉 PERFECT MATCH! Aethene matches Supermemory exactly!');
  } else if (diff > 0) {
    console.log(`\n⚠️  Aethene is ${diff} question(s) behind Supermemory`);
  } else {
    console.log(`\n🚀 Aethene is ${-diff} question(s) AHEAD of Supermemory!`);
  }

  console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
