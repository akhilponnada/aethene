/**
 * LoCoMo Benchmark for Aethene
 *
 * Tests Aethene's memory system against the LoCoMo (Long-term Conversational Memory) benchmark.
 * This benchmark measures the ability to answer questions from very long-term conversations.
 */

import * as fs from 'fs';
import * as path from 'path';

const AETHENE_BASE_URL = process.env.AETHENE_URL || 'http://localhost:3006';
const AETHENE_API_KEY = process.env.AETHENE_API_KEY || 'ae_dev_test123';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

interface Dialog {
  speaker: string;
  dia_id: string;
  text?: string;
  clean_text?: string;
  compressed_text?: string;
  blip_caption?: string;
}

interface QA {
  question: string;
  answer: string | number;
  evidence: string[];
  category: number;
  aethene_prediction?: string;
  aethene_f1?: number;
}

interface LoCoMoSample {
  sample_id: string;
  conversation: {
    speaker_a: string;
    speaker_b: string;
    [key: string]: any;
  };
  qa: QA[];
}

// Category mapping
const CATEGORIES: { [key: number]: string } = {
  1: 'single-hop',
  2: 'temporal',
  3: 'commonsense',
  4: 'open-domain',
  5: 'adversarial'
};

// F1 Score calculation
function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\b(a|an|the|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function f1Score(prediction: string, groundTruth: string): number {
  const predTokens = normalizeAnswer(prediction).split(' ').filter(t => t);
  const truthTokens = normalizeAnswer(groundTruth).split(' ').filter(t => t);

  if (predTokens.length === 0 || truthTokens.length === 0) return 0;

  const common = predTokens.filter(t => truthTokens.includes(t));
  const numSame = common.length;

  if (numSame === 0) return 0;

  const precision = numSame / predTokens.length;
  const recall = numSame / truthTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

// Aethene API helpers
async function aetheneRequest(endpoint: string, method: string, body?: any): Promise<any> {
  const url = `${AETHENE_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AETHENE_API_KEY
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Aethene API error: ${response.status} - ${text}`);
  }

  return response.json();
}

async function ingestConversation(sample: LoCoMoSample, containerTag: string): Promise<void> {
  console.log(`  Ingesting conversation ${sample.sample_id}...`);

  const conv = sample.conversation;
  let totalDialogs = 0;

  // Process each session
  for (let sessionNum = 1; sessionNum <= 50; sessionNum++) {
    const sessionKey = `session_${sessionNum}`;
    const dateTimeKey = `session_${sessionNum}_date_time`;

    if (!conv[sessionKey]) continue;

    const dialogs: Dialog[] = conv[sessionKey];
    const dateTime = conv[dateTimeKey] || '';

    // Build conversation text for this session
    const sessionText = dialogs.map(d => {
      const text = d.compressed_text || d.clean_text || d.text || '';
      let line = `[${dateTime}] ${d.speaker}: ${text}`;
      if (d.blip_caption) {
        line += ` [shared image: ${d.blip_caption}]`;
      }
      return line;
    }).join('\n');

    // Ingest as a document with memory extraction
    try {
      await aetheneRequest('/v1/memories', 'POST', {
        content: sessionText,
        containerTag,
        metadata: {
          session: sessionNum,
          date: dateTime,
          speakers: [conv.speaker_a, conv.speaker_b]
        }
      });
      totalDialogs += dialogs.length;
    } catch (error) {
      console.error(`    Error ingesting session ${sessionNum}:`, error);
    }
  }

  console.log(`    Ingested ${totalDialogs} dialogs`);
}

async function queryAethene(question: string, containerTag: string): Promise<string> {
  // Use profile endpoint to get context
  const profile = await aetheneRequest('/v1/profile', 'GET', undefined);

  // Search for relevant memories
  const searchResult = await aetheneRequest('/v1/search', 'POST', {
    q: question,
    containerTag,
    searchMode: 'hybrid',
    limit: 10
  });

  // Build context from search results
  let context = '';
  if (searchResult.results && searchResult.results.length > 0) {
    context = searchResult.results
      .map((r: any) => r.memory || r.chunk || r.content)
      .filter(Boolean)
      .join('\n\n');
  }

  return context;
}

async function generateAnswer(question: string, context: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const prompt = `Based on the following context from conversations, answer the question concisely.
If the information is not available in the context, say "No information available".

Context:
${context}

Question: ${question}

Answer (be brief and specific):`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 100
        }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No answer generated';
}

