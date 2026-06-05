/**
 * Sends a question to the Tara backend via the Vite proxy → /ask.
 * Returns the answer string.
 */
export async function askTara(question: string): Promise<string> {
  let response: Response;

  try {
    response = await fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
  } catch {
    throw new Error('Cannot reach the backend. Make sure the server is running on port 3000.');
  }

  // Guard against empty / non-JSON responses (e.g. proxy error)
  const text = await response.text();
  if (!text) {
    throw new Error('Backend returned an empty response. Is the server running on port 3000?');
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Backend returned non-JSON response: ${text.slice(0, 120)}`);
  }

  if (!response.ok) {
    throw new Error((data.detail ?? data.error ?? 'Unknown error from Tara') as string);
  }

  return data.answer as string;
}
