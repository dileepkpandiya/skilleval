import assert from 'node:assert/strict';
import { ClaudeJudge, GeminiFlashJudge, OpenAIJudge, createJudgeProvider } from './judges';

async function testGeminiParsing(): Promise<void> {
  let calls = 0;
  const judge = new GeminiFlashJudge({
    model: {
      async generateContent() {
        calls += 1;
        return {
          response: {
            text: () => '{"winner":"A","margin":2.5,"rationale":"A is more actionable."}',
          },
        };
      },
    },
  });

  const result = await judge.score('Task prompt', 'Output A', 'Output B');
  assert.deepEqual(result, {
    winner: 'A',
    margin: 2.5,
    rationale: 'A is more actionable.',
  });
  assert.equal(calls, 1);
}

async function testGeminiMaxTokensFailureMessage(): Promise<void> {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  const longRawResponse = `${'x'.repeat(600)}{"winner":"A","margin":2,"rationale":`;
  console.warn = (message?: unknown) => {
    warnings.push(String(message ?? ''));
  };

  try {
    const judge = new GeminiFlashJudge({
      model: {
        async generateContent() {
          return {
            response: {
              text: () => longRawResponse,
              candidates: [{
                finishReason: 'MAX_TOKENS',
                safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' }],
              }],
            },
          };
        },
      },
    });

    await assert.rejects(
      () => judge.score('Task prompt', 'Output A', 'Output B'),
      /GeminiFlashJudge returned malformed judge JSON after 3 attempts\./,
    );
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /attempt 1/);
    assert.match(warnings[0], /finishReason=MAX_TOKENS/);
    assert.match(warnings[0], /safetyRatings=\[\{"category":"HARM_CATEGORY_DANGEROUS_CONTENT","probability":"NEGLIGIBLE"\}\]/);
    assert.match(warnings[0], /likely truncated by Gemini maxOutputTokens/);
    assert.match(warnings[0], /rawResponse="x{500}\.\.\."/);
    assert.ok(!warnings[0].includes('x'.repeat(550)), 'raw response preview should be truncated');
  } finally {
    console.warn = originalWarn;
  }
}

async function testClaudeRetryParsing(): Promise<void> {
  let calls = 0;
  const judge = new ClaudeJudge({
    client: {
      messages: {
        create: async () => {
          calls += 1;
          return {
            content: [{
              type: 'text',
              text: calls === 1
                ? 'not json'
                : '```json\n{"winner":"B","margin":1,"rationale":"B is clearer."}\n```',
            }],
          };
        },
      },
    } as never,
  });

  const result = await judge.score('Task prompt', 'Output A', 'Output B');
  assert.deepEqual(result, {
    winner: 'B',
    margin: 1,
    rationale: 'B is clearer.',
  });
  assert.equal(calls, 2);
}

async function testOpenAIParsing(): Promise<void> {
  let calls = 0;
  const judge = new OpenAIJudge({
    apiKey: 'test-key',
    fetchFn: async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '{"winner":"tie","margin":0,"rationale":"Both are equivalent."}',
            },
          }],
        }),
      } as Response;
    },
  });

  const result = await judge.score('Task prompt', 'Output A', 'Output B');
  assert.deepEqual(result, {
    winner: 'tie',
    margin: 0,
    rationale: 'Both are equivalent.',
  });
  assert.equal(calls, 1);
}

function testMissingApiKeyBeforeNetwork(): void {
  const previousKey = process.env.OPENAI_API_KEY;
  let networkCalls = 0;
  delete process.env.OPENAI_API_KEY;

  try {
    assert.throws(
      () => new OpenAIJudge({
        fetchFn: async () => {
          networkCalls += 1;
          return {} as Response;
        },
      }),
      /Missing OPENAI_API_KEY/,
    );
    assert.equal(networkCalls, 0);
  } finally {
    if (previousKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousKey;
    }
  }
}

function testFactoryMissingKey(): void {
  const previousKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.throws(() => createJudgeProvider('gemini-flash'), /Missing GEMINI_API_KEY/);
  } finally {
    if (previousKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousKey;
    }
  }
}

async function main(): Promise<void> {
  await testGeminiParsing();
  await testGeminiMaxTokensFailureMessage();
  await testClaudeRetryParsing();
  await testOpenAIParsing();
  testMissingApiKeyBeforeNetwork();
  testFactoryMissingKey();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
