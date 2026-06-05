import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'requests.jsonl');

export interface RequestLog {
  requestId: string;
  timestamp: string;
  question: string;
  toolsCalled: string[];
  toolInputs: Record<string, unknown>[];
  latencyMs: number;
  status: 'success' | 'error';
  error?: string;
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

  return {
    recordToolCall(toolName: string, input: Record<string, unknown>): void {
      toolsCalled.push(toolName);
      toolInputs.push({ tool: toolName, ...input });
    },

    finalize(status: 'success' | 'error', error?: string): void {
      const entry: RequestLog = {
        requestId,
        timestamp: new Date().toISOString(),
        question,
        toolsCalled,
        toolInputs,
        latencyMs: Date.now() - startMs,
        status,
        error,
      };
      writeRequestLog(entry);
    },
  };
}
