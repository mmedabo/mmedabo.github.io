import { state, isAdmin, syncToFirebase, syncTeamsData, syncSchedule,
         startFirebaseListener, isConfigured } from "./state.js";
import { render } from "./render.js";
import { startTournament, advanceToKnockout, toggleLive, resetPoolMatch,
         resetKOMatch, savePoolScore, saveKOScore } from "./actions.js";

/* ══════════════════════════════════════════════════════════════════════════
   GLOBAL HANDLERS
══════════════════════════════════════════════════════════════════════════ */
window.enterViewer = () => {
  state.role = "viewer";
  state.tab  = "pools";
  startFirebaseListener();
  render();
};

window.showPinModal = () => {
  // Remove any existing modal first
  document.getElementById("pin-modal")?.remove();
  // Inject modal directly into body so it works from any view
  const div = document.createElement("div");
  div.id = "pin-modal";
  div.className = "modal-overlay";
  div.style.display = "flex";
  div.onclick = (e) => { if (e.target.id === "pin-modal") window.closePinModal(); };
  div.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">🔐 Admin Access</div>
      <div class="modal-sub">Enter the admin PIN to continue</div>
      <input class="pin-inp" id="pin-input" type="password" inputmode="numeric"
        maxlength="8" placeholder="••••" onkeydown="if(event.key==='Enter')submitPin()"/>
      <div id="pin-error" class="pin-error" style="display:none">Incorrect PIN — try again</div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn btn-save" style="flex:1" onclick="submitPin()">Unlock</button>
        <button class="btn btn-cancel" style="flex:1" onclick="closePinModal()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  setTimeout(() => document.getElementById("pin-input")?.focus(), 80);
};

window.closePinModal = (e) => {
  if (e && e.target?.id !== "pin-modal") return;
  document.getElementById("pin-modal")?.remove();
  state.pinError = false;
};

window.submitPin = () => {
  const val = document.getElementById("pin-input")?.value || "";
  if (val === ADMIN_PIN) {
    document.getElementById("pin-modal")?.remove();
    state.role = "admin";
    state.tab  = state.pools ? "pools" : "setup";
    state.pinError = false;
    startFirebaseListener();
    render();
  } else {
    state.pinError = true;
    const err = document.getElementById("pin-error");
    const inp = document.getElementById("pin-input");
    if (err) err.style.display = "block";
    if (inp) { inp.value = ""; inp.focus(); }
  }
};

window.switchRole = (role) => {
  state.role = role;
  state.editingMatch = null;
  state.koEditing = null;
  render();
};

window.updateTeamName = (pi,ti,val)=>{
  state.teamNames[pi][ti]=val;
  // Also update pools.teams live if tournament already started
  if (state.pools?.teams?.[pi]) state.pools.teams[pi][ti] = val;
};
window.setMyTeam      = (pi,ti)=>{ state.myTeam={pool:pi,idx:ti}; render(); };
window.setTab         = (t)=>{ state.tab=t; render(); };
window.setScheduleCourt = (id, val) => { state.schedule[id] = {...(state.schedule[id]||{}), court:val}; syncSchedule(); render(); };
window.setScheduleTime  = (id, val) => { state.schedule[id] = {...(state.schedule[id]||{}), time:val};  syncSchedule(); render(); };

window.exportPNG = async () => {
  if (typeof html2canvas === "undefined") {
    alert("Export library not loaded yet — please try again in a moment.");
    return;
  }
  const btn = document.querySelector('[onclick="exportPNG()"]');
  if (btn) { btn.textContent = "⏳ Capturing…"; btn.disabled = true; }
  try {
    const canvas = await html2canvas(document.getElementById("root"), {
      backgroundColor: "#0C1A14",
      scale: 2,
      useCORS: true,
      ignoreElements: el => el.classList.contains("no-print"),
    });
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `csbv-tournament-${new Date().toISOString().slice(0,10)}.png`;
    a.click();
  } catch(e) {
    alert("Export failed: " + e.message);
  } finally {
    if (btn) { btn.textContent = "⬇ PNG"; btn.disabled = false; }
  }
};
window.startTournament   = startTournament;
window.advanceToKnockout = advanceToKnockout;
window.toggleLive        = (pi,id)=>toggleLive(pi,id);
window.resetPoolMatch    = (pi,id)=>resetPoolMatch(pi,id);
window.resetKOMatch      = (stage,id)=>resetKOMatch(stage,id);

window.confirmGenerate = () => {
  if (state.pools) {
    if (!confirm("This will reset ALL scores and matches. Team names will be kept. Continue?")) return;
  }
  startTournament();
};

window.updatePlayer = (pi, ti, playerIdx, val) => {
  if (!state.teamsData[pi]) state.teamsData[pi] = [];
  if (!state.teamsData[pi][ti]) state.teamsData[pi][ti] = { teamName: "", players: [] };
  if (!state.teamsData[pi][ti].players) state.teamsData[pi][ti].players = [];
  state.teamsData[pi][ti].players[playerIdx] = val;
};

