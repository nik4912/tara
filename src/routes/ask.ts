import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { tara } from '../agent/tara';
import { createRequestLogger } from '../services/logger';

const router = Router();

interface AskBody {
  question?: string;
}

/**
 * POST /ask
 *
 * Input:  { "question": "How much did I spend on food last month?" }
 * Output: { "answer": "..." }
 *
 * Returns HTTP 400 for missing/invalid input, 500 for agent errors.
 */
router.post('/ask', async (req: Request, res: Response): Promise<void> => {
  const requestId = uuidv4();
  const body = req.body as AskBody;

  if (!body.question || typeof body.question !== 'string') {
    res.status(400).json({
      error: 'Missing required field: question (string)',
      requestId,
    });
    return;
  }

  const question = body.question.trim();
  if (question.length === 0) {
    res.status(400).json({ error: 'question must not be empty', requestId });
    return;
  }

  const logger = createRequestLogger(requestId, question);

  try {
    // Run the Mastra agent — it will invoke tools as needed
    const result = await tara.generate([
      { role: 'user', content: question },
    ]);

    // Collect tool call metadata from the response steps for observability
    if (result.steps) {
      for (const step of result.steps) {
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            logger.recordToolCall(tc.toolName, tc.args as Record<string, unknown>);
          }
        }
      }
    }

    logger.finalize('success');

    res.json({
      answer: result.text,
      requestId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.finalize('error', message);

    res.status(500).json({
      error: 'Agent failed to generate a response.',
      detail: message,
      requestId,
    });
  }
});

export default router;
