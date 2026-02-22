/**
 * Aethene Load Testing Script
 *
 * Tests API performance under load. Run with:
 *   npx tsx tests/load/load-test.ts
 *
 * Configuration via environment variables:
 *   AETHENE_URL - API base URL (default: http://localhost:3006)
 *   AETHENE_API_KEY - API key for authentication
 *   LOAD_CONCURRENCY - Number of concurrent requests (default: 10)
 *   LOAD_DURATION - Test duration in seconds (default: 30)
 *   LOAD_RAMP_UP - Ramp up time in seconds (default: 5)
 */

const BASE_URL = process.env.AETHENE_URL || 'http://localhost:3006';
const API_KEY = process.env.AETHENE_API_KEY || 'test-key-12345';
const CONCURRENCY = parseInt(process.env.LOAD_CONCURRENCY || '10');
const DURATION_SECONDS = parseInt(process.env.LOAD_DURATION || '30');
const RAMP_UP_SECONDS = parseInt(process.env.LOAD_RAMP_UP || '5');

interface RequestResult {
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

interface LoadTestResults {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  requestsPerSecond: number;
  errorRate: string;
  durationSeconds: number;
  byEndpoint: Record<string, {
    requests: number;
    avgLatencyMs: number;
    errorRate: string;
  }>;
}

// Test scenarios
const scenarios = [
  {
    name: 'Health Check',
    method: 'GET',
    path: '/health',
    weight: 5,
    auth: false,
  },
  {
    name: 'List Memories',
    method: 'GET',
    path: '/v1/memories?limit=10',
    weight: 20,
  },
  {
    name: 'Search',
    method: 'POST',
    path: '/v1/search',
    body: { query: 'user preferences', limit: 5 },
    weight: 30,
  },
  {
    name: 'Recall',
    method: 'POST',
    path: '/v1/recall',
    body: { query: 'project status', limit: 5, includeProfile: true },
    weight: 25,
  },
  {
    name: 'Get Profile',
    method: 'GET',
    path: '/v1/profile',
    weight: 10,
  },
  {
    name: 'Get Stats',
    method: 'GET',
    path: '/v1/memories/stats',
    weight: 10,
  },
];

// Calculate weighted scenario selection
const weightedScenarios: typeof scenarios = [];
for (const scenario of scenarios) {
  for (let i = 0; i < scenario.weight; i++) {
    weightedScenarios.push(scenario);
  }
}

function getRandomScenario() {
  return weightedScenarios[Math.floor(Math.random() * weightedScenarios.length)];
}

async function makeRequest(scenario: typeof scenarios[0]): Promise<RequestResult> {
  const start = Date.now();

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (scenario.auth !== false) {
      headers['Authorization'] = `Bearer ${API_KEY}`;
    }

    const response = await fetch(`${BASE_URL}${scenario.path}`, {
      method: scenario.method,
      headers,
      body: scenario.body ? JSON.stringify(scenario.body) : undefined,
    });

    const latencyMs = Date.now() - start;

    return {
      endpoint: scenario.path.split('?')[0],
      method: scenario.method,
      statusCode: response.status,
      latencyMs,
      success: response.status >= 200 && response.status < 400,
    };
  } catch (error: any) {
    return {
      endpoint: scenario.path.split('?')[0],
      method: scenario.method,
      statusCode: 0,
      latencyMs: Date.now() - start,
      success: false,
      error: error.message,
    };
  }
}

async function runWorker(
  workerId: number,
  results: RequestResult[],
  stopSignal: { stop: boolean }
): Promise<void> {
  while (!stopSignal.stop) {
    const scenario = getRandomScenario();
    const result = await makeRequest(scenario);
    results.push(result);

    // Small delay to prevent overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function calculatePercentile(sortedLatencies: number[], percentile: number): number {
  const index = Math.ceil((percentile / 100) * sortedLatencies.length) - 1;
  return sortedLatencies[Math.max(0, index)];
}

function analyzeResults(results: RequestResult[], durationSeconds: number): LoadTestResults {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);

  // Group by endpoint
  const byEndpoint: Record<string, RequestResult[]> = {};
  for (const result of results) {
    const key = `${result.method} ${result.endpoint}`;
    if (!byEndpoint[key]) byEndpoint[key] = [];
    byEndpoint[key].push(result);
  }

  const endpointStats: LoadTestResults['byEndpoint'] = {};
  for (const [endpoint, endpointResults] of Object.entries(byEndpoint)) {
    const endpointSuccess = endpointResults.filter(r => r.success);
    const endpointFailed = endpointResults.filter(r => !r.success);
    const avgLatency = endpointResults.reduce((sum, r) => sum + r.latencyMs, 0) / endpointResults.length;

    endpointStats[endpoint] = {
      requests: endpointResults.length,
      avgLatencyMs: Math.round(avgLatency),
      errorRate: ((endpointFailed.length / endpointResults.length) * 100).toFixed(2) + '%',
    };
  }

  return {
    totalRequests: results.length,
    successfulRequests: successful.length,
    failedRequests: failed.length,
    avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    p50LatencyMs: calculatePercentile(latencies, 50),
    p95LatencyMs: calculatePercentile(latencies, 95),
    p99LatencyMs: calculatePercentile(latencies, 99),
    maxLatencyMs: Math.max(...latencies),
    minLatencyMs: Math.min(...latencies),
    requestsPerSecond: Math.round(results.length / durationSeconds),
    errorRate: ((failed.length / results.length) * 100).toFixed(2) + '%',
    durationSeconds,
    byEndpoint: endpointStats,
  };
}

