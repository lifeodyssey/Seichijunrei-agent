# Native model admission (#1546)

These ordinary business functions use the published Pi 0.85.1 `AgentLane` and
Prisma 8 client directly. The existing `sessions.user_id` owns conversation
identity; Pi session metadata is not an authorization record. Only new request
intents may create that owner row. Recovery and reservation lock an existing row;
a deleted conversation remains deleted while its obligation stays pending. Anonymous quota
continues to use the Atlas-owned daily counter and its original UTC charge day.

Call `admitModelRequest` inside `SessionAgent.withSession`, after the native
recovery schedule has been durably registered. It commits the stable request-key
intent before reservation, then passes that operation ID to `lane.accept`.
Acceptance and the independent settlement obligation commit before it returns.
An exception leaves the durable intent discoverable. No function drives the lane.

Under the same host exclusion, a successful reattachment must precede
`reconcileModelAdmission`. It reads current execution and then the native result;
failed reads propagate without changing business obligations. Running or terminal
work repairs accepted/open/settlement records. Only a still-pending admission with
both successful absence witnesses can become void and refund its reservation.
An accepted record with missing native history remains pending.

`persistPermanentRejection` commits an application-owned cause before a documented
SDK hook throws. Recovery returns `abort` only from that durable cause. The host
must request native cancellation before its next drive, then settle the actual
terminal result. No exception text determines that decision.

Before the first or recovered drive, #1550's `prepareOperationSettlement` must
initialize the usage cursor from the native `operationMeta` sequence. The default
`lastUsageSeq = -1` is an uninitialized obligation, not permission to charge all
historical usage. #1550 owns terminal billing and applicable refunds. Admission
only refunds confirmed, never-accepted orphans.

This slice is unmounted. #1545 supplies exclusion, successful reattachment and
native scheduling; #1544 supplies durable business-obligation discovery; #1550
supplies the actual settlement writer. Real HTTP acknowledgement/replay, scheduling,
reopen failure, terminal billing and next-request acceptance across those combined
entry points remain integration acceptance work. Existing engine removal belongs
to coordinated cutover; these functions never call it.
