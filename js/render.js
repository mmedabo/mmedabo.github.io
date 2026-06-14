import { POOL_NAMES, POOL_COLORS, COURT_NAMES, DEFAULT_TEAMS } from "./config.js";
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
          <div class="role-icon">&#128065;</div>
          <div class="role-name">View Tournament</div>
          <div class="role-desc">See live scores, standings, bracket and progress - read only</div>
          <div class="role-btn viewer-btn">Enter as Viewer -></div>
        </div>

        <div class="role-card admin-card" onclick="showPinModal()">
          <div class="role-icon">&#9881;</div>
          <div class="role-name">Admin</div>
          <div class="role-desc">Set up teams, enter scores, manage the bracket</div>
          <div class="role-btn admin-btn">Enter PIN -></div>
        </div>

      </div>
    </div>

    <!-- PIN MODAL -->
    <div id="pin-modal" class="modal-overlay" style="display:none" onclick="closePinModal(event)">
      <div class="modal-box">
        <div class="modal-title">&#128272; Admin Access</div>
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

  const rows = stand.map((s,rank) => {
    const expandKey = `${pi}-${s.name}`;
    const expanded  = !!state.expandedTeams[expandKey];

    // Look up players from teamsData by matching team name
    const teamIdx   = state.pools.teams[pi].indexOf(s.name);
    const teamData  = (state.teamsData?.[pi]?.[teamIdx]) || {};
    const male      = (teamData.players?.[0] || "").trim();
    const female    = (teamData.players?.[1] || "").trim();
    const hasPlayers = male || female;

    const expandBtn = hasPlayers
      ? `<button class="team-expand-btn ${expanded?"open":""}" onclick="toggleTeamExpand('${expandKey}')" title="Show players">
           ${expanded ? "&#9660;" : "&#9658;"}
         </button>`
      : `<span class="team-expand-btn-placeholder"></span>`;

    const playerRow = (expanded && hasPlayers) ? `
      <tr class="team-player-row ${rank<2?"qualify":""}">
        <td></td>
        <td colspan="4">
          <div class="team-player-list">
            ${male   ? `<span class="player-chip male-chip">&#9794; ${esc(male)}</span>`   : ""}
            ${female ? `<span class="player-chip female-chip">&#9792; ${esc(female)}</span>` : ""}
          </div>
        </td>
      </tr>` : "";

    return `
    <tr class="${rank<2?"qualify":""}">
      <td><span class="rank-dot" style="${rank<2?`background:${color}22;color:${color}`:"color:#5A7A5E"}">${rank+1}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          ${expandBtn}
          <span>${esc(s.name)}</span>
          ${rank<2?`<span class="qualify-pill">QF</span>`:""}
        </div>
      </td>
      <td style="color:${color}">${s.W}</td>
      <td style="color:#5A7A5E">${s.L}</td>
      <td style="color:${s.PF-s.PA>=0?"#27AE60":"#FF6B3D"};font-size:.8rem">${s.PF-s.PA>0?"+":""}${s.PF-s.PA}</td>
    </tr>${playerRow}`;
  }).join("");

  // Group matches by round and build display
  const matchesByRound = {};
  matches.forEach(m => {
    if (!matchesByRound[m.round]) matchesByRound[m.round] = [];
    matchesByRound[m.round].push(m);
  });

  const matchRows = Object.entries(matchesByRound).map(([roundNum, roundMatches]) => {
    const byeTeam = roundMatches[0].byeTeam;
    const byeName = teams[byeTeam] || `Team ${byeTeam+1}`;

    const matchBlocks = roundMatches.map((m, mi) => {
      // Court per match: schedule override if set, else the pool's own courts.
      // Orientation alternates each round (R1: c1,c2 / R2: c2,c1 / ...) so that
      // every team plays exactly 2 of its 4 matches on each court.
      const sched = state.schedule[m.id] || {};
      const legacy = /^Court ([1-8])$/.exec(sched.court || "");
      const court = legacy ? COURT_NAMES[+legacy[1] - 1]
                           : (sched.court || COURT_NAMES[pi*2 + ((mi + +roundNum + 1) % 2)]);
      const t1=teams[m.t1], t2=teams[m.t2];
      const w1=m.status==="done"&&m.s1>m.s2, w2=m.status==="done"&&m.s2>m.s1;
      const isEd=state.editingMatch===m.id;

      let scoreHTML;
      if (!admin) {
        scoreHTML = m.status==="done"
          ? `<span class="score-done">${m.s1} - ${m.s2}</span>`
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
          <div class="score-hint">First to 15, win by 2, cap 18</div>
        </div>`;
      } else if (m.status==="done") {
        scoreHTML = `<div class="score-box">
          <span class="score-done">${m.s1} - ${m.s2}</span>
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
            <span class="court-tag">${esc(court.replace(/^Court /, ""))}</span>
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
          <span class="round-bye">&#128164; ${esc(byeName)} rests</span>
        </div>
        ${matchBlocks}
      </div>`;
  }).join("");

  const isOpen = state.expandedPools[pi] !== false; // default open

  return `
  <div class="pool-card ${isOpen?"pool-open":"pool-collapsed"}" style="border-top:3px solid ${color}">
    <div class="pool-header pool-header-clickable" onclick="togglePoolExpand(${pi})">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="pool-chevron" style="color:${color}">${isOpen ? "&#9660;" : "&#9658;"}</span>
        <div class="pool-name" style="color:${color}">Pool ${POOL_NAMES[pi]}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:.72rem;color:var(--muted)">${done}/${matches.length} done</span>
        <div class="net-badge">Courts ${POOL_NAMES[pi]}1, ${POOL_NAMES[pi]}2</div>
      </div>
    </div>
    ${isOpen ? `
    <table class="standings"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>PD</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="matches-section">
      <div class="matches-title">Matches (${done}/${matches.length})</div>
      ${matchRows}
    </div>` : ""}
  </div>`;
}

