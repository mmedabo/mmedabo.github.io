import { state, isAdmin, syncToFirebase, syncTeamsData, syncSchedule, syncInventory,
         startFirebaseListener, isConfigured } from "./state.js";
import { ADMIN_PIN } from "./config.js";
import { render } from "./render.js";
import { startTournament, advanceToKnockout, toggleLive, resetPoolMatch,
         resetKOMatch, savePoolScore, saveKOScore } from "./actions.js";

// Register render for use by state.js Firebase listener
window.__render = render;

/* ==========================================================================
   GLOBAL HANDLERS
========================================================================== */
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
      <div class="modal-title">&#128272; Admin Access</div>
      <div class="modal-sub">Enter the admin PIN to continue</div>
      <input class="pin-inp" id="pin-input" type="password" inputmode="numeric"
        maxlength="8" placeholder="****" onkeydown="if(event.key==='Enter')submitPin()"/>
      <div id="pin-error" class="pin-error" style="display:none">Incorrect PIN - try again</div>
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
window.setTab         = (t)=>{ state.tab=t; render(); };
window.setScheduleCourt = (id, val) => { state.schedule[id] = {...(state.schedule[id]||{}), court:val}; syncSchedule(); render(); };
window.setScheduleTime  = (id, val) => { state.schedule[id] = {...(state.schedule[id]||{}), time:val};  syncSchedule(); render(); };

window.exportPNG = async () => {
  if (typeof html2canvas === "undefined") {
    alert("Export library not loaded yet - please try again in a moment.");
    return;
  }
  const btn = document.querySelector('[onclick="exportPNG()"]');
  if (btn) { btn.textContent = "&#9203; Capturing..."; btn.disabled = true; }
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
    if (btn) { btn.textContent = "&#11015; PNG"; btn.disabled = false; }
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
    // KO names are stored as strings - they get set at advanceToKnockout time,
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
  if (btn) { btn.textContent = "v Saved & Synced!"; setTimeout(()=>{ btn.textContent = "&#128190; Save Roster & Team Names"; },2000); }
};

window.startEdit = (pi,id,s1,s2)=>{
  state.editingMatch=id; state.editScores={s1,s2}; render();
  setTimeout(()=>document.getElementById(`s1_${id}`)?.focus(),50);
};
window.cancelEdit = ()=>{ state.editingMatch=null; render(); };

// Pool: first to 15, win by 2, deuce cap 18
// KO  : first to 21, win by 2, deuce cap 25
function validateScore(s1, s2, mode) {
  if (!Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0)
    return { ok:false, error:"Please enter valid scores (0 or above)." };

  const hi  = Math.max(s1, s2);
  const lo  = Math.min(s1, s2);
  const win = mode === "ko" ? 21 : 15;   // target score
  const cap = mode === "ko" ? 25 : 18;   // deuce cap

  // Both scores can't exceed the cap
  if (hi > cap)
    return { ok:false, error:"Max score is " + cap + " (deuce cap). Got " + hi + "." };

  // Winning score must reach the target
  if (hi < win)
    return { ok:false, error:"Winning score must be at least " + win + ". Got " + hi + "." };

  // If winner hasn't hit the cap, must win by 2
  if (hi < cap && (hi - lo) < 2)
    return { ok:false, error:"Must win by at least 2 points (got " + hi + "-" + lo + ")." };

  // At cap, loser must be cap-1 or cap-2 (deuce scenario)
  if (hi === cap && lo < cap - 2)
    return { ok:false, error:"At cap (" + cap + "), loser must be " + (cap-2) + " or " + (cap-1) + ". Got " + lo + "." };

  return { ok:true, error:null };
}

window.submitPoolScore = (pi,id)=>{
  const el1 = document.getElementById(`s1_${id}`);
  const el2 = document.getElementById(`s2_${id}`);
  const s1 = (el1 && el1.value !== "") ? parseInt(el1.value, 10) : NaN;
  const s2 = (el2 && el2.value !== "") ? parseInt(el2.value, 10) : NaN;
  const v = validateScore(s1, s2, 'pool');
  if (!v.ok) { alert(v.error); return; }
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
  const v = validateScore(s1, s2, 'ko');
  if (!v.ok) { alert(v.error); return; }
  saveKOScore(stage,id,s1,s2);
};


/* ==========================================================================
   INVENTORY HANDLERS
========================================================================== */
window.updateInvCategory  = (idx, val) => { state.inventory.equipment[idx].category = val; render(); };
window.updateInvEquipName = (idx, val) => {
  state.inventory.equipment[idx].name = val;
};
window.updateInvAssign = (idx, val) => {
  state.inventory.equipment[idx].assignedTo = val;
  // Don't re-render on every keystroke — only update state
};
window.toggleInvReturned = (idx, checked) => {
  state.inventory.equipment[idx].returned = checked;
  render();
};
window.addInvEquip = () => {
  const id = "eq" + Date.now();
  state.inventory.equipment.push({ id, name:"New Item", category:"other", assignedTo:"", returned:false, notes:"" });
  render();
};
window.updateDrinkName  = (idx, val) => { state.inventory.drinks[idx].name = val; };
window.updateDrinkNotes = (idx, val) => { state.inventory.drinks[idx].notes = val; };
window.updateDrinkUnit  = (idx, val) => { state.inventory.drinks[idx].unit  = val; };
window.adjustDrinkQty = (idx, delta) => {
  state.inventory.drinks[idx].qty = Math.max(0, (state.inventory.drinks[idx].qty||0) + delta);
  render();
};
window.setDrinkQty = (idx, val) => {
  const n = parseInt(val, 10);
  state.inventory.drinks[idx].qty = isNaN(n) || n < 0 ? 0 : n;
};
window.addDrink = () => {
  const id = "dr" + Date.now();
  state.inventory.drinks.push({ id, name:"New Drink", qty:0, unit:"units", notes:"" });
  render();
};
window.saveInventory = () => {
  syncInventory();
  const btn = document.querySelector('[onclick="saveInventory()"]');
  if (btn) { btn.textContent = "v Saved!"; setTimeout(()=>{ btn.textContent = "&#128190; Save Inventory"; }, 2000); }
};

/* boot */
if (isConfigured) {
  // Show a loading screen until Firebase responds, then render
  document.getElementById("root").innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:80vh;gap:16px;color:#5A7A5E;font-family:'Karla',sans-serif;">
      <div style="font-size:3rem">&#127952;</div>
      <div style="font-size:.85rem;letter-spacing:2px;text-transform:uppercase">Connecting to Firebase...</div>
    </div>`;
  startFirebaseListener();
} else {
  render();
}
