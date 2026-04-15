import { RUNTIME_URL, getAuthHeaders } from "./client";

/**
 * Submit user feedback (thumbs up/down) for a response.
 */
export async function submitFeedback(params: {
  session_id?: string | null;
  query_text: string;
  intent: string;
  rating: "good" | "bad";
  comment?: string;
}): Promise<{ feedback_id: string }> {
  const res = await fetch(`${RUNTIME_URL}/v1/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(`Feedback submission failed (${res.status})`);
  }

  return res.json();
}
