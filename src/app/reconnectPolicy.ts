export function nextAutoReconnectAttempt(completedAttempts: number, maximumAttempts: number) {
  const nextAttempt = Math.max(0, Math.trunc(completedAttempts)) + 1;
  const maximum = Math.max(0, Math.trunc(maximumAttempts));
  return maximum === 0 || nextAttempt <= maximum ? nextAttempt : null;
}

export function autoReconnectProgress(attempt: number, maximumAttempts: number) {
  return maximumAttempts === 0 ? `第 ${attempt} 次` : `${attempt}/${maximumAttempts}`;
}
