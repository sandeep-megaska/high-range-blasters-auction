<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, viewport-fit=cover"
  />
  <title>HRB Auction Assist</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
    rel="stylesheet"
  />
  <link rel="stylesheet" href="./assets/styles.css" />
  <style>
    :root { --bg:#f7fafc; --card:#fff; --muted:#6b7280; --line:#e5e7eb; }
    body { margin:0; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:var(--bg); color:#0f172a; }
    .wrap { max-width:1200px; margin:0 auto; padding:18px; }
    h2,h3 { margin:0 0 10px; }
    .hint { color:var(--muted); font-size:12px; }
    .btn { padding:8px 12px; border-radius:8px; border:1px solid var(--line); background:#111827; color:#fff; cursor:pointer; }
    .btn[disabled] { opacity:.5; cursor:not-allowed; }
    .btn-ghost { background:#fff; color:#111827; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:12px; }
    input, textarea { width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--line); border-radius:8px; }
    label { font-size:12px; color:#111827; display:block; margin:6px 0; }
    .row { display:flex; gap:8px; align-items:center; }
    .topbar { display:flex; gap:18px; align-items:center; background:var(--card); border:1px solid var(--line); padding:10px 12px; border-radius:12px; }
    .topbar .stat { font-size:14px; }
    .topbar .right { margin-left:auto; display:flex; gap:8px; }
    .main-grid { display:grid; grid-template-columns: 1.1fr 1fr 1fr; gap:14px; margin-top:14px; }
    .players, .live, .squad { min-height:420px; }
    .players .list { max-height:520px; overflow:auto; }
    .typeahead { margin:8px 0 10px; position:relative; }
    .typeahead input { padding-right:10px; }
    #startResults { position:absolute; left:0; right:0; top:100%; z-index:5; background:#fff; border:1px solid var(--line); border-radius:8px; display:none; max-height:220px; overflow:auto; }
    #startResults .ta-item { padding:8px 10px; border-bottom:1px solid var(--line); cursor:pointer; }
    #startResults .ta-item:hover { background:#f3f4f6; }
    .clubs-grid { display:grid; grid-template-columns: repeat( auto-fit, minmax(260px, 1fr) ); gap:12px; }
    .footer-space { height:40px; }
    .divider { height:1px; background:var(--line); margin:10px 0; }
    /* Hide sections by default; JS will unhide */
    #settingsView, #appMain { display:none; }
    /* Minimal mini-row already formatted by JS inline styles */
  </style>
</head>
<body>
  <div class="wrap">

    <!-- LOGIN -->
    <section id="loginView" class="card" style="max-width:440px; margin:40px auto; padding:18px;">
      <div class="row" style="gap:10px; margin-bottom:8px;">
        <img src="./assets/highrange.svg" alt="HRB" style="width:36px;height:36px;">
        <h2>HRB Auction Assist — Login</h2>
      </div>
      <div class="row" style="gap:12px;">
        <label style="flex:1;">Username
          <input id="loginUser" placeholder="HRB" />
        </label>
        <label style="flex:1;">Password
          <input id="loginPass" type="password" placeholder="sandeep" />
        </label>
      </div>
      <div class="row" style="margin-top:10px;">
        <button id="btn-login" class="btn">Login</button>
        <div id="loginError" class="hint" style="margin-left:8px;"></div>
      </div>
    </section>

    <!-- SETTINGS (pre-auction) -->
    <section id="settingsView" class="card" style="padding:16px;">
      <h2>Pre-Bid Settings</h2>
      <div class="divider"></div>

      <div class="row" style="gap:14px; flex-wrap:wrap;">
        <label style="flex:1; min-width:180px;">Players cap
          <input id="cfgPlayersCap" type="number" value="15" />
        </label>
        <label style="flex:1; min-width:220px;">Total points (HRB)
          <input id="cfgTotalPoints" type="number" value="15000" />
        </label>
        <label style="flex:1; min-width:200px;">Guardrail min base per slot
          <input id="cfgGuardMin" type="number" value="250" />
        </label>
      </div>

      <h3 style="margin-top:14px;">Category base values (fallback if CSV lacks base)</h3>
      <div class="row" style="gap:10px; flex-wrap:wrap;">
        <label style="width:120px;">Cat 1 <input id="cfgBaseC1" type="number" placeholder="e.g. 1200" /></label>
        <label style="width:120px;">Cat 2 <input id="cfgBaseC2" type="number" /></label>
        <label style="width:120px;">Cat 3 <input id="cfgBaseC3" type="number" /></label>
        <label style="width:120px;">Cat 4 <input id="cfgBaseC4" type="number" /></label>
        <label style="width:120px;">Cat 5 <input id="cfgBaseC5" type="number" /></label>
      </div>

      <h3 style="margin-top:14px;">HRB Pre-selected player(s)</h3>
      <div class="row" style="gap:10px; flex-wrap:wrap;">
        <label style="flex:2; min-width:240px;">Names and prices (e.g. <i>Name1=1200; Name2=900</i>)
          <input id="cfgPreName" placeholder="John WK=1200; Anil LHB=900" />
        </label>
        <label style="flex:1; min-width:160px;">Single bid (used only if above has one name without “=price”)
          <input id="cfgPreBid" type="number" placeholder="900" />
        </label>
        <div class="row" style="align-items:flex-end;">
          <div class="hint">Available after preselected: <b id="cfgAvailableScore">15000</b></div>
        </div>
      </div>

      <h3 style="margin-top:14px;">Import players (CSV)</h3>
      <div class="row" style="gap:10px; flex-wrap:wrap;">
        <label style="flex:2; min-width:260px;">CSV URL (published to web; output=csv)
          <input id="csvUrl" placeholder="https://docs.google.com/spreadsheets/.../pub?output=csv" />
        </label>
        <div class="row" style="gap:8px; align-items:flex-end;">
          <button id="btn-fetch" class="btn">Fetch</button>
          <button id="btn-clear-url" class="btn btn-ghost">Clear</button>
        </div>
      </div>
      <label style="margin-top:8px;">Or paste CSV here
        <textarea id="csvPaste" rows="6" placeholder="name,alumni,phone,role,batting hand,wk,category,base..."></textarea>
      </label>
      <div class="row" style="margin-top:8px;">
        <button id="btn-import" class="btn">Import Players</button>
        <button id="btn-clear-paste" class="btn btn-ghost">Clear Paste</button>
        <div id="importMsg" class="hint" style="margin-left:8px;"></div>
      </div>

      <h3 style="margin-top:18px;">Add other clubs (do this before the auction)</h3>
      <div class="row" style="gap:10px; flex-wrap:wrap;">
        <label style="flex:1; min-width:200px;">Club name
          <input id="clubName" placeholder="E.g. Thunder Hawks" />
        </label>
        <label style="flex:1; min-width:220px;">Logo URL
          <input id="clubLogo" placeholder="https://..." />
        </label>
        <label style="flex:1; min-width:160px;">Starting budget
          <input id="clubBudget" type="number" placeholder="15000" />
        </label>
        <button id="btnCreateClub" class="btn" style="align-self:flex-end;">Add Club</button>
      </div>
      <div id="clubCreateMsg" class="hint" style="margin-top:4px;"></div>

      <div class="divider"></div>
      <div class="row" style="margin-top:8px;">
        <button id="btn-save-settings" class="btn">Save & Go to Auction</button>
        <div id="settingsError" class="hint" style="margin-left:8px;"></div>
      </div>
    </section>

    <!-- APP (auction) -->
    <section id="appMain">
      <!-- Top bar with stats + quick actions -->
      <div class="topbar">
        <div class="stat">Remaining Points: <b id="remainingPoints">0</b></div>
        <div class="stat">Remaining Slots: <b id="remainingSlots">0</b></div>
        <div class="stat" id="guardrail">Guardrail (min per slot): <b>250</b></div>
        <div class="right">
          <button id="btn-export" class="btn btn-ghost">Export Won (CSV)</button>
          <button id="btn-logout" class="btn btn-ghost">Logout</button>
        </div>
      </div>

      <!-- Compliance -->
      <div id="complianceBar" class="row" style="margin:10px 0 0;"></div>

      <!-- Main 3-column layout -->
      <div class="main-grid">
        <!-- LEFT: Players & search -->
        <div class="players card" style="padding:12px;">
          <h3>Players <span id="playersCount" class="hint">(0)</span></h3>
          <div class="typeahead">
            <label>Find player by name (as announced on TV)</label>
            <input id="startName" placeholder="Start typing a name…" autocomplete="off" />
            <div id="startResults"></div>
          </div>
          <div class="row" style="gap:8px;">
            <label style="flex:1;">Seed / Base Value (from CSV or category)
              <input id="seedBase" disabled placeholder="auto" />
            </label>
            <button id="btn-start-bid" class="btn" style="align-self:flex-end;">Set Active</button>
          </div>
          <div class="divider"></div>
          <div id="playersList" class="list"></div>
        </div>

        <!-- MIDDLE: Live Bid -->
        <div class="live card" style="padding:12px;">
          <h3>Live Bid</h3>
          <div id="liveBid" style="margin-top:8px;"></div>

          <!-- Pass / assign to other club -->
          <div id="passPanel" class="card" style="margin-top:12px; padding:12px; display:none;">
            <div class="row" style="justify-content:space-between;">
              <div><b>Assign to another club</b></div>
            </div>
            <div class="row" style="gap:10px; flex-wrap:wrap; margin-top:8px;">
              <label style="flex:2; min-width:220px;">Club
                <input id="passClubInput" list="clubNames" placeholder="Type or pick a club…" />
                <datalist id="clubNames"></datalist>
              </label>
              <label style="flex:1; min-width:140px;">Final Bid
                <input id="passBidAmount" type="number" placeholder="900" />
              </label>
              <button id="btn-assign-to-club" class="btn" style="align-self:flex-end;">Assign</button>
            </div>
            <div id="passPanelMsg" class="hint" style="margin-top:6px;"></div>
          </div>
        </div>

        <!-- RIGHT: HRB Squad (replaces old Auction Controls) -->
        <div class="squad card" style="padding:12px;">
          <h3>HRB Selected Squad</h3>
          <div id="selectedList" style="margin-top:6px;"></div>
        </div>
      </div>

      <!-- OTHER CLUBS -->
      <div style="margin-top:14px;">
        <h3>Other Clubs</h3>
        <div id="otherClubsPanel" class="clubs-grid"></div>
      </div>

      <div class="footer-space"></div>
    </section>
  </div>

  <!-- Optional (only if you use Supabase env): -->
  <script src="./assets/supabaseClient.js"></script>
  <!-- Your app -->
  <script src="./assets/app.js"></script>
</body>
</html>
