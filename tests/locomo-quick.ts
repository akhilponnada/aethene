/**
 * Quick LoCoMo Benchmark - Tests 1 sample, 10 questions max
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AETHENE_URL = process.env.AETHENE_URL || 'http://localhost:3006';
const API_KEY = process.env.AETHENE_API_KEY || 'ae_dev_test123';
const GEMINI_KEY = process.env.GEMINI_API_KEY || 'process.env.GEMINI_API_KEY';

// F1 Score
function f1(pred: string, truth: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\b(a|an|the)\b/g, '').trim().split(/\s+/).filter(Boolean);
  const p = norm(pred), t = norm(truth);
  if (!p.length || !t.length) return 0;
  const common = p.filter(x => t.includes(x)).length;
  if (!common) return 0;
  return (2 * (common/p.length) * (common/t.length)) / ((common/p.length) + (common/t.length));
}

async function aethene(endpoint: string, method: string, body?: any) {
  const r = await fetch(`${AETHENE_URL}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
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
  console.log('🧪 Quick LoCoMo Benchmark\n');

  // Load 1 sample
  const dataPath = join(__dirname, '../locomo-benchmark/data/locomo10.json');
  const data = JSON.parse(readFileSync(dataPath, 'utf-8'));
  const sample = data[0];
  // Don't use containerTag - the API has a bug where it's not passed through
  const tag = '';

  console.log(`Sample: ${sample.sample_id}`);
  console.log(`Speakers: ${sample.conversation.speaker_a}, ${sample.conversation.speaker_b}\n`);

  // Ingest first 3 sessions only using /v1/memories endpoint
  console.log('📥 Ingesting conversations...');
  let dialogCount = 0;
  for (let i = 1; i <= 3; i++) {
    const sess = sample.conversation[`session_${i}`];
    const dt = sample.conversation[`session_${i}_date_time`] || '';
    if (!sess) continue;

    // Build memories from each dialog turn
    const memories = sess.map((d: any) => ({
      content: `[${dt}] ${d.speaker}: ${d.compressed_text || d.clean_text || d.text}`
    }));

    await aethene('/v1/memories', 'POST', {
      memories
    });
    dialogCount += sess.length;
  }
  console.log(`  ✓ ${dialogCount} dialogs ingested\n`);

  // Wait for processing
  await new Promise(r => setTimeout(r, 2000));

  // Test first 10 questions
  const questions = sample.qa.slice(0, 10);
  console.log(`📝 Testing ${questions.length} questions...\n`);

  const results: { q: string; expected: string; got: string; f1: number }[] = [];
  let totalF1 = 0;

  for (let i = 0; i < questions.length; i++) {
    const qa = questions[i];
    const expected = String(qa.answer);

    // Search Aethene
    let context = '';
    try {
      const search = await aethene('/v1/search', 'POST', {
        query: qa.question,
        searchMode: 'hybrid',
        limit: 5
      });
      context = (search.results || []).map((r: any) => r.memory || r.chunk || r.content || '').join('\n');
      if (!context) console.log(`  ⚠️ No context found`);
    } catch (e) {
      console.log(`  ⚠️ Search failed: ${e}`);
    }

    // Generate answer
    let got = '';
    try {
      got = await gemini(`Context:\n${context}\n\nQuestion: ${qa.question}\n\nAnswer briefly:`);
    } catch (e) {
      got = 'ERROR';
    }

    const score = f1(got, expected);
    totalF1 += score;
    results.push({ q: qa.question, expected, got, f1: score });

    console.log(`Q${i+1}: ${qa.question.slice(0, 50)}...`);
    console.log(`   Expected: ${expected}`);
    console.log(`   Got: ${got.slice(0, 50)}`);
    console.log(`   F1: ${score.toFixed(3)}\n`);

    await new Promise(r => setTimeout(r, 300));
  }

  // Summary
  console.log('='.repeat(50));
  console.log(`AETHENE LoCoMo SCORE: ${(totalF1 / questions.length * 100).toFixed(1)}%`);
  console.log(`Average F1: ${(totalF1 / questions.length).toFixed(3)}`);
  console.log('='.repeat(50));
}

run().catch(console.error);