async function runLoadTest(): Promise<void> {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           AETHENE LOAD TEST                               ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Target:       ${BASE_URL.padEnd(42)}║`);
  console.log(`║  Concurrency:  ${String(CONCURRENCY).padEnd(42)}║`);
  console.log(`║  Duration:     ${String(DURATION_SECONDS).padEnd(39)}sec ║`);
  console.log(`║  Ramp-up:      ${String(RAMP_UP_SECONDS).padEnd(39)}sec ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Verify connectivity
  console.log('🔍 Checking connectivity...');
  try {
    const healthCheck = await fetch(`${BASE_URL}/health`);
    if (!healthCheck.ok) {
      console.error('❌ Health check failed. Is the server running?');
      process.exit(1);
    }
    console.log('✅ Server is reachable');
  } catch (error) {
    console.error('❌ Cannot connect to server:', error);
    process.exit(1);
  }

  const results: RequestResult[] = [];
  const stopSignal = { stop: false };
  const workers: Promise<void>[] = [];

  console.log('');
  console.log('🚀 Starting load test...');
  console.log('');

  const startTime = Date.now();

  // Ramp up workers
  for (let i = 0; i < CONCURRENCY; i++) {
    // Stagger worker starts
    await new Promise(resolve => setTimeout(resolve, (RAMP_UP_SECONDS * 1000) / CONCURRENCY));
    workers.push(runWorker(i, results, stopSignal));
    process.stdout.write(`\r   Workers active: ${i + 1}/${CONCURRENCY}`);
  }

  console.log('\n');

  // Show progress
  const progressInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rps = Math.round(results.length / elapsed);
    const errors = results.filter(r => !r.success).length;
    process.stdout.write(`\r   Progress: ${elapsed}s/${DURATION_SECONDS}s | Requests: ${results.length} | RPS: ${rps} | Errors: ${errors}`);
  }, 1000);

  // Wait for duration
  await new Promise(resolve => setTimeout(resolve, DURATION_SECONDS * 1000));

  // Stop workers
  stopSignal.stop = true;
  clearInterval(progressInterval);

  // Wait for all workers to finish
  await Promise.allSettled(workers);

  console.log('\n');
  console.log('✅ Load test complete!');
  console.log('');

  // Analyze and display results
  const analysis = analyzeResults(results, DURATION_SECONDS);

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                      RESULTS                              ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Total Requests:     ${String(analysis.totalRequests).padEnd(36)}║`);
  console.log(`║  Successful:         ${String(analysis.successfulRequests).padEnd(36)}║`);
  console.log(`║  Failed:             ${String(analysis.failedRequests).padEnd(36)}║`);
  console.log(`║  Error Rate:         ${analysis.errorRate.padEnd(36)}║`);
  console.log(`║  Requests/sec:       ${String(analysis.requestsPerSecond).padEnd(36)}║`);
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log('║                   LATENCY (ms)                            ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Min:                ${String(analysis.minLatencyMs).padEnd(36)}║`);
  console.log(`║  Avg:                ${String(analysis.avgLatencyMs).padEnd(36)}║`);
  console.log(`║  P50 (median):       ${String(analysis.p50LatencyMs).padEnd(36)}║`);
  console.log(`║  P95:                ${String(analysis.p95LatencyMs).padEnd(36)}║`);
  console.log(`║  P99:                ${String(analysis.p99LatencyMs).padEnd(36)}║`);
  console.log(`║  Max:                ${String(analysis.maxLatencyMs).padEnd(36)}║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('BY ENDPOINT:');
  console.log('─'.repeat(60));

  for (const [endpoint, stats] of Object.entries(analysis.byEndpoint)) {
    console.log(`  ${endpoint}`);
    console.log(`    Requests: ${stats.requests} | Avg Latency: ${stats.avgLatencyMs}ms | Errors: ${stats.errorRate}`);
  }

  console.log('');

  // Performance assessment
  console.log('ASSESSMENT:');
  console.log('─'.repeat(60));

  const issues: string[] = [];
  const successes: string[] = [];

  if (analysis.p95LatencyMs < 500) {
    successes.push(`✅ P95 latency under 500ms (${analysis.p95LatencyMs}ms)`);
  } else {
    issues.push(`⚠️  P95 latency over 500ms (${analysis.p95LatencyMs}ms)`);
  }

  if (analysis.errorRate === '0.00%') {
    successes.push(`✅ Zero errors during load test`);
  } else if (parseFloat(analysis.errorRate) < 1) {
    successes.push(`✅ Error rate under 1% (${analysis.errorRate})`);
  } else {
    issues.push(`⚠️  Error rate over 1% (${analysis.errorRate})`);
  }

  if (analysis.requestsPerSecond >= 50) {
    successes.push(`✅ Throughput over 50 RPS (${analysis.requestsPerSecond} RPS)`);
  } else if (analysis.requestsPerSecond >= 20) {
    successes.push(`✅ Throughput over 20 RPS (${analysis.requestsPerSecond} RPS)`);
  } else {
    issues.push(`⚠️  Low throughput (${analysis.requestsPerSecond} RPS)`);
  }

  for (const s of successes) console.log(`  ${s}`);
  for (const i of issues) console.log(`  ${i}`);

  console.log('');

  // Exit with error if too many failures
  if (parseFloat(analysis.errorRate) > 5) {
    console.error('❌ Load test FAILED: Error rate too high');
    process.exit(1);
  }
}

// Run the test
runLoadTest().catch(console.error);
