import { POOL_NAMES, POOL_COLORS, DEFAULT_TEAMS } from "./config.js";
import { makePoolMatches, computeStandings } from "./helpers.js";
import { state, isAdmin, syncToFirebase, syncTeamsData, addAuditEntry, startFirebaseListener } from "./state.js";
import { render } from "./render.js";

/* ==========================================================================
   ACTIONS
========================================================================== */
function startTournament() {
  const teams = state.teamNames.map(p=>p.map(t=>t.trim()||"TBD"));
  const matches = teams.map((p,pi)=>makePoolMatches(pi,p));
  const koMatches = {
    qf: Array(4).fill(null).map((_,i)=>({id:`qf${i}`,t1:null,t2:null,s1:null,s2:null,status:"pending"})),
    sf: Array(2).fill(null).map((_,i)=>({id:`sf${i}`,t1:null,t2:null,s1:null,s2:null,status:"pending"})),
    third: [{id:"third",t1:null,t2:null,s1:null,s2:null,status:"pending"}],
    final: [{id:"final",t1:null,t2:null,s1:null,s2:null,status:"pending"}],
  };
  state.pools = { teams, matches, koMatches };
  state.phase = "pool"; state.tab = "pools";
  syncToFirebase({ pools: state.pools, phase: state.phase });
  startFirebaseListener();
  render();
}

function savePoolScore(poolIdx, matchId, s1, s2) {
  const match = state.pools.matches[poolIdx].find(m=>m.id===matchId);
  const t1 = state.pools.teams[poolIdx][match.t1];
  const t2 = state.pools.teams[poolIdx][match.t2];
  state.pools.matches[poolIdx] = state.pools.matches[poolIdx].map(m=>
    m.id!==matchId ? m : {...m, s1, s2, status:"done"}
  );
  state.editingMatch = null;
  addAuditEntry({ type:"pool", action:"score", pool: POOL_NAMES[poolIdx],
    matchId, t1, t2, s1, s2, label:`Pool ${POOL_NAMES[poolIdx]}: ${t1} ${s1}-${s2} ${t2}` });
  syncToFirebase({ pools: state.pools, phase: state.phase });
  render();
}

function toggleLive(poolIdx, matchId) {
  state.pools.matches[poolIdx] = state.pools.matches[poolIdx].map(m=>
    m.id!==matchId ? m : {...m, status: m.status==="live" ? "pending" : "live"}
  );
  syncToFirebase({ pools: state.pools, phase: state.phase });
  render();
}

function resetPoolMatch(poolIdx, matchId) {
  const match = state.pools.matches[poolIdx].find(m=>m.id===matchId);
  const t1 = state.pools.teams[poolIdx][match.t1];
  const t2 = state.pools.teams[poolIdx][match.t2];
  state.pools.matches[poolIdx] = state.pools.matches[poolIdx].map(m=>
    m.id!==matchId ? m : {...m, s1:null, s2:null, status:"pending"}
  );
  state.editingMatch = null;
  addAuditEntry({ type:"pool", action:"reset", pool: POOL_NAMES[poolIdx],
    matchId, t1, t2, label:`Reset Pool ${POOL_NAMES[poolIdx]}: ${t1} vs ${t2}` });
  syncToFirebase({ pools: state.pools, phase: state.phase });
  render();
}

function advanceToKnockout() {
  const QF_SEEDS = [
    {p1:0,r1:0,p2:3,r2:1},{p1:1,r1:0,p2:2,r2:1},
    {p1:2,r1:0,p2:1,r2:1},{p1:3,r1:0,p2:0,r2:1},
  ];
  const qual = POOL_NAMES.map((_,pi)=>computeStandings(state.pools.teams[pi], state.pools.matches[pi]).slice(0,2));
  state.pools.koMatches.qf = QF_SEEDS.map((s,i)=>({
    id:`qf${i}`, t1:qual[s.p1]?.[s.r1]?.name||"TBD", t2:qual[s.p2]?.[s.r2]?.name||"TBD",
    s1:null, s2:null, status:"pending",
  }));
  state.phase = "knockout"; state.tab = "knockout";
  syncToFirebase({ pools: state.pools, phase: state.phase });
  render();
}

function saveKOScore(stage, id, s1, s2) {
  if (!state.pools.koMatches[stage]) state.pools.koMatches[stage] = [];
  // Seed the 3rd-place match from the semi-final losers if the saved bracket
  // predates the feature (so it can be scored on already-finished tournaments).
  if (stage==="third" && !state.pools.koMatches.third.some(m=>m.id===id)) {
    const sfDone = (state.pools.koMatches.sf||[]).filter(m=>m.status==="done");
    const l = sfDone.map(m=>m.s1>m.s2?m.t2:m.t1);
    state.pools.koMatches.third = [{id:"third",t1:l[0],t2:l[1],s1:null,s2:null,status:"pending"}];
  }
  state.pools.koMatches[stage] = state.pools.koMatches[stage].map(m=>
    m.id!==id ? m : {...m, s1, s2, status:"done"}
  );
  if (stage==="qf") {
    const done = state.pools.koMatches.qf.filter(m=>m.status==="done");
    if (done.length===4) {
      const w = done.map(m=>m.s1>m.s2?m.t1:m.t2);
      state.pools.koMatches.sf = [
        {id:"sf0",t1:w[0],t2:w[1],s1:null,s2:null,status:"pending"},
        {id:"sf1",t1:w[2],t2:w[3],s1:null,s2:null,status:"pending"},
      ];
    }
  }
  if (stage==="sf") {
    const done = state.pools.koMatches.sf.filter(m=>m.status==="done");
    if (done.length===2) {
      const w = done.map(m=>m.s1>m.s2?m.t1:m.t2);
      const l = done.map(m=>m.s1>m.s2?m.t2:m.t1);
      state.pools.koMatches.final = [{id:"final",t1:w[0],t2:w[1],s1:null,s2:null,status:"pending"}];
      // 3rd-place playoff between the two semi-final losers
      state.pools.koMatches.third = [{id:"third",t1:l[0],t2:l[1],s1:null,s2:null,status:"pending"}];
    }
  }
  const scored = state.pools.koMatches[stage].find(m=>m.id===id);
  const stageLabel = {qf:"Quarter-Final",sf:"Semi-Final",third:"3rd-Place",final:"Final"}[stage] || stage;
  addAuditEntry({ type:"ko", action:"score", stage,
    matchId: id, t1: scored.t1, t2: scored.t2, s1, s2,
    label:`${stageLabel}: ${scored.t1} ${s1}-${s2} ${scored.t2}` });
  state.koEditing = null;
  syncToFirebase({ pools: state.pools, phase: state.phase });
  render();
}

function resetKOMatch(stage, id) {
  const match = state.pools.koMatches[stage].find(m=>m.id===id);
  const stageLabel = {qf:"Quarter-Final",sf:"Semi-Final",third:"3rd-Place",final:"Final"}[stage] || stage;
  state.pools.koMatches[stage] = state.pools.koMatches[stage].map(m=>
    m.id!==id ? m : {...m, s1:null, s2:null, status:"pending"}
  );
  addAuditEntry({ type:"ko", action:"reset", stage, matchId: id,
    t1: match.t1, t2: match.t2,
    label:`Reset ${stageLabel}: ${match.t1} vs ${match.t2}` });
  state.koEditing = null;
  syncToFirebase({ pools: state.pools, phase: state.phase });
  render();
}

export { startTournament, savePoolScore, toggleLive, resetPoolMatch,
         advanceToKnockout, saveKOScore, resetKOMatch };
