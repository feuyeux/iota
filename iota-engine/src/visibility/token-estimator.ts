import type { BackendName } from "../event/types.js";

const CHARS_PER_TOKEN = 4;

/**
 * Lightweight token estimator for Visibility Plane.
 * MVP uses ceil(charCount / 4); can be replaced with per-model tokenizers later.
 */
export interface TokenEstimator {
  estimate(text: string, backend: BackendName, model?: string): number;
}

class DefaultTokenEstimator implements TokenEstimator {
  estimate(text: string, _backend: BackendName, _model?: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}

let _instance: TokenEstimator | undefined;

export function getTokenEstimator(): TokenEstimator {
  if (!_instance) {
    _instance = new DefaultTokenEstimator();
  }
  return _instance;
}

export function setTokenEstimator(estimator: TokenEstimator): void {
  _instance = estimator;
}

export function estimateTokens(
  text: string,
  backend: BackendName = "claude-code",
  model?: string,
): number {
  return getTokenEstimator().estimate(text, backend, model);
}