/* ==========================================================================
   RENDER - KO CARD (shared, admin flag gates editing)
========================================================================== */
function koCardHTML(m, stage, idx) {
  const labels   = {qf:`QF ${idx+1}`,sf:`SF ${idx+1}`,third:"&#129353; 3rd Place",final:"&#127942; Final"};
  const isFinal  = stage==="final";
  const isThird  = stage==="third";
  const tbd      = !m.t1 && !m.t2;
  const w1=m.status==="done"&&m.s1>m.s2, w2=m.status==="done"&&m.s2>m.s1;
  const isEd     = state.koEditing===m.id;
  const admin    = isAdmin();
  const seedings = {
    qf:["A1 vs D2","B1 vs C2","C1 vs B2","D1 vs A2"],
    sf:["QF1W vs QF2W","QF3W vs QF4W"],
    third:["SF1L vs SF2L"],
    final:["SF1W vs SF2W"],
  };

  const teamRow = (name, won, lost)=>`
    <div class="ko-match-row">
      <span class="ko-team ${!name?"tbd":won?"won":lost?"lost":""}">
        ${esc(name)||"TBD"}${won?` <span style="margin-left:6px;font-size:.7rem">&#128081;</span>`:""}
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
      <div class="score-hint" style="margin-top:4px">First to 21, win by 2, cap 25</div>
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
  <div class="ko-card ${isFinal?"final-card":""} ${isThird?"third-card":""}">
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

  const finalM = pools?.koMatches?.final?.[0];
  const champion = finalM?.status==="done"
    ? (finalM.s1>finalM.s2 ? finalM.t1 : finalM.t2) : null;
  // Podium: gold = final winner, silver = final loser, bronze = 3rd-place winner
  const silver = finalM?.status==="done"
    ? (finalM.s1>finalM.s2 ? finalM.t2 : finalM.t1) : null;
  // The 3rd-place match is the two semi-final losers; derive a fallback if the
  // saved bracket predates the third-place feature so it still renders/scores.
  const sfDone = (pools?.koMatches?.sf||[]).filter(m=>m.status==="done");
  let thirdM = pools?.koMatches?.third?.[0];
  if ((!thirdM || (!thirdM.t1 && !thirdM.t2)) && sfDone.length===2) {
    const l = sfDone.map(m=>m.s1>m.s2?m.t2:m.t1);
    thirdM = { id:"third", t1:l[0], t2:l[1], s1:thirdM?.s1??null, s2:thirdM?.s2??null,
               status: thirdM?.status||"pending" };
  }
  const bronze = thirdM?.status==="done"
    ? (thirdM.s1>thirdM.s2 ? thirdM.t1 : thirdM.t2) : null;

  // Map a team name to its two player names (male, female) for the podium.
  const playersByTeam = {};
  if (pools?.teams) {
    pools.teams.forEach((poolTeams, pi) => {
      poolTeams.forEach((teamName, ti) => {
        const players = (state.teamsData[pi]?.[ti]?.players || []).filter(Boolean);
        if (teamName) playersByTeam[teamName] = players;
      });
    });
  }

  const fbBadge = !isConfigured
    ? `<div class="fb-warning">(!) Firebase not connected - not syncing</div>`
    : `<div class="fb-ok">&#128994; Live sync active</div>`;

  const rolePill = admin
    ? `<span class="role-pill admin-pill">&#9881; Admin</span>`
    : `<span class="role-pill viewer-pill">&#128065; Viewing</span>`;

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
          <div><div class="hdr-stat-val" style="color:${livePool>0?"#FF6B3D":"#C8F04A"}">${livePool>0?livePool+"&#128308;":phase==="knockout"?"&#128293;":"&#9203;"}</div>
            <div class="hdr-stat-lbl">${livePool>0?"Live Now":phase==="knockout"?"Knockout":"Pool Phase"}</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${rolePill}${switchBtn}
          <button class="btn btn-ghost btn-sm no-print" onclick="exportPNG()" title="Download PNG">&#11015; PNG</button>
          <button class="btn btn-ghost btn-sm no-print" onclick="window.print()" title="Print / Save as PDF">&#128424; PDF</button>
        </div>
      </div>
    </div>`;

  const tabs = `
    <div class="tabs">
      <button class="tab ${tab==="overview"?"on":""}" onclick="setTab('overview')">Overview</button>
      <button class="tab ${tab==="rules"?"on":""}" onclick="setTab('rules')">&#128214; Rules</button>
      <button class="tab ${tab==="pools"?"on":""}" onclick="setTab('pools')">Pools</button>
      <button class="tab ${tab==="knockout"?"on":""}" onclick="setTab('knockout')">Knockout</button>
      <button class="tab ${tab==="teams"?"on":""}" onclick="setTab('teams')">Teams</button>
      <button class="tab ${tab==='schedule'?'on':''}" onclick="setTab('schedule')">Schedule</button>
      <button class="tab ${tab==="history"?"on":""}" onclick="setTab('history')">History</button>
      ${admin ? `<button class="tab ${tab==="inventory"?"on":""}" onclick="setTab('inventory')">Inventory</button><button class="tab ${tab==="setup"?"on":""}" onclick="setTab('setup')">&#9881; Setup</button>` : ""}
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
        ${alreadyStarted ? "&#128260; Reset & Regenerate Tournament" : "&#127952; Generate Tournament"}
      </button>`;
  }

  /* -- POOLS TAB -- */
  if (tab==="pools") {
    if (!pools) {
      content = admin
        ? `<div class="empty"><div class="empty-icon">&#9881;</div><p>Go to the Setup tab to enter teams and start the tournament.</p></div>`
        : `<div class="empty"><div class="empty-icon">&#9203;</div><p>Tournament hasn't started yet. Check back soon!</p></div>`;
    } else {
      const poolCards = POOL_NAMES.map((_,pi)=>poolCardHTML(pi)).join("");
      const advBtn = admin && poolsDone && phase!=="knockout"
        ? `<button class="btn btn-go btn-lg" onclick="advanceToKnockout()">! Advance Top 2 -> Quarterfinals</button>` : "";
      const goKO = phase==="knockout"
        ? `<button class="btn btn-ghost" style="width:100%;margin-top:16px" onclick="setTab('knockout')">View Knockout Bracket -></button>` : "";
      const hint = admin && !poolsDone && phase!=="knockout"
        ? `<p style="text-align:center;color:#5A7A5E;font-size:.82rem;margin-top:12px">Complete all pool matches to unlock Quarterfinals</p>` : "";

      const poolFormatBanner = `
        <div class="format-banner">
          <div class="format-banner-title">&#127952; Qualifier Format</div>
          <div class="format-rules">
            <span class="format-rule"><span class="format-rule-num">15</span><span class="format-rule-lbl">points to win</span></span>
            <span class="format-sep">&#9679;</span>
            <span class="format-rule"><span class="format-rule-num">+2</span><span class="format-rule-lbl">win margin (deuce)</span></span>
            <span class="format-sep">&#9679;</span>
            <span class="format-rule"><span class="format-rule-num">18</span><span class="format-rule-lbl">cap (continuous deuce)</span></span>
          </div>
        </div>`;

      content = `
        ${poolFormatBanner}
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
      // Show bracket skeleton — structure without team names
      const seedLabels = {
        qf: ["A1 vs D2","B1 vs C2","C1 vs B2","D1 vs A2"],
        sf: ["QF1 Winner vs QF2 Winner","QF3 Winner vs QF4 Winner"],
        final: ["SF1 Winner vs SF2 Winner"],
      };
      function skeletonCard(label, stageLabel) {
        return `
          <div class="ko-card ko-skeleton">
            <div class="ko-label">${stageLabel}</div>
            <div class="ko-skeleton-row">
              <span class="ko-skeleton-team">TBD</span>
            </div>
            <div class="ko-skeleton-divider"></div>
            <div class="ko-skeleton-row">
              <span class="ko-skeleton-team">TBD</span>
            </div>
            <div class="ko-skeleton-seed">${label}</div>
          </div>`;
      }
      const qfSkel   = seedLabels.qf.map((l,i) => skeletonCard(l, `QF ${i+1}`)).join("");
      const sfSkel   = seedLabels.sf.map((l,i) => skeletonCard(l, `SF ${i+1}`)).join("");
      const finSkel  = seedLabels.final.map((l,i) => skeletonCard(l, "&#127942; Final")).join("");

      content = `
        <div class="format-banner format-banner-ko">
          <div class="format-banner-title">&#127942; Knockout Format &mdash; QF / SF / Final</div>
          <div class="format-rules">
            <span class="format-rule"><span class="format-rule-num">21</span><span class="format-rule-lbl">points to win</span></span>
            <span class="format-sep">&#9679;</span>
            <span class="format-rule"><span class="format-rule-num">+2</span><span class="format-rule-lbl">win margin (deuce)</span></span>
            <span class="format-sep">&#9679;</span>
            <span class="format-rule"><span class="format-rule-num">25</span><span class="format-rule-lbl">cap (continuous deuce)</span></span>
          </div>
        </div>
        <div class="ko-notice">
          &#128274; Pool phase in progress &mdash; bracket seeds shown below. Teams locked in once all pool matches complete.
        </div>
        <div class="ko-section">
          <div class="ko-title">Quarterfinals <div class="ko-title-bar"></div></div>
          <div class="ko-grid ko-grid-4">${qfSkel}</div>
        </div>
        <div class="ko-section">
          <div class="ko-title">Semifinals <div class="ko-title-bar"></div></div>
          <div class="ko-grid ko-grid-2">${sfSkel}</div>
        </div>
        <div class="ko-section">
          <div class="ko-title">Final &#127942; <div class="ko-title-bar"></div></div>
          <div class="ko-grid ko-grid-1">${finSkel}</div>
        </div>`;
    } else {
      // Full podium once we have a champion; otherwise keep the simple banner.
      const podiumStep = (place, medal, label, name, cls) => {
        const players = name ? (playersByTeam[name]||[]) : [];
        const playersHTML = players.length
          ? `<div class="podium-players">${players.map(p=>esc(p)).join(" &bull; ")}</div>` : "";
        return `
        <div class="podium-step podium-${cls}">
          <div class="podium-top">
            <div class="podium-medal">${medal}</div>
            <div class="podium-place">${label}</div>
            <div class="podium-name">${name?esc(name):"&mdash;"}</div>
            ${playersHTML}
          </div>
          <div class="podium-bar">${place}</div>
        </div>`;
      };
      const champBanner = champion ? `
        <div class="podium">
          ${podiumStep(2,"&#129352;","Runner-up",silver,"silver")}
          ${podiumStep(1,"&#129351;","Champion",champion,"gold")}
          ${podiumStep(3,"&#129353;","3rd Place",bronze,"bronze")}
        </div>` : "";

      const qfCards   = pools.koMatches.qf.map((m,i)=>koCardHTML(m,"qf",i)).join("");
      const sfCards   = pools.koMatches.sf.map((m,i)=>koCardHTML(m,"sf",i)).join("");
      const finalCard = pools.koMatches.final.map((m,i)=>koCardHTML(m,"final",i)).join("");
      const thirdCard = thirdM ? koCardHTML(thirdM,"third",0) : "";

      const koFormatBanner = `
        <div class="format-banner format-banner-ko">
          <div class="format-banner-title">&#127942; Knockout Format &mdash; QF / SF / Final</div>
          <div class="format-rules">
            <span class="format-rule"><span class="format-rule-num">21</span><span class="format-rule-lbl">points to win</span></span>
            <span class="format-sep">&#9679;</span>
            <span class="format-rule"><span class="format-rule-num">+2</span><span class="format-rule-lbl">win margin (deuce)</span></span>
            <span class="format-sep">&#9679;</span>
            <span class="format-rule"><span class="format-rule-num">25</span><span class="format-rule-lbl">cap (continuous deuce)</span></span>
          </div>
        </div>`;

      content = `
        ${koFormatBanner}
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
          <div class="ko-title">Final &#127942; &amp; 3rd Place &#129353; <div class="ko-title-bar"></div></div>
          <div class="ko-grid ko-grid-2">${finalCard}${thirdCard}</div>
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
      ? `<button class="btn btn-save btn-lg" onclick="saveTeamsData()">&#128190; Save Roster & Team Names</button>` : "";

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
        <div style="font-size:2.5rem;margin-bottom:12px">&#128197;</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:1.2rem;letter-spacing:2px">
          Tournament not started yet</div>
        <div style="font-size:.83rem;margin-top:6px">Schedule will appear once the tournament begins.</div>
      </div>`;
    } else {
      const allPoolMatches = pools.matches.flatMap((pm, pi) =>
        pm.map(m => ({ ...m, poolIdx: pi, poolName: POOL_NAMES[pi], poolColor: POOL_COLORS[pi],
          t1name: pools.teams[pi][m.t1], t2name: pools.teams[pi][m.t2] }))
      );

      const schedRows = allPoolMatches.map(m => {
        const sched = state.schedule[m.id] || {};
        // Map legacy "Court N" values saved before courts were renamed A1-D2
        const legacy = /^Court ([1-8])$/.exec(sched.court || "");
        const court = legacy ? COURT_NAMES[+legacy[1] - 1] : (sched.court || "");
        const time  = sched.time  || "";
        const statusDot = `<span class="status-dot dot-${m.status}" style="flex-shrink:0"></span>`;
        const scoreStr = m.status==="done" ? `${m.s1}\u2013${m.s2}` : m.status==="live" ? "LIVE" : "\u2014";

        const courtCell = admin
          ? `<select class="sched-sel" onchange="setScheduleCourt('${m.id}',this.value)">
               <option value="">\u2014</option>
               ${COURT_NAMES.map(c=>`<option value="${c}" ${court===c?"selected":""}>${c}</option>`).join("")}
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
    // Admin control bar (shown even when empty)
    const adminHistControls = admin ? `
      <div class="hist-admin-bar">
        <div class="hist-trim-group">
          <span class="hist-ctrl-label">Keep last</span>
          <input id="hist-keep-inp" class="hist-keep-inp" type="number" min="0"
            placeholder="e.g. 10" value="${Math.max(0, log.length - 10) > 0 ? 10 : log.length}"/>
          <span class="hist-ctrl-label">entries</span>
          <button class="btn btn-ghost btn-sm" onclick="trimHistory()">Trim</button>
        </div>
        <button class="btn btn-reset hist-clear-btn" onclick="clearAllHistory()"
          title="Clear all history" ${log.length===0?"disabled":""}>
          Clear All
        </button>
      </div>` : "";

    if (log.length === 0) {
      content = adminHistControls + `<div style="text-align:center;padding:60px 20px;color:var(--muted)">
        <div style="font-size:2.5rem;margin-bottom:12px">&#128203;</div>
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
        const icon  = isReset ? "<>" : isPool ? "&#127952;" : "&#127942;";
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
      content = adminHistControls + `
        <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <span class="tag">${log.length} event${log.length!==1?"s":""} . most recent first</span>
        </div>
        <div class="hist-list">${entries}</div>`;
    }
  }



  if (tab==="overview") {
    const rows = (state.daySchedule || []);

    const tableRows = rows.map((row, idx) => {
      const isFirst = idx === 0;
      const isLast  = idx === rows.length - 1;
      if (admin) {
        return `
          <tr class="ds-tr">
            <td class="ds-td ds-td-time">
              <input class="ds-inp ds-time-inp" value="${esc(row.time)}"
                placeholder="e.g. 2:00-2:30"
                oninput="updateDaySchedTime(${idx},this.value)"/>
            </td>
            <td class="ds-td ds-td-activity">
              <input class="ds-inp ds-act-inp" value="${row.activity}"
                placeholder="Activity description"
                oninput="updateDaySchedActivity(${idx},this.value)" />
            </td>
            <td class="ds-td ds-td-action">
              <div class="ds-row-actions">
                <button class="ds-move-btn" onclick="moveDaySchedRow(${idx},-1)"
                  ${isFirst?"disabled":""} title="Move up">&#9650;</button>
                <button class="ds-move-btn" onclick="moveDaySchedRow(${idx},1)"
                  ${isLast?"disabled":""} title="Move down">&#9660;</button>
                <button class="ds-del-btn" onclick="deleteDaySchedRow(${idx})" title="Remove">&#10005;</button>
              </div>
            </td>
          </tr>`;
      } else {
        return `
          <tr class="ds-tr">
            <td class="ds-td ds-td-time">${esc(row.time)}</td>
            <td class="ds-td ds-td-activity">${row.activity}</td>
          </tr>`;
      }
    }).join("");

    const thead = admin
      ? `<tr><th class="ds-th">Time</th><th class="ds-th">Activity</th><th class="ds-th" style="width:90px"></th></tr>`
      : `<tr><th class="ds-th">Time</th><th class="ds-th">Activity</th></tr>`;

    content = `
      <div class="ds-wrap">
        <div class="ds-header-row">
          <div>
            <div class="ds-title">Tournament Overview</div>
            <div class="ds-subtitle">${rows.length} activities</div>
          </div>
          ${admin ? `<div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" onclick="addDaySchedRow('top')">+ Add at Top</button>
            <button class="btn btn-ghost btn-sm" onclick="addDaySchedRow('bottom')">+ Add at Bottom</button>
            <button class="btn btn-save btn-sm" onclick="saveDaySchedule()">Save</button>
          </div>` : ""}
        </div>
        <table class="ds-table">
          <thead>${thead}</thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
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
  /* -- RULES TAB (animated SVG explainers) -- */
  if (tab==="rules") {
    content = rulesContent();
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
    if (isAdmin() && !state.pools && state.tab!=="setup" && state.tab!=="rules") state.tab = "setup";
    if (!isAdmin() && (state.tab==="inventory" || state.tab==="setup")) state.tab = "pools";
    root.innerHTML = renderTournament();
    // innerHTML replacement resets the tab strip's horizontal scroll; keep the
    // active tab visible (centered) so it doesn't vanish off-screen on mobile
    const tabsEl = root.querySelector(".tabs");
    const onTab = tabsEl && tabsEl.querySelector(".tab.on");
    if (onTab) {
      tabsEl.scrollLeft = Math.max(0, onTab.offsetLeft - (tabsEl.clientWidth - onTab.offsetWidth) / 2);
    }
  }
  // Re-attach pin modal if on landing
  if (state.pinError) {
    const err = document.getElementById("pin-error");
    if (err) err.style.display = "block";
  }
}

/* ==========================================================================
   RULES TAB - animated SVG explainers (CSBV 5.5 "Rules in Motion")
========================================================================== */
function rulesContent() {
  return `
  <div class="rules-wrap">
    <div class="rules-intro">
      <strong style="color:#C8F04A">CSBV 5.5 &bull; Rules in Motion.</strong>
      Each card below is an animated explainer of a core tournament rule.
      Share this page directly: <code>mmedabo.github.io/#rules</code>
    </div>
    <div class="rules-grid">

    <!-- 1. SERVICE -->
    <div class="rules-card">
    <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Serve from anywhere behind the back line, within the corner limits">
      <style>
        .r1-zone{animation:r1z 2.4s ease-in-out infinite}
        @keyframes r1z{0%,100%{opacity:.12}50%{opacity:.3}}
        .r1-a1{animation:r1g1 5s linear infinite}
        .r1-a2{animation:r1g2 5s linear infinite}
        .r1-a3{animation:r1g3 5s linear infinite}
        @keyframes r1g1{0%,6%{opacity:1}18%,82%{opacity:.2}94%,100%{opacity:1}}
        @keyframes r1g2{0%,13%{opacity:.2}25%{opacity:1}37%,63%{opacity:.2}75%{opacity:1}87%,100%{opacity:.2}}
        @keyframes r1g3{0%,38%{opacity:.2}50%{opacity:1}62%,100%{opacity:.2}}
      </style>
      <rect width="400" height="330" rx="14" fill="#0F4347"/>
      <text x="200" y="42" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="24" fill="#EFD9A0" letter-spacing="2">SERVICE</text>
      <rect x="90" y="70" width="220" height="160" fill="#156066" stroke="#F4E9C8" stroke-width="3" rx="2"/>
      <line x1="90" y1="150" x2="310" y2="150" stroke="#F4E9C8" stroke-width="4"/>
      <!-- serving zone: the area behind the back line, bounded by the corner limits -->
      <rect x="90" y="234" width="220" height="28" rx="6" fill="#EFD9A0" class="r1-zone"/>
      <line x1="90" y1="232" x2="90" y2="264" stroke="#EFD9A0" stroke-width="2.5" stroke-dasharray="4 4"/>
      <line x1="310" y1="232" x2="310" y2="264" stroke="#EFD9A0" stroke-width="2.5" stroke-dasharray="4 4"/>
      <circle cx="90" cy="230" r="6" fill="#EFD9A0"/>
      <circle cx="310" cy="230" r="6" fill="#EFD9A0"/>
      <!-- serve arrows light up as the ball slides past each spot -->
      <g class="r1-a1" stroke="#EFD9A0" fill="#EFD9A0">
        <path d="M105,236 L152,98" fill="none" stroke-width="2" stroke-dasharray="5 6"/>
        <polygon points="152,90 145,103 159,101" stroke="none"/>
      </g>
      <g class="r1-a2" stroke="#EFD9A0" fill="#EFD9A0">
        <path d="M200,236 L200,96" fill="none" stroke-width="2" stroke-dasharray="5 6"/>
        <polygon points="200,88 193,101 207,101" stroke="none"/>
      </g>
      <g class="r1-a3" stroke="#EFD9A0" fill="#EFD9A0">
        <path d="M295,236 L248,98" fill="none" stroke-width="2" stroke-dasharray="5 6"/>
        <polygon points="248,90 241,101 255,103" stroke="none"/>
      </g>
      <!-- served balls: fly over the net as the slider passes each launch spot -->
      <g opacity="0">
        <circle r="8" fill="#F4E9C8"/>
        <path d="M-8,0 Q0,-5 8,0 M-8,0 Q0,5 8,0 M0,-8 Q4,0 0,8" fill="none" stroke="#0F4347" stroke-width="1.3"/>
        <animate attributeName="opacity" calcMode="discrete" dur="5s" repeatCount="indefinite" keyTimes="0;0.15" values="1;0"/>
        <animateMotion dur="5s" repeatCount="indefinite" calcMode="linear" keyPoints="0;1;1" keyTimes="0;0.15;1" path="M105,238 L158,82"/>
      </g>
      <g opacity="0">
        <circle r="8" fill="#F4E9C8"/>
        <path d="M-8,0 Q0,-5 8,0 M-8,0 Q0,5 8,0 M0,-8 Q4,0 0,8" fill="none" stroke="#0F4347" stroke-width="1.3"/>
        <animate attributeName="opacity" calcMode="discrete" dur="5s" repeatCount="indefinite" keyTimes="0;0.25;0.4" values="0;1;0"/>
        <animateMotion dur="5s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1;1" keyTimes="0;0.25;0.4;1" path="M200,238 L200,80"/>
      </g>
      <g opacity="0">
        <circle r="8" fill="#F4E9C8"/>
        <path d="M-8,0 Q0,-5 8,0 M-8,0 Q0,5 8,0 M0,-8 Q4,0 0,8" fill="none" stroke="#0F4347" stroke-width="1.3"/>
        <animate attributeName="opacity" calcMode="discrete" dur="5s" repeatCount="indefinite" keyTimes="0;0.5;0.65" values="0;1;0"/>
        <animateMotion dur="5s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1;1" keyTimes="0;0.5;0.65;1" path="M295,238 L242,82"/>
      </g>
      <g><g>
        <circle r="11" fill="#E96B3C"/>
        <path d="M-11,0 Q0,-7 11,0 M-11,0 Q0,7 11,0 M0,-11 Q5,0 0,11" fill="none" stroke="#0F4347" stroke-width="1.6"/>
        <animateMotion dur="5s" repeatCount="indefinite" path="M102,248 L298,248 L102,248"/>
      </g></g>
      <text x="200" y="282" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-size="15" fill="#F4E9C8" letter-spacing="1">SERVE ANYWHERE BEHIND THE LINE</text>
      <text x="200" y="306" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" fill="#9CC3BD">Within the corner limits &mdash; left, right or in between</text>
    </svg>
    </div>

    <!-- 2. TOUCHES -->
    <div class="rules-card">
    <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Max 3 touches per side">
      <style>
        .r2-n{font-family:Oswald,Arial Narrow,sans-serif;font-weight:700;font-size:22px;fill:#EFD9A0;opacity:0;transform-origin:center;transform-box:fill-box}
        .r2-n1{animation:r2pop 3.3s infinite}
        .r2-n2{animation:r2pop 3.3s .7s infinite}
        .r2-n3{animation:r2pop 3.3s 1.4s infinite}
        @keyframes r2pop{0%{opacity:0;transform:scale(.3)}6%{opacity:1;transform:scale(1.25)}12%{transform:scale(1)}32%{opacity:1}45%,100%{opacity:0}}
      </style>
      <rect width="400" height="330" rx="14" fill="#0F4347"/>
      <text x="200" y="42" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="24" fill="#EFD9A0" letter-spacing="2">TOUCHES</text>
      <rect x="30" y="238" width="340" height="10" rx="5" fill="#E3CFA0"/>
      <line x1="300" y1="120" x2="300" y2="243" stroke="#F4E9C8" stroke-width="4"/>
      <rect x="288" y="120" width="24" height="34" fill="none" stroke="#F4E9C8" stroke-width="2"/>
      <line x1="288" y1="131" x2="312" y2="131" stroke="#F4E9C8" stroke-width="1.4"/>
      <line x1="288" y1="142" x2="312" y2="142" stroke="#F4E9C8" stroke-width="1.4"/>
      <g fill="#E96B3C"><circle cx="110" cy="206" r="11"/><path d="M98,238 Q110,214 122,238 Z"/></g>
      <g fill="#D88A52"><circle cx="195" cy="206" r="11"/><path d="M183,238 Q195,214 207,238 Z"/></g>
      <g>
        <circle r="10" fill="#F4E9C8"/>
        <path d="M-10,0 Q0,-6 10,0 M-10,0 Q0,6 10,0 M0,-10 Q4.5,0 0,10" fill="none" stroke="#0F4347" stroke-width="1.5"/>
        <animateMotion dur="3.3s" repeatCount="indefinite" path="M110,186 Q152,105 195,186 Q152,100 118,184 Q235,30 352,200"/>
      </g>
      <text class="r2-n r2-n1" x="96" y="158" text-anchor="middle">1</text>
      <text class="r2-n r2-n2" x="195" y="158" text-anchor="middle">2</text>
      <text class="r2-n r2-n3" x="132" y="142" text-anchor="middle">3</text>
      <text x="200" y="282" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-size="16" fill="#F4E9C8" letter-spacing="1">MAX 3 TOUCHES PER SIDE</text>
      <text x="200" y="306" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" fill="#9CC3BD">Block counts as 1 touch &bull; same player can play the 2nd</text>
    </svg>
    </div>

    <!-- 3. BALL IN / OUT -->
    <div class="rules-card">
    <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ball on the line is in">
      <style>
        .r3-ball{animation:r3drop 3s ease-in infinite;transform-origin:262px 196px;transform-box:view-box}
        @keyframes r3drop{0%{transform:translateY(-130px) scale(1.7)}38%{transform:translateY(0) scale(1)}46%{transform:translateY(-14px) scale(1.05)}54%{transform:translateY(0) scale(1)}100%{transform:translateY(0) scale(1)}}
        .r3-sh{animation:r3sh 3s ease-in infinite;transform-origin:262px 208px;transform-box:view-box}
        @keyframes r3sh{0%{transform:scale(.3);opacity:.15}38%{transform:scale(1);opacity:.4}100%{transform:scale(1);opacity:.4}}
        .r3-in{opacity:0;animation:r3in 3s infinite;transform-origin:262px 150px;transform-box:view-box}
        @keyframes r3in{0%,38%{opacity:0;transform:scale(.4)}46%{opacity:1;transform:scale(1.2)}54%{transform:scale(1)}88%{opacity:1}100%{opacity:0}}
      </style>
      <rect width="400" height="330" rx="14" fill="#0F4347"/>
      <text x="200" y="42" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="24" fill="#EFD9A0" letter-spacing="2">BALL IN / OUT</text>
      <rect x="60" y="80" width="202" height="148" fill="#156066"/>
      <rect x="60" y="80" width="202" height="148" fill="none" stroke="#F4E9C8" stroke-width="7"/>
      <text x="140" y="160" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="13" fill="#9CC3BD">COURT</text>
      <text x="322" y="160" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="13" fill="#9CC3BD">OUT</text>
      <ellipse class="r3-sh" cx="262" cy="208" rx="16" ry="6" fill="#000"/>
      <g class="r3-ball">
        <circle cx="262" cy="196" r="13" fill="#F4E9C8"/>
        <path d="M249,196 Q262,188 275,196 M249,196 Q262,204 275,196 M262,183 Q268,196 262,209" fill="none" stroke="#0F4347" stroke-width="1.7"/>
      </g>
      <g class="r3-in">
        <rect x="232" y="128" width="60" height="32" rx="16" fill="#7BC47F"/>
        <text x="262" y="151" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="19" fill="#0F4347">IN!</text>
      </g>
      <text x="200" y="282" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-size="16" fill="#F4E9C8" letter-spacing="1">ON THE LINE = IN</text>
      <text x="200" y="306" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" fill="#9CC3BD">Must cross over net, between imaginary antenna lines</text>
    </svg>
    </div>

    <!-- 4. SELF-REFEREED -->
    <div class="rules-card">
    <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Self refereed, make fair calls">
      <style>
        .r4-arm{animation:r4raise 3s ease-in-out infinite;transform-origin:200px 192px;transform-box:view-box}
        @keyframes r4raise{0%,15%{transform:rotate(58deg)}35%,75%{transform:rotate(0deg)}95%,100%{transform:rotate(58deg)}}
        .r4-check{stroke-dasharray:60;stroke-dashoffset:60;animation:r4chk 3s infinite}
        @keyframes r4chk{0%,35%{stroke-dashoffset:60}55%,80%{stroke-dashoffset:0;opacity:1}95%,100%{stroke-dashoffset:0;opacity:0}}
      </style>
      <rect width="400" height="330" rx="14" fill="#0F4347"/>
      <text x="200" y="42" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="24" fill="#EFD9A0" letter-spacing="2">SELF-REFEREED</text>
      <circle cx="200" cy="160" r="20" fill="#E96B3C"/>
      <path d="M170,250 Q200,178 230,250 Z" fill="#E96B3C"/>
      <g class="r4-arm">
        <line x1="200" y1="192" x2="258" y2="128" stroke="#E96B3C" stroke-width="11" stroke-linecap="round"/>
        <rect x="252" y="106" width="18" height="28" rx="8" fill="#F4E9C8" transform="rotate(20 261 120)"/>
      </g>
      <circle cx="298" cy="110" r="26" fill="none" stroke="#7BC47F" stroke-width="3" opacity=".9"/>
      <path class="r4-check" d="M286,110 L295,120 L312,98" fill="none" stroke="#7BC47F" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="200" y="282" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-size="16" fill="#F4E9C8" letter-spacing="1">MAKE FAIR CALLS</text>
      <text x="200" y="306" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" fill="#9CC3BD">No refs &mdash; sportsmanship is the whistle</text>
    </svg>
    </div>

    <!-- 5. REPLAY THE POINT -->
    <div class="rules-card">
    <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Disagreement? Replay the point">
      <style>
        .r5-spin{animation:r5sp 2.6s linear infinite;transform-origin:200px 165px;transform-box:view-box}
        @keyframes r5sp{to{transform:rotate(360deg)}}
        .r5-b1{animation:r5bub 2.6s infinite}
        .r5-b2{animation:r5bub 2.6s 1.3s infinite}
        @keyframes r5bub{0%,100%{opacity:.35}50%{opacity:1}}
      </style>
      <rect width="400" height="330" rx="14" fill="#0F4347"/>
      <text x="200" y="42" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="24" fill="#EFD9A0" letter-spacing="2">DISAGREE?</text>
      <g class="r5-b1">
        <rect x="56" y="90" width="56" height="42" rx="12" fill="#156066" stroke="#F4E9C8" stroke-width="2"/>
        <path d="M84,132 L78,146 L96,132 Z" fill="#156066" stroke="#F4E9C8" stroke-width="2"/>
        <text x="84" y="118" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="20" fill="#EFD9A0">IN</text>
      </g>
      <g class="r5-b2">
        <rect x="288" y="90" width="62" height="42" rx="12" fill="#156066" stroke="#F4E9C8" stroke-width="2"/>
        <path d="M316,132 L310,146 L328,132 Z" fill="#156066" stroke="#F4E9C8" stroke-width="2"/>
        <text x="319" y="118" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="20" fill="#E96B3C">OUT</text>
      </g>
      <circle cx="200" cy="165" r="22" fill="#F4E9C8"/>
      <path d="M178,165 Q200,152 222,165 M178,165 Q200,178 222,165 M200,143 Q210,165 200,187" fill="none" stroke="#0F4347" stroke-width="2"/>
      <g class="r5-spin">
        <path d="M200,121 A44,44 0 1 1 156,165" fill="none" stroke="#E96B3C" stroke-width="5" stroke-linecap="round"/>
        <path d="M148,150 L156,165 L168,153 Z" fill="#E96B3C"/>
      </g>
      <text x="200" y="244" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="20" fill="#7BC47F" letter-spacing="2">REPLAY THE POINT</text>
      <text x="200" y="282" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-size="16" fill="#F4E9C8" letter-spacing="1">KEEP IT FRIENDLY</text>
      <text x="200" y="306" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" fill="#9CC3BD">No arguments &mdash; just run it back</text>
    </svg>
    </div>

    <!-- 6. HIGH-FIVE -->
    <div class="rules-card">
    <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Shake hands or high five before and after matches">
      <style>
        .r6-l{animation:r6l 2.4s ease-in-out infinite}
        .r6-r{animation:r6r 2.4s ease-in-out infinite}
        @keyframes r6l{0%,15%{transform:translateX(-58px) rotate(-8deg)}45%,60%{transform:translateX(0) rotate(0)}90%,100%{transform:translateX(-58px) rotate(-8deg)}}
        @keyframes r6r{0%,15%{transform:translateX(58px) rotate(8deg)}45%,60%{transform:translateX(0) rotate(0)}90%,100%{transform:translateX(58px) rotate(8deg)}}
        .r6-burst{opacity:0;animation:r6b 2.4s infinite;transform-origin:200px 158px;transform-box:view-box}
        @keyframes r6b{0%,42%{opacity:0;transform:scale(.2)}50%{opacity:1;transform:scale(1.15)}68%{opacity:0;transform:scale(1.5)}100%{opacity:0}}
      </style>
      <rect width="400" height="330" rx="14" fill="#0F4347"/>
      <text x="200" y="42" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="22" fill="#EFD9A0" letter-spacing="2">KEEP UP GOOD VIBES</text>
      <g class="r6-l" style="transform-box:view-box;transform-origin:160px 170px">
        <line x1="70" y1="220" x2="172" y2="166" stroke="#E96B3C" stroke-width="14" stroke-linecap="round"/>
        <g fill="#F4E9C8">
          <rect x="162" y="138" width="26" height="40" rx="11"/>
          <rect x="164" y="124" width="6.5" height="22" rx="3"/>
          <rect x="172" y="120" width="6.5" height="24" rx="3"/>
          <rect x="180" y="124" width="6.5" height="22" rx="3"/>
        </g>
      </g>
      <g class="r6-r" style="transform-box:view-box;transform-origin:240px 170px">
        <line x1="330" y1="220" x2="228" y2="166" stroke="#156066" stroke-width="14" stroke-linecap="round"/>
        <g fill="#F4E9C8">
          <rect x="212" y="138" width="26" height="40" rx="11"/>
          <rect x="214" y="124" width="6.5" height="22" rx="3"/>
          <rect x="222" y="120" width="6.5" height="24" rx="3"/>
          <rect x="230" y="124" width="6.5" height="22" rx="3"/>
        </g>
      </g>
      <g class="r6-burst" stroke="#EFD9A0" stroke-width="4" stroke-linecap="round">
        <line x1="200" y1="108" x2="200" y2="88"/>
        <line x1="166" y1="120" x2="152" y2="106"/>
        <line x1="234" y1="120" x2="248" y2="106"/>
        <line x1="156" y1="158" x2="136" y2="158"/>
        <line x1="244" y1="158" x2="264" y2="158"/>
      </g>
      <text x="200" y="282" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-size="16" fill="#F4E9C8" letter-spacing="1">HIGH-FIVE BEFORE &amp; AFTER</text>
      <text x="200" y="306" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" fill="#9CC3BD">Handshakes work too</text>
    </svg>
    </div>

    <!-- 7. SWITCH SIDES -->
    <div class="rules-card">
    <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Switch sides every 5 or 7 points">
      <style>
        .r7-sun{animation:r7s 8s linear infinite;transform-origin:62px 96px;transform-box:view-box}
        @keyframes r7s{to{transform:rotate(360deg)}}
      </style>
      <rect width="400" height="330" rx="14" fill="#0F4347"/>
      <text x="200" y="42" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="24" fill="#EFD9A0" letter-spacing="2">SWITCH SIDES</text>
      <g class="r7-sun" stroke="#EFD9A0" stroke-width="3" stroke-linecap="round">
        <line x1="62" y1="72" x2="62" y2="62"/><line x1="62" y1="120" x2="62" y2="130"/>
        <line x1="38" y1="96" x2="28" y2="96"/><line x1="86" y1="96" x2="96" y2="96"/>
        <line x1="45" y1="79" x2="38" y2="72"/><line x1="79" y1="113" x2="86" y2="120"/>
        <line x1="79" y1="79" x2="86" y2="72"/><line x1="45" y1="113" x2="38" y2="120"/>
      </g>
      <circle cx="62" cy="96" r="14" fill="#E96B3C"/>
      <rect x="110" y="100" width="220" height="130" fill="#156066" stroke="#F4E9C8" stroke-width="3"/>
      <line x1="220" y1="100" x2="220" y2="230" stroke="#F4E9C8" stroke-width="4"/>
      <g>
        <circle r="10" fill="#E96B3C"/>
        <animateMotion dur="3.4s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;0.15;0.7;1" calcMode="linear" path="M160,150 C190,80 250,80 282,150"/>
      </g>
      <g>
        <circle r="10" fill="#F4E9C8"/>
        <animateMotion dur="3.4s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;0.15;0.7;1" calcMode="linear" path="M282,184 C250,254 190,254 160,184"/>
      </g>
      <text x="200" y="282" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-size="15" fill="#F4E9C8" letter-spacing="1">SWITCH AT TOTAL 10 (15-PT) &bull; TOTAL 15 (21-PT)</text>
      <text x="200" y="306" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" fill="#9CC3BD">Add both scores &mdash; e.g. 6&ndash;4 or 8&ndash;7 &rarr; swap ends for sun &amp; wind</text>
    </svg>
    </div>

    <!-- 8. NO OPEN-HAND TIP -->
    <div class="rules-card">
    <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="No open hand tipping, dunking or touching the net">
      <style>
        .r8-hand{animation:r8h 2.2s ease-in-out infinite;transform-box:view-box;transform-origin:185px 160px}
        @keyframes r8h{0%,100%{transform:translate(-14px,10px)}45%,60%{transform:translate(0,0)}}
        .r8-slash{stroke-dasharray:230;stroke-dashoffset:230;animation:r8s 2.2s infinite}
        @keyframes r8s{0%,40%{stroke-dashoffset:230}65%,95%{stroke-dashoffset:0}100%{stroke-dashoffset:0}}
        .r8-ring{animation:r8r 2.2s infinite}
        @keyframes r8r{0%,40%{opacity:.35}65%,95%{opacity:1}100%{opacity:.35}}
      </style>
      <rect width="400" height="330" rx="14" fill="#0F4347"/>
      <text x="200" y="42" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="24" fill="#E04444" letter-spacing="2">NO TIPS / DUNKS</text>
      <circle cx="238" cy="168" r="24" fill="#F4E9C8"/>
      <path d="M214,168 Q238,154 262,168 M214,168 Q238,182 262,168 M238,144 Q249,168 238,192" fill="none" stroke="#0F4347" stroke-width="2"/>
      <g class="r8-hand">
        <line x1="100" y1="240" x2="172" y2="186" stroke="#E96B3C" stroke-width="13" stroke-linecap="round"/>
        <g fill="#F4E9C8">
          <rect x="158" y="150" width="32" height="42" rx="12"/>
          <rect x="158" y="130" width="7" height="26" rx="3.5" transform="rotate(-18 161 143)"/>
          <rect x="168" y="126" width="7" height="30" rx="3.5" transform="rotate(-6 171 141)"/>
          <rect x="178" y="126" width="7" height="30" rx="3.5" transform="rotate(6 181 141)"/>
          <rect x="188" y="130" width="7" height="26" rx="3.5" transform="rotate(18 191 143)"/>
        </g>
      </g>
      <circle class="r8-ring" cx="205" cy="168" r="74" fill="none" stroke="#E04444" stroke-width="7"/>
      <line class="r8-slash" x1="152" y1="220" x2="258" y2="116" stroke="#E04444" stroke-width="7" stroke-linecap="round"/>
      <text x="200" y="282" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-size="16" fill="#F4E9C8" letter-spacing="1">NO OPEN-HAND TIP &bull; NO DUNK &bull; NO NET TOUCH</text>
      <text x="200" y="306" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" fill="#9CC3BD">Use knuckles, cobra or closed fist instead</text>
    </svg>
    </div>

    <!-- 9. NO BLOCK / SPIKE ON SERVE -->
    <div class="rules-card">
    <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="No blocking or spiking a serve">
      <style>
        .r9-blk{animation:r9b 3s ease-out infinite;transform-box:view-box;transform-origin:222px 150px}
        @keyframes r9b{0%,28%{transform:translateY(46px);opacity:0}38%,80%{transform:translateY(0);opacity:1}92%,100%{transform:translateY(46px);opacity:0}}
        .r9-x{opacity:0;animation:r9x 3s infinite;transform-origin:236px 118px;transform-box:view-box}
        @keyframes r9x{0%,40%{opacity:0;transform:scale(.3)}50%{opacity:1;transform:scale(1.25)}58%{transform:scale(1)}85%{opacity:1}100%{opacity:0}}
      </style>
      <rect width="400" height="330" rx="14" fill="#0F4347"/>
      <text x="200" y="42" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="24" fill="#E04444" letter-spacing="2">SERVE = HANDS OFF</text>
      <rect x="30" y="240" width="340" height="10" rx="5" fill="#E3CFA0"/>
      <line x1="220" y1="118" x2="220" y2="245" stroke="#F4E9C8" stroke-width="4"/>
      <line x1="206" y1="126" x2="234" y2="126" stroke="#F4E9C8" stroke-width="2"/>
      <line x1="206" y1="138" x2="234" y2="138" stroke="#F4E9C8" stroke-width="2"/>
      <path d="M70,210 Q160,70 340,200" fill="none" stroke="#EFD9A0" stroke-width="2" stroke-dasharray="5 6" opacity=".5"/>
      <g>
        <circle r="10" fill="#F4E9C8"/>
        <path d="M-10,0 Q0,-6 10,0 M-10,0 Q0,6 10,0 M0,-10 Q4.5,0 0,10" fill="none" stroke="#0F4347" stroke-width="1.5"/>
        <animateMotion dur="3s" repeatCount="indefinite" path="M70,210 Q160,70 340,200"/>
      </g>
      <g class="r9-blk" fill="#E96B3C">
        <rect x="228" y="138" width="15" height="40" rx="7"/>
        <rect x="247" y="142" width="15" height="40" rx="7"/>
      </g>
      <g class="r9-x" stroke="#E04444" stroke-width="8" stroke-linecap="round">
        <line x1="216" y1="98" x2="256" y2="138"/>
        <line x1="256" y1="98" x2="216" y2="138"/>
      </g>
      <text x="200" y="282" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-size="16" fill="#F4E9C8" letter-spacing="1">NO BLOCKING / SPIKING A SERVE</text>
      <text x="200" y="306" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" fill="#9CC3BD">Let the serve come down first</text>
    </svg>
    </div>

    <!-- 10. FINGER SET RULES -->
    <div class="rules-card">
    <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="No finger set on first and third touch, no set-over on second">
      <style>
        .r10-x1{opacity:0;animation:r10x 3.6s 0s infinite;transform-origin:106px 140px;transform-box:view-box}
        .r10-x3{opacity:0;animation:r10x 3.6s 1.2s infinite;transform-origin:294px 140px;transform-box:view-box}
        @keyframes r10x{0%,8%{opacity:0;transform:scale(.3)}16%{opacity:1;transform:scale(1.25)}22%{transform:scale(1)}88%{opacity:1}100%{opacity:0}}
        .r10-c2{opacity:0;animation:r10c 3.6s .6s infinite;transform-origin:200px 140px;transform-box:view-box}
        @keyframes r10c{0%,8%{opacity:0;transform:scale(.3)}16%{opacity:1;transform:scale(1.2)}22%{transform:scale(1)}88%{opacity:1}100%{opacity:0}}
      </style>
      <rect width="400" height="330" rx="14" fill="#0F4347"/>
      <text x="200" y="42" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="24" fill="#E04444" letter-spacing="2">FINGER SET RULES</text>
      <g font-family="Oswald,Arial Narrow,sans-serif" font-weight="700" font-size="17" fill="#EFD9A0" text-anchor="middle">
        <text x="106" y="212">1ST</text><text x="200" y="212">2ND</text><text x="294" y="212">3RD</text>
      </g>
      <g fill="#F4E9C8">
        <g transform="translate(106,140)">
          <circle r="14" fill="#F4E9C8"/><path d="M-14,0 Q0,-8 14,0 M-14,0 Q0,8 14,0" fill="none" stroke="#0F4347" stroke-width="1.6"/>
          <path d="M-18,24 L-8,12 M-12,26 L-4,14 M18,24 L8,12 M12,26 L4,14" stroke="#E96B3C" stroke-width="5" stroke-linecap="round"/>
        </g>
        <g transform="translate(200,140)">
          <circle r="14" fill="#F4E9C8"/><path d="M-14,0 Q0,-8 14,0 M-14,0 Q0,8 14,0" fill="none" stroke="#0F4347" stroke-width="1.6"/>
          <path d="M-18,24 L-8,12 M-12,26 L-4,14 M18,24 L8,12 M12,26 L4,14" stroke="#E96B3C" stroke-width="5" stroke-linecap="round"/>
        </g>
        <g transform="translate(294,140)">
          <circle r="14" fill="#F4E9C8"/><path d="M-14,0 Q0,-8 14,0 M-14,0 Q0,8 14,0" fill="none" stroke="#0F4347" stroke-width="1.6"/>
          <path d="M-18,24 L-8,12 M-12,26 L-4,14 M18,24 L8,12 M12,26 L4,14" stroke="#E96B3C" stroke-width="5" stroke-linecap="round"/>
        </g>
      </g>
      <g class="r10-x1" stroke="#E04444" stroke-width="7" stroke-linecap="round">
        <line x1="84" y1="118" x2="128" y2="162"/><line x1="128" y1="118" x2="84" y2="162"/>
      </g>
      <g class="r10-x3" stroke="#E04444" stroke-width="7" stroke-linecap="round">
        <line x1="272" y1="118" x2="316" y2="162"/><line x1="316" y1="118" x2="272" y2="162"/>
      </g>
      <g class="r10-c2">
        <path d="M186,142 L196,152 L216,128" fill="none" stroke="#7BC47F" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="200" y="184" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-weight="600" font-size="11" fill="#E04444">NO SET-OVER</text>
      </g>
      <text x="200" y="282" text-anchor="middle" font-family="Oswald,Arial Narrow,sans-serif" font-size="16" fill="#F4E9C8" letter-spacing="1">NO SET ON 1ST &amp; 3RD TOUCH</text>
      <text x="200" y="306" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" fill="#9CC3BD">Set OK on 2nd &mdash; but don't set it over the net</text>
    </svg>
    </div>

    </div>
  </div>`;
}

export { render, renderLanding, renderTournament };
