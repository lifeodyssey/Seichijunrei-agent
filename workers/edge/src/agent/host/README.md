# Native session host

`SessionAgent` extends `agents@0.22.0` and owns one Pi `0.85.1` Session/Harness per
incarnation. The deployed `AgentSession` export and `/v1/chat` production tier now use this
class directly. The old turn engine is not a fallback.

Default startup registers the native recurring recovery schedule before opening the native
Prisma client, `NeonSessionRepo`, published Xiaomi model and seven production tools. Explicit
Session exclusion covers admission, reconciliation, drive and settlement across database awaits.
The model's published pricing is retained; the harness owns retry scheduling and provider-level
retries are disabled. Client cancellation never becomes the operation Context's cancellation.

Request identity comes from the existing gateway. Admission persists its request-key mapping
before anonymous reservation or native accept. Every drive and tool execution rechecks existing
conversation ownership and the operation's reservation against the existing daily usage budget.
Tools reuse that reservation without another increment; native usage is settled independently.

BYOK Models and credentials exist only in the DO heap, keyed by operation ID. The request digest
contains model identity, locale and shared GPS, never the key. The validated locale and optional coordinates are also committed before accept
as a public native Session application scalar keyed by operation ID. Every drive re-reads it
and derives a native Context carrying that input and the operation’s translation Models.
Supplementary translation uses the same BYOK payer/key; it cannot consult the platform model.
Terminal settlement logs out and removes the credential.
A cold host with an accepted BYOK operation persists `byok_credentials_lost`, requests native
cancellation before drive, and settles the actual aborted result. It never uses the server key.
Missing queries or deleted conversations retain pending work instead of inventing a refund.

Native schedules use stable payloads so the pre-drive wake deduplicates with its executing
callback. Retry wakes carry the native deadline, rounded up to whole seconds. Reattachment
reads current native witnesses; an immutable result is settled even without the auxiliary index.

Accepted and replayed `/v1/chat` submissions return the AI SDK UI message stream from the
actual native lane watch. A running operation can be watched after the request key, digest and
current conversation owner pass read-only checks, without waiting for the exclusive driver.
This read path never accepts another operation, reserves quota or replaces Models. Mutating
admission, selection, recovery, drive and settlement remain under the same exclusion.

Native selection persists its typed input before deterministic execution and appends one custom
entry. Its result can be used by later route planning on the same native branch. The live stream
marks selection steps as server actions and preserves typed domain outcomes, including partial
results. Model tool execution witnesses are written by the native `after_tool` hook in the same
tool-result commit; original model arguments remain unchanged.

Transcript GET reads owned native storage directly, without a DO wake or harness attachment.
It projects the current branch, operation status, visible message pages and actual executed
arguments. The live projection uses native message lifecycles and committed entry IDs, restores
settled tools, and releases only the watch on disconnect. The retired HTTP prefix-seeding mount
is removed; the canonical evaluation path uses native SessionRepo fork under its evaluation card.

Local workerd/PostgreSQL tests establish default bootstrap, admission, scheduling, cold recovery,
BYOK refusal, settlement, SSE, history and selection. They do not establish browser journey
acceptance, deployed APAC latency, 130-second platform keepalive or production deployment.
