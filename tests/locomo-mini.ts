/**
 * Mini LoCoMo Test - 5 dialogs, 3 questions
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AETHENE_URL = 'http://localhost:3006';
const API_KEY = 'ae_dev_test123';
const GEMINI_KEY = 'process.env.GEMINI_API_KEY';

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

async function run() {
  console.log('🧪 Mini LoCoMo Test\n');

  const data = JSON.parse(readFileSync(join(__dirname, '../locomo-benchmark/data/locomo10.json'), 'utf-8'));
  const sample = data[0];
  const sess1 = sample.conversation.session_1;
  const dt = sample.conversation.session_1_date_time;

  // Ingest just 5 dialogs as separate memories
  console.log('📥 Ingesting 5 dialogs...');
  const memories = sess1.slice(0, 5).map((d: any) => ({
    content: `${d.speaker} said on ${dt}: "${d.compressed_text || d.clean_text || d.text}"`
  }));

  const ingestResult = await api('/v1/memories', 'POST', { memories });
  console.log(`  Created ${ingestResult.created || 0} memories\n`);

  // Wait for embeddings
  console.log('⏳ Waiting for embeddings...');
  await new Promise(r => setTimeout(r, 5000));

  // Test 3 questions
  const testQs = sample.qa.slice(0, 3);
  let totalF1 = 0;

  console.log('📝 Testing 3 questions:\n');
  for (const qa of testQs) {
    console.log(`Q: ${qa.question}`);

    // Search
    const search = await api('/v1/search', 'POST', { query: qa.question, limit: 3 });
    const context = (search.results || []).map((r: any) => r.content || r.memory || '').join('\n');
    console.log(`  Found ${search.results?.length || 0} results`);

    // Generate answer
    const answer = context
      ? await gemini(`Context:\n${context}\n\nQuestion: ${qa.question}\n\nAnswer briefly:`)
      : 'No information available';

    const score = f1(answer, String(qa.answer));
    totalF1 += score;

    console.log(`  Expected: ${qa.answer}`);
    console.log(`  Got: ${answer.slice(0, 60)}...`);
    console.log(`  F1: ${score.toFixed(3)}\n`);
  }

  console.log('='.repeat(40));
  console.log(`SCORE: ${(totalF1 / testQs.length * 100).toFixed(1)}%`);
  console.log('='.repeat(40));
}

run().catch(console.error);