async function evaluateSample(sample: LoCoMoSample): Promise<{ results: QA[], avgF1: number }> {
  const containerTag = `locomo_${sample.sample_id}`;

  console.log(`\nEvaluating sample: ${sample.sample_id}`);
  console.log(`  Questions: ${sample.qa.length}`);

  // Step 1: Ingest conversation
  await ingestConversation(sample, containerTag);

  // Wait for memory extraction to complete
  console.log('  Waiting for memory extraction...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Step 2: Answer each question
  const results: QA[] = [];
  let totalF1 = 0;

  for (let i = 0; i < sample.qa.length; i++) {
    const qa = sample.qa[i];
    const category = CATEGORIES[qa.category] || 'unknown';

    console.log(`  Q${i + 1}/${sample.qa.length} [${category}]: ${qa.question.substring(0, 50)}...`);

    try {
      // Get context from Aethene
      const context = await queryAethene(qa.question, containerTag);

      // Generate answer using Gemini
      const prediction = await generateAnswer(qa.question, context);

      // Calculate F1 score
      const groundTruth = String(qa.answer);
      const f1 = f1Score(prediction, groundTruth);

      console.log(`    Predicted: ${prediction.substring(0, 50)}...`);
      console.log(`    Expected: ${groundTruth.substring(0, 50)}...`);
      console.log(`    F1: ${f1.toFixed(3)}`);

      results.push({
        ...qa,
        aethene_prediction: prediction,
        aethene_f1: f1
      });

      totalF1 += f1;
    } catch (error) {
      console.error(`    Error: ${error}`);
      results.push({
        ...qa,
        aethene_prediction: 'ERROR',
        aethene_f1: 0
      });
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const avgF1 = totalF1 / sample.qa.length;
  console.log(`  Average F1: ${avgF1.toFixed(3)}`);

  return { results, avgF1 };
}

async function runBenchmark(): Promise<void> {
  console.log('='.repeat(60));
  console.log('LoCoMo Benchmark for Aethene');
  console.log('='.repeat(60));

  // Load LoCoMo dataset
  const dataPath = path.join(__dirname, '../locomo-benchmark/data/locomo10.json');

  if (!fs.existsSync(dataPath)) {
    console.error(`Dataset not found: ${dataPath}`);
    console.error('Please ensure the LoCoMo benchmark data is available.');
    process.exit(1);
  }

  const samples: LoCoMoSample[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  console.log(`Loaded ${samples.length} samples`);

  // Check Aethene is running
  try {
    const health = await fetch(`${AETHENE_BASE_URL}/health`);
    if (!health.ok) throw new Error('Health check failed');
    console.log('Aethene server: OK');
  } catch (error) {
    console.error(`Cannot connect to Aethene at ${AETHENE_BASE_URL}`);
    console.error('Please start Aethene server first: npm run dev');
    process.exit(1);
  }

  // Run evaluation
  const allResults: { sample_id: string; avgF1: number; results: QA[] }[] = [];
  let overallF1 = 0;
  let totalQuestions = 0;

  // Category-wise stats
  const categoryStats: { [cat: number]: { total: number; f1Sum: number } } = {};

  for (const sample of samples) {
    const { results, avgF1 } = await evaluateSample(sample);

    allResults.push({
      sample_id: sample.sample_id,
      avgF1,
      results
    });

    // Aggregate stats
    for (const qa of results) {
      totalQuestions++;
      overallF1 += qa.aethene_f1 || 0;

      if (!categoryStats[qa.category]) {
        categoryStats[qa.category] = { total: 0, f1Sum: 0 };
      }
      categoryStats[qa.category].total++;
      categoryStats[qa.category].f1Sum += qa.aethene_f1 || 0;
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(60));

  console.log(`\nOverall F1 Score: ${(overallF1 / totalQuestions).toFixed(3)}`);
  console.log(`Total Questions: ${totalQuestions}`);

  console.log('\nF1 by Category:');
  for (const [cat, stats] of Object.entries(categoryStats)) {
    const catName = CATEGORIES[parseInt(cat)] || 'unknown';
    const avgF1 = stats.f1Sum / stats.total;
    console.log(`  ${catName}: ${avgF1.toFixed(3)} (n=${stats.total})`);
  }

  // Save results
  const outputPath = path.join(__dirname, '../locomo-benchmark/aethene_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

// Run the benchmark
runBenchmark().catch(console.error);
