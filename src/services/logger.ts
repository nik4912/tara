import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'requests.jsonl');

export interface RequestLog {
  requestId: string;
  timestamp: string;
  question: string;
  taskType: string;           // detected intent category
  toolsCalled: string[];
  toolInputs: Record<string, unknown>[];
  tablesRead: string[];       // which DB tables were queried
  latencyMs: number;
  status: 'success' | 'error';
  error?: string;
}

/** Map a tool name to the DB tables it reads */
const TOOL_TABLES: Record<string, string[]> = {
  queryTransactions:   ['transactions'],
  fundAnalysis:        ['funds', 'fund_nav_history'],
  portfolioAnalysis:   ['holdings', 'funds', 'fund_nav_history'],
  subscriptionDetection: ['transactions'],
};

/** Infer a high-level task type from the question text */
function detectTaskType(question: string): string {
  const q = question.toLowerCase();
  if (/subscri|recurring|repeat/.test(q))            return 'subscription_detection';
  if (/portfolio|holding|realised|realized/.test(q)) return 'portfolio_analysis';
  if (/fund|nav|return.*fund|fund.*return/.test(q))  return 'fund_analysis';
  if (/transfer/.test(q))                            return 'transfer_query';
  if (/refund|reversal/.test(q))                     return 'refund_query';
  if (/top|biggest|largest|most/.test(q))            return 'top_n_query';
  if (/compar|vs|versus|grew/.test(q))               return 'comparison_query';
  if (/month|week|quarter|year|between|from.*to/.test(q)) return 'time_range_query';
  return 'spending_query';
}

/** Ensure the logs directory exists. */
function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Append a single request log entry to the JSONL log file.
 * Each line is a self-contained JSON object (JSON Lines format).
 */
export function writeRequestLog(entry: RequestLog): void {
  try {
    ensureLogDir();
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (err) {
    // Log writing must never crash the server
    console.error('[logger] Failed to write log entry:', err);
  }
}

/**
 * Create a request logger that accumulates tool calls during the request
 * and finalises the log entry when done.
 */
export function createRequestLogger(requestId: string, question: string) {
  const startMs = Date.now();
  const toolsCalled: string[] = [];
  const toolInputs: Record<string, unknown>[] = [];
  const tablesReadSet = new Set<string>();
  const taskType = detectTaskType(question);

  return {
    recordToolCall(toolName: string, input: Record<string, unknown>): void {
      toolsCalled.push(toolName);
      toolInputs.push({ tool: toolName, ...input });
      // Record which tables this tool reads
      const tables = TOOL_TABLES[toolName] ?? [];
      tables.forEach((t) => tablesReadSet.add(t));
    },

    finalize(status: 'success' | 'error', error?: string): void {
      const entry: RequestLog = {
        requestId,
        timestamp: new Date().toISOString(),
        question,
        taskType,
        toolsCalled,
        toolInputs,
        tablesRead: Array.from(tablesReadSet),
        latencyMs: Date.now() - startMs,
        status,
        error,
      };
      writeRequestLog(entry);
    },
  };
}
