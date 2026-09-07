// CI mirror of scripts/local-gates/commit-message.py (the local commit-msg
// hook). E1 retires the python hook; until then the two must stay in sync —
// every rule here has a counterpart there, and vice versa.
//
// `type-enum` / `scope-enum` / `header-max-length` are the tables from
// commit-message.py:10-41. The plugin rules mirror its subject checks
// (GENERIC_OUTCOMES, the lowercase-verb start, the subject issue-ref ban) and
// its attribution ban (COAUTHOR_PATTERN × AI_IDENTITY_PATTERN, the Claude Code
// footer). Merge/Revert subjects are exempt exactly like GIT_MAINTENANCE_PATTERN.

const TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'test',
  'docs',
  'ci',
  'build',
  'ops',
  'chore',
  'revert',
];

const SCOPES = [
  'agent',
  'web',
  'chat',
  'catalog',
  'users',
  'auth',
  'edge',
  'contract',
  'db',
  'infra',
  'delivery',
  'eval',
  'e2e',
  'repo',
  'deps',
];

const GENERIC_OUTCOMES = new Set([
  'wip',
  'work in progress',
  'checkpoint',
  'fix',
  'fixes',
  'fixed',
  'fix it',
  'update',
  'updates',
  'updated',
  'update code',
  'update files',
  'changes',
  'misc',
  'misc changes',
  'review',
  'polish',
  'format',
  'formatting',
  'lint',
  'ci',
  'tests',
  'comments',
]);

const AI_IDENTITY = /\b(?:claude|anthropic|codex|openai)\b/i;

module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [
    // GIT_MAINTENANCE_PATTERN: the local hook never sees these either —
    // squash merges and branch-sync merges carry no reviewable outcome.
    (commit) => /^(?:Merge .+|Revert ".+")$/.test(commit),
  ],
  rules: {
    'type-enum': [2, 'always', TYPES],
    'scope-enum': [2, 'always', SCOPES],
    'header-max-length': [2, 'always', 72],
    'subject-empty': [2, 'never'],
    'type-empty': [2, 'never'],
    'subject-case': [
      2,
      'never',
      ['sentence-case', 'start-case', 'pascal-case', 'upper-case'],
    ],
    'outcome-not-generic': [2, 'always'],
    'outcome-lowercase-start': [2, 'always'],
    'subject-no-issue-reference': [2, 'always'],
    'ai-attribution-forbidden': [2, 'always'],
  },
  plugins: [
    {
      rules: {
        'outcome-not-generic': ({ subject }) => {
          const outcome = String(subject ?? '')
            .toLowerCase()
            .replace(/^[ \t.!?:;_-]+|[ \t.!?:;_-]+$/g, '');
          return [
            !GENERIC_OUTCOMES.has(outcome),
            `outcome '${subject}' is a generic outcome; describe what changed`,
          ];
        },
        'outcome-lowercase-start': ({ subject }) => [
          /^[a-z]/.test(String(subject ?? '')),
          'outcome must start with a lowercase verb',
        ],
        'subject-no-issue-reference': ({ subject }) => [
          !/#\d+/.test(String(subject ?? '')),
          'subject must not carry an issue reference (Refs: belongs in the body)',
        ],
        'ai-attribution-forbidden': ({ body, footer }) => {
          const text = `${body ?? ''}\n${footer ?? ''}`;
          const coauthored = text
            .split('\n')
            .filter((line) => /^co-authored-by\s*:/i.test(line));
          return [
            !(
              coauthored.some((line) => AI_IDENTITY.test(line)) ||
              /generated with .*\b(?:claude|anthropic|codex|openai)\b/i.test(text)
            ),
            'commits must not carry AI attribution (Co-Authored-By identity or Generated-with footer)',
          ];
        },
      },
    },
  ],
};
