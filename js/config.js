import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

/* -------------------------------------------------------------------------
   FIREBASE CONFIG - already filled in
------------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyDeTTBUW3r5A7c554MwXntQ9zL2eg07CW4",
  authDomain: "csbv-tourn-2x2.firebaseapp.com",
  databaseURL: "https://csbv-tourn-2x2-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "csbv-tourn-2x2",
  storageBucket: "csbv-tourn-2x2.firebasestorage.app",
  messagingSenderId: "47312426218",
  appId: "1:47312426218:web:92d2bfa6a596a7de36f393",
  measurementId: "G-PZH8V5W74V"
};

/* -------------------------------------------------------------------------
   * SET YOUR ADMIN PIN HERE
------------------------------------------------------------------------- */
const ADMIN_PIN = "7890";   // <- change this to your own PIN

/* ==========================================================================
   CONSTANTS
========================================================================== */
const POOL_NAMES  = ["A","B","C","D"];
const POOL_COLORS = ["#C8F04A","#FF6B3D","#4DD9E8","#B57BFF"];
const DEFAULT_TEAMS = [
  ["Sand Sharks","Net Raiders","Spike Force","Block Party","Ace Squad"],
  ["Beach Kings","Wave Riders","Dig Deep","Set & Match","Sun Spikers"],
  ["Grit & Grin","High Flyers","Coast Crew","Serve Masters","Power Play"],
  ["Iron Nets","Tide Turners","Sand Storm","Shore Things","Volley Vipers"],
];

export { firebaseConfig, ADMIN_PIN, POOL_NAMES, POOL_COLORS, DEFAULT_TEAMS,
         initializeApp, getDatabase, ref, set, onValue };