window.updateTeamNameLive = (pi, ti, val) => {
  // Update teamNames (pre-tournament) and pools.teams (post-tournament) simultaneously
  state.teamNames[pi][ti] = val;
  if (state.teamsData[pi] && state.teamsData[pi][ti]) {
    state.teamsData[pi][ti].teamName = val;
  }
  if (state.pools && state.pools.teams[pi]) {
    state.pools.teams[pi][ti] = val;
    // Also update any KO match references to this team name
    const oldName = state.pools.teams[pi][ti]; // already updated above
    // KO names are stored as strings — they get set at advanceToKnockout time,
    // so we just update the live pools.teams reference here.
  }
};

window.saveTeamsData = () => {
  // Push all team name changes into pools.teams and sync everything
  if (state.pools) {
    state.teamsData.forEach((poolTeams, pi) => {
      poolTeams.forEach((team, ti) => {
        const name = team.teamName?.trim();
        if (name) {
          state.pools.teams[pi][ti] = name;
          state.teamNames[pi][ti] = name;
        }
      });
    });
    // Sync match data too so team name changes are reflected in pool standings
    syncToFirebase({ pools: state.pools, phase: state.phase });
  }
  syncTeamsData();
  const btn = document.querySelector('.btn-save.btn-lg');
  if (btn) { btn.textContent = "✓ Saved & Synced!"; setTimeout(()=>{ btn.textContent = "💾 Save Roster & Team Names"; },2000); }
};

window.startEdit = (pi,id,s1,s2)=>{
  state.editingMatch=id; state.editScores={s1,s2}; render();
  setTimeout(()=>document.getElementById(`s1_${id}`)?.focus(),50);
};
window.cancelEdit = ()=>{ state.editingMatch=null; render(); };

function validateBeachScore(s1, s2) {
  // Returns { ok: bool, error: str|null, warning: str|null }
  if (!Number.isInteger(s1)||!Number.isInteger(s2)||s1<0||s2<0)
    return { ok:false, error:"Please enter valid scores (0 or above)." };
  if (s1===s2)
    return { ok:false, error:"Scores can't be equal — no ties in beach volleyball!" };
  const hi = Math.max(s1,s2), lo = Math.min(s1,s2);
  const margin = hi - lo;
  if (margin < 2)
    return { ok:false, error:`Must win by at least 2 points (got ${hi}–${lo}).` };
  if (hi < 21)
    return { ok:false, error:`Winning score must be at least 21 (got ${hi}).` };
  // Soft warnings — legal but unusual
  if (lo > hi - 2 && hi > 21)
    return { ok:true, warning:null }; // win by 2 at 22+, perfectly fine
  if (hi > 30)
    return { ok:true, warning:`Score looks high (${hi}–${lo}). Save anyway?` };
  return { ok:true, warning:null };
}

window.submitPoolScore = (pi,id)=>{
  const el1 = document.getElementById(`s1_${id}`);
  const el2 = document.getElementById(`s2_${id}`);
  const s1 = (el1 && el1.value !== "") ? parseInt(el1.value, 10) : NaN;
  const s2 = (el2 && el2.value !== "") ? parseInt(el2.value, 10) : NaN;
  const v = validateBeachScore(s1, s2);
  if (!v.ok) { alert(v.error); return; }
  if (v.warning && !confirm(v.warning)) return;
  savePoolScore(parseInt(pi),id,s1,s2);
};

window.startKOEdit = (stage,id,s1,s2)=>{
  state.koEditing=id; state.koScores={s1,s2}; render();
  setTimeout(()=>document.getElementById(`ko_s1_${id}`)?.focus(),50);
};
window.cancelKOEdit = ()=>{ state.koEditing=null; render(); };
window.submitKOScore = (stage,id)=>{
  const el1 = document.getElementById(`ko_s1_${id}`);
  const el2 = document.getElementById(`ko_s2_${id}`);
  const s1 = (el1 && el1.value !== "") ? parseInt(el1.value, 10) : NaN;
  const s2 = (el2 && el2.value !== "") ? parseInt(el2.value, 10) : NaN;
  const v = validateBeachScore(s1, s2);
  if (!v.ok) { alert(v.error); return; }
  if (v.warning && !confirm(v.warning)) return;
  saveKOScore(stage,id,s1,s2);
};

/* boot */
if (isConfigured) {
  // Show a loading screen until Firebase responds, then render
  document.getElementById("root").innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:80vh;gap:16px;color:#5A7A5E;font-family:'Karla',sans-serif;">
      <div style="font-size:3rem">🏐</div>
      <div style="font-size:.85rem;letter-spacing:2px;text-transform:uppercase">Connecting to Firebase…</div>
    </div>`;
  startFirebaseListener();
} else {
  render();
}
