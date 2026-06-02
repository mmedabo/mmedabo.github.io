import { POOL_NAMES } from "./config.js";

/* ══════════════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════════════ */
function makePoolMatches(poolIdx, teams) {
  // Verified optimal 5-team schedule. Min gap = 2 for every team (proven mathematical maximum).
  // Structured as 5 rounds of 2 matches each — one team gets a full round bye per round.
  // Round 1: T0 rests | Round 2: T1 rests | Round 3: T4 rests | Round 4: T3 rests | Round 5: T2 rests
  const ROUNDS = [
    { bye:0, matches:[[2,4],[1,3]] },
    { bye:1, matches:[[0,2],[3,4]] },
    { bye:4, matches:[[0,1],[2,3]] },
    { bye:3, matches:[[0,4],[1,2]] },
    { bye:2, matches:[[0,3],[1,4]] },
  ];
  const result = [];
  let idx = 0;
  ROUNDS.forEach((round, ri) => {
    round.matches.forEach(([t1,t2]) => {
      result.push({
        id: `P${poolIdx}-${idx}`,
        pool: poolIdx,
        t1, t2,
        s1: null, s2: null,
        status: "pending",
        slot: idx + 1,
        round: ri + 1,
        byeTeam: round.bye,
      });
      idx++;
    });
  });
  return result;
}

function computeStandings(teams, matches) {
  const stat = teams.map((name,i) => ({ idx:i, name, W:0, L:0, PF:0, PA:0, GP:0 }));
  (matches||[]).forEach(m => {
    if (m.status!=="done") return;
    stat[m.t1].PF+=m.s1; stat[m.t1].PA+=m.s2; stat[m.t1].GP++;
    stat[m.t2].PF+=m.s2; stat[m.t2].PA+=m.s1; stat[m.t2].GP++;
    if (m.s1>m.s2){stat[m.t1].W++;stat[m.t2].L++;}
    else{stat[m.t2].W++;stat[m.t1].L++;}
  });
  return stat.sort((a,b)=>b.W-a.W||(b.PF-b.PA)-(a.PF-a.PA));
}

function esc(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

export { makePoolMatches, computeStandings, esc };
