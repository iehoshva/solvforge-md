import { uuid } from "./crypto.ts"
import type { Workspace } from "./workspace"
import { continuationPlan } from "./protocol.ts"
import { SOFTWARE_VERSION } from "./version.ts"

export function recordContinuation(
  w: Workspace,
  input: {
    runId: string
    completedNs: number
    action: "continue" | "stop"
    checkpointSha256: string
    executionEvidence: string
    rationale: string
  },
) {
  const run = w.runs.find((r) => r.runId === input.runId && r.projectId === w.projectId)
  if (!run?.resolvedProtocol || !run.inputSnapshots?.length) {
    throw new Error("Select a run with frozen input files before planning checkpoint continuation.")
  }
  if (!/^[a-f0-9]{64}$/i.test(input.checkpointSha256) || !input.executionEvidence.trim() || !input.rationale.trim()) {
    throw new Error("Checkpoint SHA-256, execution log reference, and rationale are required.")
  }
  const plan = continuationPlan(run.resolvedProtocol, input.completedNs, input.action === "stop" ? "accepted" : "pending")
  return {
    id: uuid(),
    projectId: w.projectId,
    type: "ProductionContinuationDecision",
    sourceIds: [run.runId, run.resolvedProtocol.id, run.inputSnapshots[0].id],
    ...input,
    checkpointSha256: input.checkpointSha256.toLowerCase(),
    status: "RESEARCHER_REPORTED",
    actor: "researcher",
    softwareVersion: SOFTWARE_VERSION,
    timestamp: new Date().toISOString(),
    nextEndNs: plan.nextEndNs,
    stop: plan.stop,
    commands: plan.commands,
    interpretation: plan.stop
      ? "Production stopped by plan limit or researcher decision."
      : "Execute externally from the recorded checkpoint and inspect trajectory convergence in MoDy Analyse.",
  }
}
