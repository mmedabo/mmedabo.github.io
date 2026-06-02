import { POOL_NAMES, POOL_COLORS, DEFAULT_TEAMS } from "./config.js";
import { esc, computeStandings } from "./helpers.js";
import { state, isAdmin, isConfigured } from "./state.js";

/* ==========================================================================
   RENDER - LANDING
========================================================================== */
function renderLanding() {
  return `
    <div class="landing-wrap">
      <img src="images/logo.jpg" class="landing-logo-img" alt="CSBV Logo"/>
      <img src="images/poster.jpg" class="landing-poster-img" alt="5.5 CSBV Tournament"/>
      <div class="landing-sub" style="margin-top:24px">4 Pools . 5 Teams per Pool . Pool -> QF -> SF -> Final</div>
      <div class="landing-cards">

        <div class="role-card viewer-card" onclick="enterViewer()">
          <div class="role-icon">[eye]</div>
          <div class="role-name">View Tournament</div>
          <div class="role-desc">See live scores, standings, bracket and progress - read only</div>
          <div class="role-btn viewer-btn">Enter as Viewer -></div>
        </div>

        <div class="role-card admin-card" onclick="showPinModal()">
          <div class="role-icon">[gear]</div>
          <div class="role-name">Admin</div>
          <div class="role-desc">Set up teams, enter scores, manage the bracket</div>
          <div class="role-btn admin-btn">Enter PIN -></div>
        </div>

      </div>
    </div>

    <!-- PIN MODAL -->
    <div id="pin-modal" class="modal-overlay" style="display:none" onclick="closePinModal(event)">
      <div class="modal-box">
        <div class="modal-title">[lock] Admin Access</div>
        <div class="modal-sub">Enter the admin PIN to continue</div>
        <input class="pin-inp" id="pin-input" type="password" inputmode="numeric"
          maxlength="8" placeholder="****" onkeydown="if(event.key==='Enter')submitPin()"/>
        <div id="pin-error" class="pin-error" style="display:none">Incorrect PIN - try again</div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button class="btn btn-save" style="flex:1" onclick="submitPin()">Unlock</button>
          <button class="btn btn-cancel" style="flex:1" onclick="closePinModal()">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   RENDER - POOL CARD (shared, admin flag gates editing)
========================================================================== */
function poolCardHTML(pi) {
  const color   = POOL_COLORS[pi];
  const teams   = state.pools.teams[pi];
  const matches = state.pools.matches[pi];
  const stand   = computeStandings(teams, matches);
  const done    = matches.filter(m=>m.status==="done").length;
  const admin   = isAdmin();

  const rows = stand.map((s,rank)=>`
    <tr class="${rank<2?"qualify":""}">
      <td><span class="rank-dot" style="${rank<2?`background:${color}22;color:${color}`:"color:#5A7A5E"}">${rank+1}</span></td>
      <td>
        <span>${esc(s.name)}</span>
        ${rank<2?`<span class="qualify-pill">QF</span>`:""}
      </td>
      <td style="color:${color}">${s.W}</td>
      <td style="color:#5A7A5E">${s.L}</td>
      <td style="color:${s.PF-s.PA>=0?"#27AE60":"#FF6B3D"};font-size:.8rem">${s.PF-s.PA>0?"+":""}${s.PF-s.PA}</td>
    </tr>`).join("");

  // Group matches by round and build display
  const matchesByRound = {};
  matches.forEach(m => {
    if (!matchesByRound[m.round]) matchesByRound[m.round] = [];
    matchesByRound[m.round].push(m);
  });

  const matchRows = Object.entries(matchesByRound).map(([roundNum, roundMatches]) => {
    const byeTeam = roundMatches[0].byeTeam;
    const byeName = teams[byeTeam] || `Team ${byeTeam+1}`;

    const matchBlocks = roundMatches.map(m => {
      const t1=teams[m.t1], t2=teams[m.t2];
      const w1=m.status==="done"&&m.s1>m.s2, w2=m.status==="done"&&m.s2>m.s1;
      const isEd=state.editingMatch===m.id;

      let scoreHTML;
      if (!admin) {
        scoreHTML = m.status==="done"
          ? `<span class="score-done">${m.s1}${m.s2}</span>`
          : m.status==="live"
            ? `<span class="live-pill">LIVE</span>`
            : `<span class="pending-pill">Upcoming</span>`;
      } else if (isEd) {
        scoreHTML = `<div class="score-box-col">
          <div class="score-box">
            <input class="score-inp" id="s1_${m.id}" type="number" min="0" value="${state.editScores.s1}" placeholder="0"/>
            <span class="score-dash"></span>
            <input class="score-inp" id="s2_${m.id}" type="number" min="0" value="${state.editScores.s2}" placeholder="0"/>
            <button class="btn btn-save" onclick="submitPoolScore('${pi}','${m.id}')">v</button>
            <button class="btn btn-cancel" onclick="cancelEdit()">x</button>
          </div>
          <div class="score-hint">First to 21 . win by 2</div>
        </div>`;
      } else if (m.status==="done") {
        scoreHTML = `<div class="score-box">
          <span class="score-done">${m.s1}${m.s2}</span>
          <button class="btn btn-ghost" onclick="startEdit('${pi}','${m.id}',${m.s1},${m.s2})">Edit</button>
          <button class="btn btn-reset" title="Reset match" onclick="if(confirm('Reset this match to unplayed?'))resetPoolMatch(${pi},'${m.id}')"><></button>
        </div>`;
      } else if (m.status==="live") {
        scoreHTML = `<div class="score-box">
          <button class="btn btn-go" onclick="startEdit('${pi}','${m.id}','','')">Score</button>
          <button class="btn btn-reset" title="Reset to pending" onclick="resetPoolMatch(${pi},'${m.id}')"><></button>
        </div>`;
      } else {
        scoreHTML = `<div class="score-box">
          <button class="btn btn-go" onclick="toggleLive(${pi},'${m.id}')">> Start</button>
        </div>`;
      }

      return `
        <div class="match-block ${m.status==="done"?"match-done":""}">
          <div class="match-row">
            <span class="slot-num">${m.slot}</span>
            <span class="status-dot dot-${m.status}"></span>
            <div class="match-teams">
              <span class="match-team-name ${w1?"won":w2?"lost":""}">${esc(t1)}</span>
              <span class="vs-sep">vs</span>
              <span class="match-team-name ${w2?"won":w1?"lost":""}">${esc(t2)}</span>
            </div>
            <div class="score-box-wrap">${scoreHTML}</div>
          </div>
        </div>`;
    }).join("");

    return `
      <div class="round-block">
        <div class="round-header">
          <span class="round-label">Round ${roundNum}</span>
          <span class="round-bye">zzz ${esc(byeName)} rests</span>
        </div>
        ${matchBlocks}
      </div>`;
  }).join("");

  return `
  <div class="pool-card" style="border-top:3px solid ${color}">
    <div class="pool-header">
      <div class="pool-name" style="color:${color}">Pool ${POOL_NAMES[pi]}</div>
      <div class="net-badge">Net ${pi+1}</div>
    </div>
    <table class="standings"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>PD</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="matches-section">
      <div class="matches-title">Matches (${done}/${matches.length})</div>
      ${matchRows}
    </div>
  </div>`;
}

/* ==========================================================================
   RENDER - KO CARD (shared, admin flag gates editing)
========================================================================== */
function koCardHTML(m, stage, idx) {
  const labels   = {qf:`QF ${idx+1}`,sf:`SF ${idx+1}`,final:"[cup] Final"};
  const isFinal  = stage==="final";
  const tbd      = !m.t1 && !m.t2;
  const w1=m.status==="done"&&m.s1>m.s2, w2=m.status==="done"&&m.s2>m.s1;
  const isEd     = state.koEditing===m.id;
  const admin    = isAdmin();
  const seedings = {
    qf:["A1 vs D2","B1 vs C2","C1 vs B2","D1 vs A2"],
    sf:["QF1W vs QF2W","QF3W vs QF4W"],
    final:["SF1W vs SF2W"],
  };

  const teamRow = (name, won, lost)=>`
    <div class="ko-match-row">
      <span class="ko-team ${!name?"tbd":won?"won":lost?"lost":""}">
        ${esc(name)||"TBD"}${won?` <span style="margin-left:6px;font-size:.7rem">[crown]</span>`:""}
      </span>
      ${m.status==="done"?`<span class="ko-score" style="color:${won?"#C8F04A":"#5A7A5E"}">${won?m.s1:m.s2}</span>`:""}
    </div>`;

  let actionHTML;
  if (tbd) {
    actionHTML = `<span style="font-size:.75rem;color:#5A7A5E;display:block;margin-top:10px">Awaiting results</span>`;
  } else if (!admin) {
    // viewer: just show live pill if in progress
    actionHTML = m.status==="done" ? "" : `<span class="pending-pill" style="margin-top:10px;display:inline-block">Upcoming</span>`;
  } else if (isEd) {
    actionHTML = `<div style="margin-top:12px">
      <div class="score-box" style="gap:6px">
        <input class="score-inp" id="ko_s1_${m.id}" type="number" min="0" value="${state.koScores.s1}" placeholder="0"/>
        <span style="color:#5A7A5E"></span>
        <input class="score-inp" id="ko_s2_${m.id}" type="number" min="0" value="${state.koScores.s2}" placeholder="0"/>
        <button class="btn btn-save" onclick="submitKOScore('${stage}','${m.id}')">v</button>
        <button class="btn btn-cancel" onclick="cancelKOEdit()">x</button>
      </div>
      <div class="score-hint" style="margin-top:4px">First to 21 . win by 2</div>
    </div>`;
  } else if (m.status==="done") {
    actionHTML = `<div style="display:flex;gap:6px;margin-top:10px">
      <button class="btn btn-ghost" onclick="startKOEdit('${stage}','${m.id}',${m.s1},${m.s2})">Edit Score</button>
      <button class="btn btn-reset" onclick="if(confirm('Reset this match?'))resetKOMatch('${stage}','${m.id}')"><> Reset</button>
    </div>`;
  } else {
    actionHTML = `<button class="btn btn-go" style="margin-top:10px" onclick="startKOEdit('${stage}','${m.id}','','')">Enter Score</button>`;
  }

  return `
  <div class="ko-card ${isFinal?"final-card":""}">
    <div class="ko-label">
      <span>${labels[stage]}</span>
      ${tbd?`<span style="color:#5A7A5E;font-size:.65rem">(${seedings[stage][idx]})</span>`:""}
    </div>
    ${teamRow(m.t1,w1,w2)}
    ${teamRow(m.t2,w2,w1)}
    ${actionHTML}
  </div>`;
}

/* ==========================================================================
   RENDER - SHARED TOURNAMENT VIEW (pools + knockout)
========================================================================== */
function renderTournament() {
  const { phase, tab, pools } = state;
  const admin = isAdmin();

  const allMatches = pools ? pools.matches.flat() : [];
  const donePool   = allMatches.filter(m=>m.status==="done").length;
  const livePool   = allMatches.filter(m=>m.status==="live").length;
  const totalPool  = allMatches.length;
  const poolsDone  = totalPool>0 && donePool===totalPool;
  const pct        = totalPool ? Math.round(donePool/totalPool*100) : 0;

  const champion = pools?.koMatches?.final?.[0]?.status==="done"
    ? (pools.koMatches.final[0].s1>pools.koMatches.final[0].s2
      ? pools.koMatches.final[0].t1 : pools.koMatches.final[0].t2) : null;

  const fbBadge = !isConfigured
    ? `<div class="fb-warning">(!) Firebase not connected - not syncing</div>`
    : `<div class="fb-ok">[on] Live sync active</div>`;

  const rolePill = admin
    ? `<span class="role-pill admin-pill">[gear] Admin</span>`
    : `<span class="role-pill viewer-pill">[eye] Viewing</span>`;

  const switchBtn = admin
    ? `<button class="btn btn-ghost btn-sm" onclick="switchRole('viewer')">Switch to Viewer</button>`
    : `<button class="btn btn-ghost btn-sm" onclick="showPinModal()">Admin Login</button>`;

  // header
  const hdr = `
    ${fbBadge}
    <div class="hdr">
      <div>
        <img src="images/logo.jpg" class="hdr-logo-img" alt="CSBV"/>
        <div class="hdr-sub">4 Pools . 5 Teams per Pool . Pool -> QF -> SF -> Final</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <div class="hdr-stats">
          <div><div class="hdr-stat-val">${donePool}/${totalPool}</div><div class="hdr-stat-lbl">Pool Done</div></div>
          <div><div class="hdr-stat-val" style="color:${livePool>0?"#FF6B3D":"#C8F04A"}">${livePool>0?livePool+"[live]":phase==="knockout"?"[hot]":"[wait]"}</div>
            <div class="hdr-stat-lbl">${livePool>0?"Live Now":phase==="knockout"?"Knockout":"Pool Phase"}</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${rolePill}${switchBtn}
          <button class="btn btn-ghost btn-sm no-print" onclick="exportPNG()" title="Download PNG">[dl] PNG</button>
          <button class="btn btn-ghost btn-sm no-print" onclick="window.print()" title="Print / Save as PDF">[print] PDF</button>
        </div>
      </div>
    </div>`;

  const tabs = `
    <div class="tabs">
      <button class="tab ${tab==="pools"?"on":""}" onclick="setTab('pools')">Pools</button>
      <button class="tab ${tab==="knockout"?"on":""}" onclick="setTab('knockout')">Knockout</button>
      <button class="tab ${tab==="teams"?"on":""}" onclick="setTab('teams')">Teams</button>
      <button class="tab ${tab==='schedule'?'on':''}" onclick="setTab('schedule')">Schedule</button>
      <button class="tab ${tab==="history"?"on":""}" onclick="setTab('history')">History</button>
      ${admin ? `<button class="tab ${tab==="inventory"?"on":""}" onclick="setTab('inventory')">Inventory</button><button class="tab ${tab==="setup"?"on":""}" onclick="setTab('setup')">[gear] Setup</button>` : ""}
    </div>`;

  let content = "";

  /* -- SETUP TAB (admin only) -- */
  if (tab==="setup" && admin) {
    const alreadyStarted = !!pools;
    const poolSetup = POOL_NAMES.map((pn,pi)=>{
      const currentNames = pools ? pools.teams[pi] : state.teamNames[pi];
      const inputs = currentNames.map((name,ti)=>`
        <div class="setup-team-row">
          <input class="setup-inp" value="${esc(name)}" placeholder="Team ${ti+1}"
            oninput="updateTeamName(${pi},${ti},this.value)"/>
        </div>`).join("");
      return `
        <div class="setup-card" style="border-top:3px solid ${POOL_COLORS[pi]}">
          <div class="setup-pool-title" style="color:${POOL_COLORS[pi]}">
            Pool ${pn} <span style="color:#5A7A5E;font-size:.8rem">. Net ${pi+1}</span>
          </div>
          ${inputs}
        </div>`;
    }).join("");

    const resetWarning = alreadyStarted ? `
      <div style="background:#FF6B3D18;border:1px solid #FF6B3D55;border-radius:10px;
        padding:12px 16px;margin-bottom:16px;font-size:.83rem;color:#FF6B3D;">
        (!) Tournament already started. Regenerating will <strong>reset all scores and matches</strong>.
        Team names edited here will carry over.
      </div>` : "";

    content = `
      ${resetWarning}
      <div style="margin-bottom:14px">
        <span class="tag">Edit team names before generating the tournament</span>
      </div>
      <div class="setup-grid">${poolSetup}</div>
      <button class="btn btn-go btn-lg" onclick="confirmGenerate()">
        ${alreadyStarted ? "[reset] Reset & Regenerate Tournament" : "[ball] Generate Tournament"}
      </button>`;
  }

  /* -- POOLS TAB -- */
  if (tab==="pools") {
    if (!pools) {
      content = admin
        ? `<div class="empty"><div class="empty-icon">[gear]</div><p>Go to the Setup tab to enter teams and start the tournament.</p></div>`
        : `<div class="empty"><div class="empty-icon">[wait]</div><p>Tournament hasn't started yet. Check back soon!</p></div>`;
    } else {
      const poolCards = POOL_NAMES.map((_,pi)=>poolCardHTML(pi)).join("");
      const advBtn = admin && poolsDone && phase!=="knockout"
        ? `<button class="btn btn-go btn-lg" onclick="advanceToKnockout()">! Advance Top 2 -> Quarterfinals</button>` : "";
      const goKO = phase==="knockout"
        ? `<button class="btn btn-ghost" style="width:100%;margin-top:16px" onclick="setTab('knockout')">View Knockout Bracket -></button>` : "";
      const hint = admin && !poolsDone && phase!=="knockout"
        ? `<p style="text-align:center;color:#5A7A5E;font-size:.82rem;margin-top:12px">Complete all pool matches to unlock Quarterfinals</p>` : "";

      content = `
        <div class="progress-row">
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="progress-label">${donePool}/${totalPool} done${livePool>0?` . <span style="color:#FF6B3D">${livePool} live</span>`:""}</div>
        </div>
        <div class="pools-grid">${poolCards}</div>
        ${hint}${advBtn}${goKO}`;
    }
  }

  /* -- KNOCKOUT TAB -- */
  if (tab==="knockout") {
    if (!pools || phase!=="knockout") {
      content = `<div class="empty"><div class="empty-icon">[lock]</div><p>${phase==="knockout"?"Loading...":"Pool phase in progress - knockout bracket unlocks after all pool matches."}</p></div>`;
    } else {
      const champBanner = champion ? `
        <div class="champion-banner">
          <div class="champion-icon">[cup]</div>
          <div class="champion-label">Tournament Champion</div>
          <div class="champion-name">${esc(champion)}</div>
        </div>` : "";

      const qfCards   = pools.koMatches.qf.map((m,i)=>koCardHTML(m,"qf",i)).join("");
      const sfCards   = pools.koMatches.sf.map((m,i)=>koCardHTML(m,"sf",i)).join("");
      const finalCard = pools.koMatches.final.map((m,i)=>koCardHTML(m,"final",i)).join("");

      content = `
        ${champBanner}
        <div class="ko-section">
          <div class="ko-title">Quarterfinals <div class="ko-title-bar"></div></div>
          <div class="ko-grid ko-grid-4">${qfCards}</div>
        </div>
        <div class="ko-section">
          <div class="ko-title">Semifinals <div class="ko-title-bar"></div></div>
          <div class="ko-grid ko-grid-2">${sfCards}</div>
        </div>
        <div class="ko-section">
          <div class="ko-title">Final [cup] <div class="ko-title-bar"></div></div>
          <div class="ko-grid ko-grid-1">${finalCard}</div>
        </div>`;
    }
  }

  /* -- TEAMS TAB -- */
  if (tab==="teams") {
    const teamCards = POOL_NAMES.map((pn,pi) => {
      const color = POOL_COLORS[pi];
      const poolTeams = (state.teamsData[pi] || []);

      const teamRows = poolTeams.map((team, ti) => {
        const teamLabel = pools ? pools.teams[pi][ti] : (state.teamNames[pi][ti] || `Team ${ti+1}`);

        if (admin) {
          // Editable: team name (propagates to pool) + male/female players
          const playerInputs = [
            { idx:0, gender:"male",   label:"M Male",   icon:"[M]", color:"#4DD9E8" },
            { idx:1, gender:"female", label:"F Female", icon:"[F]", color:"#B57BFF" },
          ].map(({idx,label,icon,color}) => `
            <div class="player-row">
              <span class="gender-badge" style="background:${color}18;color:${color};border:1px solid ${color}44">${label}</span>
              <input class="player-inp" value="${esc(team.players?.[idx]||'')}"
                placeholder="${icon} Player name"
                oninput="updatePlayer(${pi},${ti},${idx},this.value)"/>
            </div>`).join("");

          return `
            <div class="team-entry">
              <div class="team-entry-hdr" style="border-left:3px solid ${color}">
                <input class="team-name-inp" value="${esc(teamLabel)}"
                  placeholder="Team name"
                  oninput="updateTeamNameLive(${pi},${ti},this.value)"
                  style="background:transparent;border:none;border-bottom:1px solid ${color}55;color:var(--text);
                    font-family:'Barlow Condensed',sans-serif;font-size:1.1rem;font-weight:700;letter-spacing:1px;
                    flex:1;outline:none;padding:2px 4px;min-width:0;"/>
                <span class="team-entry-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">Pool ${pn}</span>
              </div>
              <div class="player-list">${playerInputs}</div>
            </div>`;
        } else {
          // View only
          const male   = (team.players||[])[0]?.trim() || "";
          const female = (team.players||[])[1]?.trim() || "";
          const complete = male && female;
          const playerList = `
            <div class="player-view-row">
              <span class="gender-badge" style="background:#4DD9E818;color:#4DD9E8;border:1px solid #4DD9E844">M Male</span>
              <span style="${!male?"color:#5A7A5E;font-style:italic":""}">${esc(male)||"Not listed"}</span>
            </div>
            <div class="player-view-row" style="border-bottom:none">
              <span class="gender-badge" style="background:#B57BFF18;color:#B57BFF;border:1px solid #B57BFF44">F Female</span>
              <span style="${!female?"color:#5A7A5E;font-style:italic":""}">${esc(female)||"Not listed"}</span>
            </div>
            ${!complete?`<div style="font-size:.7rem;color:#FF6B3D;margin-top:6px">(!) Roster incomplete</div>`:""}
          `;

          return `
            <div class="team-entry">
              <div class="team-entry-hdr" style="border-left:3px solid ${color}">
                <span class="team-entry-name">${esc(teamLabel)}</span>
                <span class="team-entry-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">Pool ${pn}</span>
              </div>
              <div class="player-list">${playerList}</div>
            </div>`;
        }
      }).join("");

      return `
        <div class="teams-pool-section">
          <div class="teams-pool-title" style="color:${color}">
            Pool ${pn} <span style="color:#5A7A5E;font-weight:400;font-size:.85rem">. Net ${pi+1}</span>
          </div>
          <div class="teams-grid">${teamRows}</div>
        </div>`;
    }).join("");

    const saveBtn = admin
      ? `<button class="btn btn-save btn-lg" onclick="saveTeamsData()">[save] Save Roster & Team Names</button>` : "";

    content = `
      <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span class="tag">${admin ? "Edit team names . 1 male + 1 female per team . Changes sync everywhere" : "Team rosters . Mixed pairs format"}</span>
        ${admin ? `<span style="font-size:.75rem;color:#5A7A5E">Changes sync live to all viewers</span>` : ""}
      </div>
      ${teamCards}
      ${saveBtn}`;
  }


  if (tab==="schedule") {
    if (!pools) {
      content = `<div style="text-align:center;padding:60px 20px;color:var(--muted)">
        <div style="font-size:2.5rem;margin-bottom:12px">[cal]</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:1.2rem;letter-spacing:2px">
          Tournament not started yet</div>
        <div style="font-size:.83rem;margin-top:6px">Schedule will appear once the tournament begins.</div>
      </div>`;
    } else {
      const NUM_COURTS = 8;
      const allPoolMatches = pools.matches.flatMap((pm, pi) =>
        pm.map(m => ({ ...m, poolIdx: pi, poolName: POOL_NAMES[pi], poolColor: POOL_COLORS[pi],
          t1name: pools.teams[pi][m.t1], t2name: pools.teams[pi][m.t2] }))
      );

      const schedRows = allPoolMatches.map(m => {
        const sched = state.schedule[m.id] || {};
        const court = sched.court || "";
        const time  = sched.time  || "";
        const statusDot = `<span class="status-dot dot-${m.status}" style="flex-shrink:0"></span>`;
        const scoreStr = m.status==="done" ? `${m.s1}\u2013${m.s2}` : m.status==="live" ? "LIVE" : "\u2014";

        const courtCell = admin
          ? `<select class="sched-sel" onchange="setScheduleCourt('${m.id}',this.value)">
               <option value="">\u2014</option>
               ${Array.from({length:NUM_COURTS},(_,i)=>"<option value=\"Court "+(i+1)+"\" "+(court==="Court "+(i+1)?"selected":"")+">"+"Court "+(i+1)+"</option>").join("")}
             </select>`
          : `<span style="color:${court?"var(--text)":"var(--muted)"}">${court||"\u2014"}</span>`;

        const timeCell = admin
          ? `<input class="sched-inp" type="time" value="${time}"
               onchange="setScheduleTime('${m.id}',this.value)"/>`
          : `<span style="color:${time?"var(--text)":"var(--muted)"}">${time||"\u2014"}</span>`;

        return `<tr class="sched-row">
          <td><span class="sched-pool-pill" style="background:${m.poolColor}22;color:${m.poolColor};border:1px solid ${m.poolColor}55">
            Pool ${m.poolName}</span></td>
          <td style="color:var(--muted);font-size:.78rem">R${m.round} \u00b7 #${m.slot}</td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              ${statusDot}
              <div>
                <div class="sched-team">${esc(m.t1name)}</div>
                <div style="font-size:.7rem;color:var(--muted)">vs</div>
                <div class="sched-team">${esc(m.t2name)}</div>
              </div>
            </div>
          </td>
          <td>${courtCell}</td>
          <td>${timeCell}</td>
          <td style="font-family:'Barlow Condensed',sans-serif;color:${m.status==="done"?"var(--accent)":m.status==="live"?"var(--coral)":"var(--muted)"}">
            ${scoreStr}</td>
        </tr>`;
      }).join("");

      content = `
        <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <span class="tag">${admin?"Assign courts & times to each pool match":"Full match schedule"}</span>
          ${admin?`<span style="font-size:.75rem;color:var(--muted)">Changes sync live</span>`:""}
        </div>
        <div class="sched-table-wrap">
          <table class="sched-table">
            <thead><tr>
              <th>Pool</th><th>Slot</th><th>Match</th><th>Court</th><th>Time</th><th>Score</th>
            </tr></thead>
            <tbody>${schedRows}</tbody>
          </table>
        </div>`;
    }
  }

  if (tab==="history") {
    const log = state.auditLog || [];
    if (log.length === 0) {
      content = `<div style="text-align:center;padding:60px 20px;color:var(--muted)">
        <div style="font-size:2.5rem;margin-bottom:12px">[log]</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:1.2rem;letter-spacing:2px">No activity yet</div>
        <div style="font-size:.83rem;margin-top:6px">Score entries and resets will appear here.</div>
      </div>`;
    } else {
      const now = Date.now();
      function relTime(ts) {
        const diff = Math.floor((now - ts) / 1000);
        if (diff < 60)  return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
        return new Date(ts).toLocaleDateString();
      }
      const entries = log.map(e => {
        const isScore = e.action === "score";
        const isReset = e.action === "reset";
        const isPool  = e.type  === "pool";
        const color   = isPool
          ? (POOL_COLORS[POOL_NAMES.indexOf(e.pool)] || "var(--accent)")
          : "var(--gold)";
        const icon  = isReset ? "<>" : isPool ? "[ball]" : "[cup]";
        const badge = isPool
          ? `<span class="hist-badge" style="background:${color}22;color:${color};border:1px solid ${color}55">Pool ${e.pool}</span>`
          : `<span class="hist-badge" style="background:var(--gold)22;color:var(--gold);border:1px solid var(--gold)55">${{qf:"QF",sf:"SF",final:"Final"}[e.stage]||e.stage}</span>`;
        const winner = isScore && !isReset
          ? (e.s1 > e.s2 ? e.t1 : e.t2) : null;
        return `
          <div class="hist-entry ${isReset?"hist-reset":""}">
            <div class="hist-icon">${icon}</div>
            <div class="hist-body">
              <div class="hist-label">${esc(e.label)}</div>
              ${winner ? `<div class="hist-winner">Winner: ${esc(winner)}</div>` : ""}
            </div>
            <div class="hist-meta">
              ${badge}
              <span class="hist-time">${relTime(e.ts)}</span>
            </div>
          </div>`;
      }).join("");
      content = `
        <div style="margin-bottom:12px">
          <span class="tag">${log.length} event${log.length!==1?"s":""} . most recent first</span>
        </div>
        <div class="hist-list">${entries}</div>`;
    }
  }


  if (tab==="inventory") {
    const inv    = state.inventory || { equipment:[], drinks:[] };
    const equip  = inv.equipment || [];
    const drinks = inv.drinks    || [];

    const outCount      = equip.filter(e => e.assignedTo && !e.returned).length;
    const returnedCount = equip.filter(e => e.returned).length;
    const inStock       = equip.length - outCount - returnedCount;

    // Per-item status
    function sLabel(it){ return it.returned ? "Returned" : it.assignedTo ? "Checked Out" : "In Stock"; }
    function sColor(it){ return it.returned ? "#27AE60"  : it.assignedTo ? "#FF6B3D"    : "#5A7A5E"; }
    function sBg(it)   { return it.returned ? "#27AE6018": it.assignedTo ? "#FF6B3D18"  : "#1E3A20"; }

    // Equipment rows
    const equipRows = equip.map((item, idx) => `
      <tr class="inv-tr">
        <td class="inv-td inv-td-name">
          <input class="inv-inline-inp" value="${esc(item.name)}"
            oninput="updateInvEquipName(${idx},this.value)"/>
        </td>
        <td class="inv-td">
          <span class="inv-cat-dot inv-cat-${item.category}"></span>
          <select class="inv-type-sel inv-type-${item.category}" onchange="updateInvCategory(${idx},this.value)">
            <option value="ball" ${item.category==="ball"?"selected":""}>Ball</option>
            <option value="net"  ${item.category==="net" ?"selected":""}>Net</option>
            <option value="other"${item.category==="other"?"selected":""}>Other</option>
          </select>
        </td>
        <td class="inv-td inv-td-assign">
          <input class="inv-inline-inp inv-assign-inp" value="${esc(item.assignedTo||'')}"
            placeholder="Unassigned"
            oninput="updateInvAssign(${idx},this.value)" onblur="render()"/>
        </td>
        <td class="inv-td" style="text-align:center">
          <label class="inv-check-wrap">
            <input type="checkbox" ${item.returned?"checked":""} onchange="toggleInvReturned(${idx},this.checked)"/>
          </label>
        </td>
        <td class="inv-td" style="text-align:right">
          <span class="inv-status-pill" style="background:${sBg(item)};color:${sColor(item)};border:1px solid ${sColor(item)}44">
            ${sLabel(item)}
          </span>
        </td>
      </tr>`).join("");

    // Drink rows
    const drinkRows = drinks.map((d, idx) => {
      const empty = d.qty === 0;
      const low   = d.qty > 0 && d.qty <= 3;
      const qCol  = empty ? "#5A7A5E" : low ? "#FF6B3D" : "#27AE60";
      const tag   = empty ? "Out" : low ? "Low" : "OK";
      const tagBg = empty ? "#5A7A5E18" : low ? "#FF6B3D18" : "#27AE6018";
      const tagBd = empty ? "#5A7A5E44" : low ? "#FF6B3D44" : "#27AE6044";
      return `
      <tr class="inv-tr">
        <td class="inv-td inv-td-name">
          <input class="inv-inline-inp" value="${esc(d.name)}"
            oninput="updateDrinkName(${idx},this.value)"/>
        </td>
        <td class="inv-td" style="color:var(--muted);font-size:.78rem">
          <input class="inv-inline-inp" value="${esc(d.unit)}"
            style="color:var(--muted);width:80px"
            oninput="updateDrinkUnit(${idx},this.value)"/>
        </td>
        <td class="inv-td">
          <input class="inv-inline-inp" value="${esc(d.notes||'')}" placeholder="Notes..."
            style="font-size:.78rem;color:var(--muted)"
            oninput="updateDrinkNotes(${idx},this.value)"/>
        </td>
        <td class="inv-td" style="text-align:center">
          <div class="inv-qty-row">
            <button class="inv-qbtn" onclick="adjustDrinkQty(${idx},-1)">-</button>
            <input class="inv-qty-inp" type="number" min="0" value="${d.qty}"
              style="color:${qCol}"
              oninput="setDrinkQty(${idx},this.value)"
              onblur="render()"/>
            <button class="inv-qbtn" onclick="adjustDrinkQty(${idx},+1)">+</button>
          </div>
        </td>
        <td class="inv-td" style="text-align:right">
          <span class="inv-status-pill" style="background:${tagBg};color:${qCol};border:1px solid ${tagBd}">
            ${tag}
          </span>
        </td>
      </tr>`;
    }).join("");

    content = `
      <div class="inv-top-bar">
        <div class="inv-kpi">
          <span class="inv-kpi-num">${equip.length}</span>
          <span class="inv-kpi-lbl">Total</span>
        </div>
        <div class="inv-kpi-div"></div>
        <div class="inv-kpi">
          <span class="inv-kpi-num" style="color:#FF6B3D">${outCount}</span>
          <span class="inv-kpi-lbl">Checked Out</span>
        </div>
        <div class="inv-kpi-div"></div>
        <div class="inv-kpi">
          <span class="inv-kpi-num" style="color:#27AE60">${returnedCount}</span>
          <span class="inv-kpi-lbl">Returned</span>
        </div>
        <div class="inv-kpi-div"></div>
        <div class="inv-kpi">
          <span class="inv-kpi-num" style="color:var(--accent)">${inStock}</span>
          <span class="inv-kpi-lbl">In Stock</span>
        </div>
        <button class="btn btn-save" style="margin-left:auto" onclick="saveInventory()">Save All</button>
      </div>

      <div class="inv-section-block">
        <div class="inv-section-hdr">Equipment</div>
        <table class="inv-table">
          <thead>
            <tr>
              <th>Item</th>
              <th style="width:80px">Type</th>
              <th>Ownership</th>
              <th style="width:80px;text-align:center">Returned</th>
              <th style="width:110px;text-align:right">Status</th>
            </tr>
          </thead>
          <tbody>${equipRows}</tbody>
        </table>
        <button class="inv-add-row-btn" onclick="addInvEquip()">+ Add Item</button>
      </div>

      <div class="inv-section-block">
        <div class="inv-section-hdr">Drinks &amp; Refreshments</div>
        <table class="inv-table">
          <thead>
            <tr>
              <th>Drink</th>
              <th style="width:90px">Unit</th>
              <th>Notes</th>
              <th style="width:120px;text-align:center">Quantity</th>
              <th style="width:80px;text-align:right">Stock</th>
            </tr>
          </thead>
          <tbody>${drinkRows}</tbody>
        </table>
        <button class="inv-add-row-btn" onclick="addDrink()">+ Add Drink</button>
      </div>
    `;
  }
  return `${hdr}${tabs}<div class="content">${content}</div>`;
}

/* ==========================================================================
   MAIN RENDER
========================================================================== */
function render() {
  const root = document.getElementById("root");
  if (state.role==="landing") {
    root.innerHTML = renderLanding();
  } else {
    // admin: if no pools yet, default to setup tab
    if (isAdmin() && !state.pools && state.tab!=="setup") state.tab = "setup";
    if (!isAdmin() && (state.tab==="inventory" || state.tab==="setup")) state.tab = "pools";
    root.innerHTML = renderTournament();
  }
  // Re-attach pin modal if on landing
  if (state.pinError) {
    const err = document.getElementById("pin-error");
    if (err) err.style.display = "block";
  }
}

export { render, renderLanding, renderTournament };
