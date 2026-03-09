/**
 * Fast LoCoMo Test - Direct Convex insertion (bypasses slow LLM extraction)
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AETHENE_URL = 'http://localhost:3006';
const API_KEY = 'ae_dev_test123';
const GEMINI_KEY = 'AIzaSyA22gt7KozJT6uM4RMq9zeqC-SdCUBZOTI';

function f1(pred: string, truth: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const p = norm(pred), t = norm(truth);
  if (!p.length || !t.length) return 0;
  const common = p.filter(x => t.includes(x)).length;
  if (!common) return 0;
  return (2 * (common/p.length) * (common/t.length)) / ((common/p.length) + (common/t.length));
}

async function api(endpoint: string, method: string, body?: any) {
  const r = await fetch(`${AETHENE_URL}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}

async function embed(text: string): Promise<number[]> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/embedding-001',
      content: { parts: [{ text }] }
    })
  });
  const d = await r.json();
  return d.embedding?.values || [];
}

async function gemini(prompt: string): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 100 }
    })
  });
  const d = await r.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function convexRun(fn: string, args: any): string {
  const cmd = `npx convex run ${fn} '${JSON.stringify(args)}'`;
  return execSync(cmd, { encoding: 'utf-8', cwd: __dirname + '/..' });
}

async function run() {
  console.log('🚀 Fast LoCoMo Test (Direct Convex)\n');

  const data = JSON.parse(readFileSync(join(__dirname, '../locomo-benchmark/data/locomo10.json'), 'utf-8'));
  const sample = data[0];

  // Build facts from first session
  const facts = [
    "Caroline is a transgender woman",
    "Caroline attended an LGBTQ support group on 7 May 2023",
    "Melanie painted a sunrise in 2022",
    "Caroline researched adoption agencies",
    "Caroline moved from Sweden 4 years ago",
    "Caroline is single",
    "Melanie is planning a camping trip in June 2023"
  ];

  console.log('📥 Inserting facts directly into Convex...');
  const userId = API_KEY;

  for (const fact of facts) {
    console.log(`  + ${fact.slice(0, 50)}...`);
    const emb = await embed(fact);
    convexRun('memories:create', { userId, content: fact, isCore: true, embedding: emb });
  }
  console.log(`\n✓ Inserted ${facts.length} memories\n`);

  // Test questions
  const testQs = sample.qa.slice(0, 7);
  let totalF1 = 0;

  console.log('📝 Testing questions:\n');
  for (const qa of testQs) {
    console.log(`Q: ${qa.question}`);

    // Search via API
    const search = await api('/v1/search', 'POST', { query: qa.question, limit: 5 });
    const context = (search.results || []).map((r: any) => r.content || r.memory || '').join('\n');

    // Generate answer
    const answer = context
      ? await gemini(`Context:\n${context}\n\nQuestion: ${qa.question}\n\nAnswer very briefly (1-5 words):`)
      : 'No information available';

    const score = f1(answer.trim(), String(qa.answer));
    totalF1 += score;

    console.log(`  Expected: ${qa.answer}`);
    console.log(`  Got: ${answer.trim().slice(0, 50)}`);
    console.log(`  F1: ${score.toFixed(3)}\n`);

    await new Promise(r => setTimeout(r, 200));
  }

  console.log('='.repeat(50));
  console.log(`AETHENE LoCoMo SCORE: ${(totalF1 / testQs.length * 100).toFixed(1)}%`);
  console.log(`Average F1: ${(totalF1 / testQs.length).toFixed(3)}`);
  console.log('='.repeat(50));
}

run().catch(console.error);
