export interface OneShotTurnInput {
  hasEdits: boolean;
  retries: number;
}

export interface OneShotSummary {
  editTurnCount: number;
  oneShotTurnCount: number;
  retryTurnCount: number;
  oneShotRate: number;
  retryRate: number;
}

export function summarizeOneShot(turns: OneShotTurnInput[]): OneShotSummary {
  const editTurns = turns.filter((turn) => turn.hasEdits);
  const oneShotTurns = editTurns.filter((turn) => turn.retries === 0);
  const retryTurns = editTurns.filter((turn) => turn.retries > 0);
  const totalRetries = editTurns.reduce((sum, turn) => sum + Math.max(0, turn.retries), 0);

  return {
    editTurnCount: editTurns.length,
    oneShotTurnCount: oneShotTurns.length,
    retryTurnCount: retryTurns.length,
    oneShotRate: roundRatio(oneShotTurns.length, editTurns.length),
    retryRate: roundRatio(totalRetries, editTurns.length),
  };
}

function roundRatio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }

  return Math.round((numerator / denominator) * 1000) / 1000;
}
