import { firebaseConfig, ADMIN_PIN, POOL_NAMES, POOL_COLORS, DEFAULT_TEAMS,
         initializeApp, getDatabase, ref, set, onValue } from "./config.js";

/* ==========================================================================
   FIREBASE
========================================================================== */
const isConfigured = firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY";
let db;
if (isConfigured) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
}

function syncToFirebase(data) { if (db) set(ref(db,"tournament"), data); }
function syncTeamsData() { if (db) set(ref(db,"teamsData"), state.teamsData); }
function syncSchedule()  { if (db) set(ref(db,"schedule"),  state.schedule); }
function syncInventory() { if (db) set(ref(db,"inventory"), state.inventory); }
function syncAuditLog() { if (db) set(ref(db,"auditLog"), state.auditLog); }

function addAuditEntry(entry) {
  state.auditLog = [{ ...entry, ts: Date.now() }, ...state.auditLog].slice(0, 200);
  syncAuditLog();
}

function startFirebaseListener() {
  if (!db) return;
  let tournamentLoaded = false;
  let teamsDataLoaded = false;

  function tryRender() {
    // Only render once both listeners have fired at least once
    if (tournamentLoaded && teamsDataLoaded) { if (typeof window.__render === 'function') window.__render(); }
  }

  onValue(ref(db,"tournament"), snap => {
    const data = snap.val();
    // Preserve mid-edit values
    if (state.editingMatch) {
      const v1 = document.getElementById(`s1_${state.editingMatch}`);
      const v2 = document.getElementById(`s2_${state.editingMatch}`);
      if (v1) state.editScores.s1 = v1.value;
      if (v2) state.editScores.s2 = v2.value;
    }
    if (state.koEditing) {
      const v1 = document.getElementById(`ko_s1_${state.koEditing}`);
      const v2 = document.getElementById(`ko_s2_${state.koEditing}`);
      if (v1) state.koScores.s1 = v1.value;
      if (v2) state.koScores.s2 = v2.value;
    }
    if (data) {
      state.pools = data.pools;
      state.phase = data.phase || "pool";
      // Sync teamNames from live pools.teams so setup tab shows correct names
      if (data.pools?.teams) {
        state.teamNames = data.pools.teams.map(p => [...p]);
      }
    }
    tournamentLoaded = true;
    tryRender();
  });

  onValue(ref(db,"schedule"), snap => {
    const data = snap.val();
    if (data) state.schedule = data;
  });

  onValue(ref(db,"auditLog"), snap => {
    const data = snap.val();
    if (data) state.auditLog = data;
  });

  onValue(ref(db,"inventory"), snap => {
    const data = snap.val();
    if (data) state.inventory = data;
  });

  onValue(ref(db,"teamsData"), snap => {
    const data = snap.val();
    if (data) {
      state.teamsData = data;
      // Also push saved team names back into pools.teams and teamNames
      data.forEach((poolTeams, pi) => {
        (poolTeams || []).forEach((team, ti) => {
          const name = team?.teamName?.trim();
          if (name) {
            state.teamNames[pi] = state.teamNames[pi] || [];
            state.teamNames[pi][ti] = name;
            if (state.pools?.teams?.[pi]) state.pools.teams[pi][ti] = name;
          }
        });
      });
    }
    teamsDataLoaded = true;
    tryRender();
  });
}

/* ==========================================================================
   STATE
========================================================================== */
let state = {
  // role: "landing" | "viewer" | "admin"
  role: "landing",
  pinInput: "",
  pinError: false,

  phase: "setup",
  tab: "pools",
  teamNames: DEFAULT_TEAMS.map(p=>[...p]),
  pools: null,
  editingMatch: null,
  editScores: { s1:"", s2:"" },
  koEditing: null,
  koScores: { s1:"", s2:"" },
  // teamsData: { pool: [ { teamName, players: [str] } ] }
  teamsData: POOL_NAMES.map((_,pi) =>
    DEFAULT_TEAMS[pi].map(name => ({ teamName: name, players: ["",""] }))
  ),
  editingTeamsData: false,
  schedule: {},
  auditLog: [],
  inventory: {
    equipment: [
      { id:"eq1", name:"Ball 1", category:"ball", assignedTo:"", returned:false, notes:"" },
      { id:"eq2", name:"Ball 2", category:"ball", assignedTo:"", returned:false, notes:"" },
      { id:"eq3", name:"Ball 3", category:"ball", assignedTo:"", returned:false, notes:"" },
      { id:"eq4", name:"Ball 4", category:"ball", assignedTo:"", returned:false, notes:"" },
      { id:"eq5", name:"Ball 5", category:"ball", assignedTo:"", returned:false, notes:"" },
      { id:"eq6", name:"Net 1",  category:"net",  assignedTo:"", returned:false, notes:"" },
      { id:"eq7", name:"Net 2",  category:"net",  assignedTo:"", returned:false, notes:"" },
      { id:"eq8", name:"Net 3",  category:"net",  assignedTo:"", returned:false, notes:"" },
      { id:"eq9", name:"Net 4",  category:"net",  assignedTo:"", returned:false, notes:"" },
    ],
    drinks: [
      { id:"dr1", name:"Water",        qty:0, unit:"bottles", notes:"" },
      { id:"dr2", name:"Sports Drink", qty:0, unit:"cans",    notes:"" },
      { id:"dr3", name:"Coconut Water", qty:0, unit:"bottles", notes:"" },
    ]
  },
};

const isAdmin = () => state.role === "admin";

export { state, isAdmin, isConfigured, db,
         syncToFirebase, syncTeamsData, syncSchedule, syncAuditLog, addAuditEntry,
         syncInventory, startFirebaseListener };
