/**
 * Sends a question to the Tara backend via the Vite proxy → /ask.
 * Returns the answer string.
 */
export async function askTara(question: string): Promise<string> {
  const response = await fetch('/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail ?? data.error ?? 'Unknown error from Tara');
  }

  return data.answer as string;
}
