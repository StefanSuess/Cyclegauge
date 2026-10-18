/** Pure decision used after a live model: keep edits until the submitted epoch arrives. */
export function reconcileAdvisorDraft(input:{hasDraft:boolean;ticket:number|null;awaitingEpoch:number|null;editVersion:number;savedVersion:number;modelEpoch:number;hostEpoch:number|null}) {
 const arrived=input.awaitingEpoch!==null&&input.modelEpoch>=input.awaitingEpoch;
 const superseded=input.awaitingEpoch!==null&&input.modelEpoch>input.awaitingEpoch;
 const keepDraft=input.hasDraft&&(superseded||!arrived||input.editVersion!==input.savedVersion);
 const epoch=Math.max(input.hostEpoch??0,input.modelEpoch);
 return {keepDraft,awaitingEpoch:arrived?null:input.awaitingEpoch,stale:keepDraft&&(superseded||(arrived||input.awaitingEpoch===null)&&input.ticket!==epoch),epoch};
}
