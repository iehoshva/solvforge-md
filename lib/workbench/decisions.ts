import type {ResearchDecision} from "./types"
import {canonical} from "./identity.ts"

/** Acceptance belongs to exact evidence, not whichever state is open in a form. */
export function decisionMatches(d:ResearchDecision|undefined,projectId:string|undefined,state:string|null|undefined,sources:string[],classification="accepted"){
 return !!d&&!!projectId&&!!state&&d.projectId===projectId&&d.stateId===state&&d.classification===classification&&!!d.rationale.trim()&&!!d.id&&!!d.timestamp&&canonical([...d.sourceIds].sort())===canonical([...sources].sort())
}
