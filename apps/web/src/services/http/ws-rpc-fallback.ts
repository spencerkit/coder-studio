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

export const sendWsMutationWithNullableHttpFallback = async <T>(
  send: () => boolean,
  fallback: () => Promise<T>,
): Promise<T | null> => {
  if (trySendWsMutation(send)) {
    return null;
  }
  return fallback();
};
