const trySendWsMutation = (send: () => boolean) => {
  try {
    return send();
  } catch {
    return false;
  }
};

export const sendWsMutationWithHttpFallback = async (
  send: () => boolean,
  fallback: () => Promise<void>,
) => {
  if (trySendWsMutation(send)) {
    return;
  }
  await fallback();
};

/**
 * Send a WebSocket mutation with HTTP fallback, using server-side ACK
 * to confirm actual delivery.
 *
 * IMPORTANT: ACK timeout does NOT mean the message was not delivered.
 * The server may have processed it successfully while the ACK was lost
 * in transit. Falling back to HTTP in this case creates duplicate
 * mutations (WS already processed; HTTP processes again). The timeout
 * is therefore treated as "sent but unconfirmed" — the caller must
 * accept this uncertainty rather than double-execute via HTTP.
 *
 * HTTP fallback is only triggered when the WebSocket socket was not
 * open at the time of the call (i.e., the message was not sent at all).
 * `null` = socket not open → fallback; `false` = sent but ACK timed out → no fallback.
 */
export const sendWsMutationWithAckFallback = async (
  sendWithAck: () => Promise<boolean | null>,
  fallback: () => Promise<void>,
) => {
  const sent = await sendWithAck();
  // null = socket not open, message was not sent — need HTTP to guarantee delivery
  if (sent !== null) return;
  await fallback();
};

export const sendWsMutationWithNullableHttpFallback = async <T>(
  send: () => boolean,
  fallback: () => Promise<T>,
): Promise<T | null> => {
  if (trySendWsMutation(send)) {
    return null;
  }
  return fallback();
};
