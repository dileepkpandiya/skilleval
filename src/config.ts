export const MODELS = {
  runner: {
    default: 'claude-sonnet-4-6',
    dev: 'claude-haiku-4-5',
  },
  judge: {
    default: 'gemini-3.5-flash',
    fallback: 'claude-haiku-4-5',
  },
} as const;
