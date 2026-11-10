/* main.js */

(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  /* tiny stroke-svg symbols used instead of emoji/checkmarks in the UI */
  const ICON = {
    check: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.5 3.5L13 4.5"/></svg>',
    x: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  };

  function show(id) {
    $$(".screen").forEach((el) => el.classList.remove("active"));
    $(id).classList.add("active");
  }

  const app = {
    mode: null, // 'ai' | 'host' | 'guest'
    name: "Player",
    players: [],   // {id, name, team, isYou, isCaptain}
    youId: null,
    state: null,
    mySalt: null,
    myPick: null,
    humanHistory: [],
    botHistory: [],
    turnLock: false,
    ballHistory: [],
    // local order drafts (toss / break)
    draftBat: [],
    draftBowl: [],
    draftBreak: [],
    coinAnimated: false,
  };

  /* ---------- audio juice ---------- */
  let AC = null;
  function beep(freq, dur = 0.08, type = "square", vol = 0.04) {
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === "suspended") AC.resume();
      const o = AC.createOscillator();
      const g = AC.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
      o.connect(g).connect(AC.destination);
      o.start();
      o.stop(AC.currentTime + dur);
    } catch {}
  }
  const sfx = {
    pick: () => beep(520, 0.06, "triangle", 0.05),
    run: () => { beep(660, 0.07, "square", 0.04); setTimeout(() => beep(880, 0.09, "square", 0.04), 70); },
    out: () => { beep(180, 0.2, "sawtooth", 0.05); setTimeout(() => beep(120, 0.3, "sawtooth", 0.05), 120); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.15, "triangle", 0.05), i * 120)),
    lose: () => [400, 300, 200].forEach((f, i) => setTimeout(() => beep(f, 0.18, "sawtooth", 0.04), i * 140)),
    click: () => beep(400, 0.04, "triangle", 0.03),
    coin: () => beep(980, 0.05, "square", 0.04),
  };

  /* ---------- helpers ---------- */
  function playerName(id) {
    return app.players.find((p) => p.id === id)?.name || "?";
  }
  function playerTeam(id) {
    return app.players.find((p) => p.id === id)?.team;
  }
  function myPlayer() {
    return app.players.find((p) => p.isYou || p.id === app.youId);
  }
  function myTeam() {
    return myPlayer()?.team;
  }
  function captainId(team) {
    if (app.state?.captains) return app.state.captains[team];
    return app.players.find((p) => p.team === team && p.isCaptain)?.id;
  }
  function amCaptainOf(team) {
    const me = myPlayer();
    return !!me && me.team === team && captainId(team) === me.id;
  }
  function amCaptain() {
    const t = myTeam();
    return t ? amCaptainOf(t) : false;
  }
  function serializeState(s) {
    return JSON.parse(JSON.stringify(s));
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function renderHands() {
    $("#hero-hand").innerHTML = Hands.svg(5, { size: 120 });
    $$(".num-btn").forEach((btn) => {
      const n = +btn.dataset.n;
      btn.innerHTML = Hands.mini(n) + `<span class="num-label">${n}</span>`;
    });
  }

  function renderScoreboard() {
    const s = app.state;
    if (!s) return;
    for (const t of ["A", "B"]) {
      const st = s.teams[t];
      $(`#runs-${t}`).textContent = st.runs;
      $(`#overs-${t}`).textContent = `${Game.ballsToOvers(st.balls)} ov`;
      let tal = "";
      for (let i = 0; i < Math.min(st.wickets, Game.WICKETS); i++) {
        tal += `<span class="stroke"></span>`;
      }
      $(`#tally-${t}`).innerHTML = tal || '<span class="none">—</span>';
    }
    $("#innings-label").textContent =
      s.phase === "break" ? "innings break"
      : s.innings === 1 ? "1st innings"
      : "2nd innings";
    if (s.target) {
      $("#chase-label").textContent = `target ${s.target} · need ${Math.max(0, s.target - s.teams[s.batting].runs)}`;
    } else {
      $("#chase-label").textContent = "";
    }
  }

  function renderLog() {
    const hist = app.ballHistory || [];
    $("#ball-log").innerHTML = hist.length
      ? hist.slice().reverse().map((h) => {
          const cls = h.out ? "bad" : "ok";
          const txt = h.out ? "OUT" : `${h.runs} run${h.runs === 1 ? "" : "s"}`;
          return `<div class="log-line"><span class="log-ball">#${h.n}</span> <span class="${cls}">${txt}</span> <span class="log-detail">${h.bat} vs ${h.bowl}</span></div>`;
        }).join("")
      : `<div class="log-line muted">no balls yet — pick a number</div>`;
  }

  function setPickUI(status, enabled) {
    $("#pick-status").textContent = status;
    $$(".num-btn").forEach((b) => {
      b.disabled = !enabled;
      b.classList.toggle("picked", false);
    });
  }

  function showHands(youCount, themCount) {
    $("#hand-you").innerHTML = youCount ? Hands.svg(youCount, { size: 130 }) : "";
    $("#hand-them").innerHTML = themCount ? Hands.svg(themCount, { size: 130 }) : "";
    $("#pick-you").textContent = youCount ?? "?";
    $("#pick-them").textContent = themCount ?? "?";
  }

  function resetArena() {
    $("#hand-you").innerHTML = "";
    $("#hand-them").innerHTML = "";
    $("#pick-you").textContent = "?";
    $("#pick-them").textContent = "?";
    $("#result-burst").classList.add("hidden");
    $("#result-burst").className = "result-burst hidden";
    $("#vs-mark").classList.remove("hidden");
    $("#arena").classList.remove("shake");
  }

  function burst(text, kind) {
    const el = $("#result-burst");
    el.textContent = text;
    el.className = `result-burst show ${kind}`;
    $("#vs-mark").classList.add("hidden");
    if (kind === "out") {
      $("#arena").classList.add("shake");
      sfx.out();
      setTimeout(() => $("#arena").classList.remove("shake"), 400);
    } else {
      sfx.run();
    }
  }

  function hideGamePanels() {
    $("#bowler-panel").classList.add("hidden");
    $("#break-panel").classList.add("hidden");
  }

   // ai match //
   
  async function startAIMatch() {
    app.mode = "ai";
    app.youId = "you";
    app.players = [
      { id: "you", name: app.name || "You", team: "A", isYou: true, isCaptain: true },
      { id: "bot", name: "Computer", team: "B", isYou: false, isCaptain: true },
    ];
    app.ballHistory = [];
    app.humanHistory = [];
    app.botHistory = [];
    hideGamePanels();

    setPickUI("tossing…", false);
    show("#screen-game");
    $("#you-name").textContent = app.players[0].name;
    $("#them-name").textContent = app.players[1].name;
    resetArena();
    $("#ball-log").innerHTML = `<div class="log-line muted">tossing the coin…</div>`;

    await delay(700);
    sfx.coin();
    const tossWinner = Math.random() < 0.5 ? "you" : "bot";
    app.state = Game.startMatch({ players: app.players, tossWinnerId: tossWinner });
    renderScoreboard();
    renderLog();
    const batName = playerName(tossWinner);
    $("#ball-log").innerHTML = `<div class="log-line"><span class="ok">${batName} won the toss and bats</span></div>`;
    await delay(900);
    nextTurnAI();
  }

  async function nextTurnAI() {
    const s = app.state;
    if (s.phase === "break") {
      setPickUI("", false);
      $("#ball-log").innerHTML = `<div class="log-line"><span class="ok">innings break — chasing ${s.target}</span></div>`;
      await delay(1200);
      Game.startInnings2(s);
      renderScoreboard();
      resetArena();
    }
    if (s.phase === "done") {
      return showResultAI();
    }

    const batId = Game.currentBatter(s, app.players)?.id;
    const bowlId = Game.currentBowler(s, app.players)?.id;
    const youBat = batId === "you";
    const youBowl = bowlId === "you";

    resetArena();
    if (youBat) {
      $("#you-name").textContent = `${app.name} batting`;
      $("#them-name").textContent = "Computer bowling";
    } else {
      $("#you-name").textContent = `${app.name} bowling`;
      $("#them-name").textContent = "Computer batting";
    }

    app.turnLock = true;
    setPickUI(
      youBat ? "you're batting — pick a number" : "you're bowling — pick a number",
      true
    );

    let humanPick = null;
    if (youBat || youBowl) {
      humanPick = await waitForHumanPick();
    }

    await delay(youBat || youBowl ? 350 : 600);
    let botPick;
    if (youBat) {
      botPick = Game.makeBot(app.humanHistory);
      app.humanHistory.push(humanPick);
    } else {
      const recent = app.humanHistory.slice(-2);
      botPick = 1 + Math.floor(Math.random() * 6);
      if (recent.includes(botPick) && Math.random() < 0.5) {
        botPick = (botPick % 6) + 1;
      }
      app.humanHistory.push(humanPick);
    }

    const leftPick = humanPick;
    const rightPick = botPick;
    const batPick = youBat ? humanPick : botPick;
    const bowlPick = youBat ? botPick : humanPick;

    setPickUI("revealing…", false);
    $("#pick-you").textContent = "…";
    $("#pick-them").textContent = "…";

    await delay(400);
    showHands(leftPick, rightPick);

    await delay(500);

    const batterId = Game.currentBatter(s, app.players).id;
    const bowlerId = Game.currentBowler(s, app.players).id;
    s.commits = {};
    s.reveals = {};
    s.reveals[batterId] = { pick: batPick, salt: "ai-b" };
    s.reveals[bowlerId] = { pick: bowlPick, salt: "ai-w" };
    s.commits[batterId] = await Game.makeCommit(batPick, "ai-b");
    s.commits[bowlerId] = await Game.makeCommit(bowlPick, "ai-w");

    const res = await Game.resolveBall(s, app.players);
    if (!res || res.error) {
      $("#ball-log").innerHTML = `<div class="log-line bad">something broke — refresh?</div>`;
      return;
    }

    const lb = s.lastBall;
    app.ballHistory.push({ n: s.ballNo, bat: lb.bat, bowl: lb.bowl, runs: lb.runs, out: lb.out });
    renderScoreboard();
    renderLog();

    if (lb.out) burst("OUT!", "out");
    else burst(`+${lb.runs}`, "runs");

    await delay(lb.out ? 1100 : 900);
    app.turnLock = false;

    if (s.phase === "break") return nextTurnAI();
    if (s.phase === "done") return showResultAI();
    nextTurnAI();
  }

  function waitForHumanPick() {
    return new Promise((resolve) => {
      app._resolvePick = resolve;
    });
  }

  function showResultAI() {
    const s = app.state;
    const yourTeam = playerTeam("you");
    const a = s.teams.A.runs;
    const b = s.teams.B.runs;
    const tie = a === b;
    const youWon = (yourTeam === "A" && a > b) || (yourTeam === "B" && b > a);
    showResultScreen({
      tie,
      youWon,
      title: tie ? "tie!" : youWon ? "you win!" : "you lose",
      stamp: tie ? "TIE" : youWon ? "WIN" : "LOSE",
      line: `Team A ${a} — Team B ${b}`,
      detail: `${Game.BALLS} balls · ${Game.WICKETS} wickets · ${Game.OVERS} overs`,
    });
  }

  // lobby //


  function renderLobby() {
    const box = $("#lobby-players");
    const myT = myTeam();
    box.innerHTML = app.players
      .map((p) => {
        const tag = p.team
          ? `<span class="team-tag tag-${p.team.toLowerCase()}">${p.team}</span>`
          : `<span class="muted">pick a team</span>`;
        const crown = p.isCaptain ? `<span class="captain-badge">captain</span>` : "";
        const you = p.isYou ? " (you)" : "";
        const canElect = p.team && !p.isCaptain && myT && p.team === myT;
        const elect = canElect
          ? `<button class="btn captain-btn" data-elect="${escapeHtml(p.id)}">make captain</button>`
          : "";
        return `<div class="lobby-p">
          <span class="lobby-name">${escapeHtml(p.name)}${you}${crown}</span>
          <span class="side">${elect}${tag}</span>
        </div>`;
      })
      .join("");

    box.querySelectorAll("[data-elect]").forEach((btn) => {
      btn.onclick = () => {
        sfx.click();
        electCaptain(btn.dataset.elect);
      };
    });

    const a = app.players.filter((p) => p.team === "A").length;
    const b = app.players.filter((p) => p.team === "B").length;
    const ok = a >= 1 && b >= 1;
    const capsOk = ["A", "B"].every((t) => app.players.some((p) => p.team === t && p.isCaptain));
    $("#btn-start").disabled = !(ok && capsOk);
    $("#lobby-hint").textContent = !ok
      ? "need at least 1 player per team"
      : !capsOk
      ? "each team needs a captain"
      : `${a} vs ${b} — captains ready, start the toss!`;
  }

  function electCaptain(playerId) {
    const target = app.players.find((p) => p.id === playerId);
    if (!target?.team) return;
    const me = myPlayer();
    // only your own team's members, and only if you're on that team
    if (!me || me.team !== target.team) return;
    if (Net.role === "host") {
      applyElect(playerId);
      broadcastLobby();
    } else {
      Net.sendToHost({ t: "elect", id: playerId });
    }
  }

  function applyElect(playerId) {
    const target = app.players.find((p) => p.id === playerId);
    if (!target?.team) return;
    app.players.forEach((p) => {
      if (p.team === target.team) p.isCaptain = p.id === playerId;
    });
    if (app.state) app.state.captains[target.team] = playerId;
    renderLobby();
  }

  function ensureCaptains() {
    for (const t of ["A", "B"]) {
      const team = app.players.filter((p) => p.team === t);
      if (team.length && !team.some((p) => p.isCaptain)) {
        team[0].isCaptain = true;
      }
    }
  }

  /* shared team-join logic: auto-captain first member, hand over crown on leave */
  function assignTeam(player, team) {
    const oldTeam = player.team;
    player.team = team;
    const mates = app.players.filter((p) => p.team === team);
    if (mates.length === 1) player.isCaptain = true;
    if (oldTeam && oldTeam !== team && captainId(oldTeam) === player.id) {
      player.isCaptain = false;
      const oldMates = app.players.filter((p) => p.team === oldTeam);
      if (oldMates.length) oldMates[0].isCaptain = true;
    }
    if (app.state) {
      for (const t of ["A", "B"]) {
        app.state.captains[t] = app.players.find((p) => p.team === t && p.isCaptain)?.id || null;
      }
    }
  }

  function lobbySnapshot() {
    return app.players.map((p) => ({
      id: p.id, name: p.name, team: p.team, isCaptain: !!p.isCaptain,
    }));
  }

  function broadcastLobby() {
    Net.broadcast({ t: "lobby", players: lobbySnapshot(), room: Net.roomCode });
  }

  // toss flow //


  function beginToss() {
    const a = app.players.filter((p) => p.team === "A");
    const b = app.players.filter((p) => p.team === "B");
    if (!a.length || !b.length) return;
    ensureCaptains();

    app.state = Game.defaultState();
    app.state.phase = "toss";
    app.state.captains = {
      A: app.players.find((p) => p.team === "A" && p.isCaptain)?.id || a[0].id,
      B: app.players.find((p) => p.team === "B" && p.isCaptain)?.id || b[0].id,
    };
    app.players.forEach((p) => {
      p.isCaptain = app.state.captains[p.team] === p.id;
    });
    app.ballHistory = [];
    app.coinAnimated = false;
    app.coinLanded = false;
    app.ordersSent = false;
    app.breakDraftInit = false;
    app.draftBat = [];
    app.draftBowl = [];

    Net.broadcast({ t: "toss", players: lobbySnapshot(), state: serializeState(app.state) });
    renderToss();
  }

  function renderToss() {
    const s = app.state;
    if (!s || s.phase !== "toss") return;
    show("#screen-toss");
    const step = s.toss.step;
    const callStep = step === "call" || step === "flip";
    const stepOrder = ["call", "choice", "orders"];
    const activeIdx = stepOrder.indexOf(step);

    // step indicator
    $$("#toss-steps .step").forEach((el) => {
      const i = stepOrder.indexOf(el.dataset.step);
      el.classList.toggle("active", i === activeIdx);
      el.classList.toggle("done", i < activeIdx);
    });

    $("#toss-call-panel").classList.toggle("hidden", !callStep);
    $("#toss-choice-panel").classList.toggle("hidden", step !== "choice");
    $("#toss-orders-panel").classList.toggle("hidden", step !== "orders");
    $("#toss-wait-panel").classList.add("hidden");

    // ----- call step -----
    if (callStep) {
      $("#toss-call-msg").textContent =
        s.toss.msg ||
        (step === "call"
          ? "captains: pick heads or tails. your pick stays hidden until both captains have chosen."
          : "both captains called it — flipping the coin…");
      for (const t of ["A", "B"]) {
        const capId = s.captains[t];
        const capName = capId ? playerName(capId) : "…";
        $(`#caller-cap-${t}`).textContent = capName;
        const call = t === "A" ? s.toss.callA : s.toss.callB;
        const mine = amCaptainOf(t);
        const btns = $(`#caller-btns-${t}`);
        $(`#caller-${t}`).classList.toggle("mine", mine);
        btns.querySelectorAll(".call-btn").forEach((b) => {
          b.disabled = !mine || !!call || step !== "call";
        });
        const st = $(`#caller-status-${t}`);
        if (step === "flip") {
          st.innerHTML = call ? `${call === "H" ? "heads" : "tails"} — locked in` : "";
          st.classList.add("locked");
        } else if (call) {
          st.innerHTML = `locked in ${ICON.check}`;
          st.classList.add("locked");
        } else {
          st.textContent = mine ? "your call — pick one" : "waiting for the captain…";
          st.classList.remove("locked");
        }
      }

      // coin: "?" spins & jumps, then the face lands
      const coin = $("#toss-coin");
      const jump = $("#coin-jump");
      if (step === "flip") {
        if (!app.coinAnimated) {
          app.coinAnimated = true;
          app.coinLanded = false;
          coin.textContent = "?";
          coin.classList.remove("landed");
          jump.classList.add("flipping");
          sfx.coin();
          setTimeout(() => {
            jump.classList.remove("flipping");
            if (app.state?.toss?.step !== "flip") return;
            revealCoinFace();
          }, 1300);
        } else if (app.coinLanded) {
          // re-render after landing — keep the face showing
          coin.textContent = s.toss.flip === "H" ? "H" : "T";
        }
        const w = s.toss.winner;
        const calls = `Team A said ${s.toss.callA === "H" ? "heads" : "tails"}, Team B said ${s.toss.callB === "H" ? "heads" : "tails"} — coin says ${s.toss.flip === "H" ? "heads" : "tails"}`;
        $("#toss-result").innerHTML = app.coinLanded
          ? `${calls} — <span class="ok">Team ${w} wins the toss!</span>`
          : "";
      } else {
        coin.textContent = "?";
        coin.classList.remove("landed");
        jump.classList.remove("flipping");
        app.coinLanded = false;
        $("#toss-result").textContent = "";
      }
    }

    // ----- choice step -----
    if (step === "choice") {
      const w = s.toss.winner;
      $("#toss-winner-text").textContent = `Team ${w} won the toss — captain, choose:`;
      const canChoose = amCaptainOf(w);
      $$(".choice-btn").forEach((b) => (b.disabled = !canChoose));
      $("#choice-wait").classList.toggle("hidden", canChoose);
      $("#choice-wait").textContent = `waiting for Team ${w}'s captain to choose…`;
    }

    // ----- orders step -----
    if (step === "orders") {
      const t = myTeam();
      const locked = t ? s.toss.ordersLocked[t] : true;
      const other = t === "A" ? "B" : "A";
      const otherLocked = s.toss.ordersLocked[other];
      $("#toss-orders-panel").classList.toggle("hidden", !t);
      $("#toss-wait-panel").classList.toggle("hidden", !!t);
      const clearBtns = [$("#order-box-bat [data-clear]"), $("#order-box-bowl [data-clear]")];
      clearBtns.forEach((b) => { if (b) b.classList.toggle("hidden", !t || locked || !amCaptainOf(t)); });

      if (t) {
        const cap = amCaptainOf(t);
        $("#order-team-bat").innerHTML = `<span class="team-tag tag-${t.toLowerCase()}">${t}</span>`;
        $("#order-team-bowl").innerHTML = `<span class="team-tag tag-${t.toLowerCase()}">${t}</span>`;
        $("#order-box-bat").classList.toggle("no-pool-label", !cap || locked);
        $("#order-box-bowl").classList.toggle("no-pool-label", !cap || locked);
        if (locked) {
          $("#orders-status").innerHTML = otherLocked
            ? `both lineups locked — starting the match ${ICON.check}`
            : `your lineup is locked ${ICON.check} — waiting for the other team…`;
          $("#btn-lock-orders").disabled = true;
          $("#order-box-bat").classList.add("muted");
          $("#order-box-bowl").classList.add("muted");
          const showLocked = (listEl, poolEl, ids) => {
            listEl.innerHTML = ids.map((id, i) =>
              `<div class="order-chip"><span><span class="ord-pos">${i + 1}.</span>${escapeHtml(playerName(id))}</span></div>`).join("");
            poolEl.innerHTML = "";
          };
          showLocked($("#order-list-bat"), $("#order-pool-bat"), s.teams[t].battingOrder);
          showLocked($("#order-list-bowl"), $("#order-pool-bowl"), s.teams[t].bowlingOrder);
        } else if (!cap) {
          $("#orders-status").textContent = `waiting for Team ${t}'s captain to set the lineup…`;
          $("#btn-lock-orders").disabled = true;
          $("#order-box-bat").classList.add("muted");
          $("#order-box-bowl").classList.add("muted");
          renderOrderBuilders(t, false);
        } else {
          $("#order-box-bat").classList.remove("muted");
          $("#order-box-bowl").classList.remove("muted");
          renderOrderBuilders(t, true);
          refreshOrderUI(); // sets accurate status + disabled from drafts
        }
      } else {
        $("#toss-wait-text").textContent = "waiting for the captains to set their lineups…";
      }
    }

    // host: advance flip → choice after the coin lands
    if (step === "flip" && Net.role === "host" && !app._flipTimer) {
      app._flipTimer = setTimeout(() => {
        app._flipTimer = null;
        if (app.state?.toss?.step === "flip") {
          app.state.toss.step = "choice";
          Net.broadcast({ t: "toss", players: lobbySnapshot(), state: serializeState(app.state) });
          renderToss();
        }
      }, 1650);
    }
  }

  function revealCoinFace() {
    const coin = $("#toss-coin");
    const s = app.state;
    if (!s?.toss || s.toss.step !== "flip") return;
    coin.textContent = s.toss.flip === "H" ? "H" : "T";
    coin.classList.add("landed");
    app.coinLanded = true;
    sfx.pick();
    const w = s.toss.winner;
    const calls = `Team A said ${s.toss.callA === "H" ? "heads" : "tails"}, Team B said ${s.toss.callB === "H" ? "heads" : "tails"} — coin says ${s.toss.flip === "H" ? "heads" : "tails"}`;
    $("#toss-result").innerHTML = `${calls} — <span class="ok">Team ${w} wins the toss!</span>`;
  }

  function afterTossChange() {
    // size-1 teams don't need an order editor — auto-lock them
    if (app.state?.phase === "toss" && app.state.toss.step === "orders") {
      Game.autoLockSmallTeams(app.state, app.players);
      if (app.state.toss.ordersLocked.A && app.state.toss.ordersLocked.B) {
        return goLiveFromToss();
      }
    }
    Net.broadcast({ t: "toss", players: lobbySnapshot(), state: serializeState(app.state) });
    renderToss();
  }

  function goLiveFromToss() {
    const s = app.state;
    Game.startFromToss(s);
    Net.broadcast({ t: "start", players: lobbySnapshot(), state: serializeState(s) });
    enterNetGameUI();
    beginNetBall();
  }

  function doTossCall(team, call) {
    const s = app.state;
    if (!s || s.phase !== "toss" || s.toss.step !== "call") return;
    if (!amCaptainOf(team)) return;
    if (Net.role === "host") {
      Game.setTossCall(s, team, call);
      afterTossChange();
    } else {
      // send only — host owns the flip (avoid divergent random results)
      Net.sendToHost({ t: "toss-call", team, call });
      const btns = $(`#caller-btns-${team}`);
      btns.querySelectorAll(".call-btn").forEach((b) => (b.disabled = true));
      $(`#caller-status-${team}`).innerHTML = `locked in ${ICON.check}`;
      $(`#caller-status-${team}`).classList.add("locked");
    }
  }

  function doTossChoice(choice) {
    const s = app.state;
    if (!s || s.phase !== "toss" || s.toss.step !== "choice") return;
    if (!amCaptainOf(s.toss.winner)) return;
    sfx.click();
    if (Net.role !== "host") Net.sendToHost({ t: "toss-choice", choice });
    Game.setTossChoice(s, choice);
    app.draftBat = [];
    app.draftBowl = [];
    app.ordersSent = false;
    if (Net.role === "host") afterTossChange();
    else renderToss();
  }

  function renderOrderBuilders(team, interactive = true) {
    const pool = Game.teamPlayers(app.players, team);
    const poolIds = pool.map((p) => p.id);
    const n = poolIds.length;

    const renderBox = (listEl, poolEl, draft) => {
      // numbered slots: filled ones show the name, empty ones show where the next name goes
      const rows = [];
      for (let i = 0; i < n; i++) {
        const id = draft[i];
        if (id) {
          rows.push(`
            <div class="order-chip"${interactive ? ` data-rm="${id}"` : ""}>
              <span><span class="ord-pos">${i + 1}.</span>${escapeHtml(playerName(id))}</span>
              ${interactive ? `<span class="ord-x">${ICON.x}</span>` : ""}
            </div>`);
        } else {
          rows.push(`<div class="order-slot"><span class="ord-pos">${i + 1}.</span><span>${interactive ? "next up — click a name below" : "—"}</span></div>`);
        }
      }
      listEl.innerHTML = rows.join("");

      const remaining = poolIds.filter((id) => !draft.includes(id));
      if (!interactive) {
        poolEl.innerHTML = `<span class="order-empty">waiting for your captain…</span>`;
      } else if (remaining.length) {
        poolEl.innerHTML = remaining
          .map((id) => `<button class="pool-chip" data-add="${id}">${escapeHtml(playerName(id))}</button>`)
          .join("");
      } else {
        poolEl.innerHTML = `<span class="order-empty">everyone's in — looks good</span>`;
      }
    };

    renderBox($("#order-list-bat"), $("#order-pool-bat"), app.draftBat);
    renderBox($("#order-list-bowl"), $("#order-pool-bowl"), app.draftBowl);
  }

  function bindOrderBoxes() {
    // toss boxes (delegated, bound once)
    const hook = (poolSel, listSel, draftKey) => {
      $(poolSel).addEventListener("click", (e) => {
        const b = e.target.closest("[data-add]");
        if (!b) return;
        sfx.pick();
        app[draftKey].push(b.dataset.add);
        refreshOrderUI();
      });
      $(listSel).addEventListener("click", (e) => {
        const b = e.target.closest("[data-rm]");
        if (!b) return;
        sfx.pick();
        const i = app[draftKey].indexOf(b.dataset.rm);
        if (i >= 0) app[draftKey].splice(i, 1);
        refreshOrderUI();
      });
    };
    hook("#order-pool-bat", "#order-list-bat", "draftBat");
    hook("#order-pool-bowl", "#order-list-bowl", "draftBowl");
    hook("#break-order-pool", "#break-order-list", "draftBreak");

    // "start this list over" buttons
    $('#order-box-bat [data-clear]').addEventListener("click", () => {
      sfx.click();
      app.draftBat = [];
      refreshOrderUI();
    });
    $('#order-box-bowl [data-clear]').addEventListener("click", () => {
      sfx.click();
      app.draftBowl = [];
      refreshOrderUI();
    });
    $('#break-order-box [data-clear]').addEventListener("click", () => {
      sfx.click();
      const s = app.state;
      if (!s || s.phase !== "break" || !amCaptainOf(s.bowling)) return;
      app.draftBreak = [];
      renderBreakPanel();
    });
  }

  function refreshOrderUI() {
    const s = app.state;
    // lineup already sent for THIS toss step — don't rewrite the status
    if (s?.phase === "toss" && s.toss.step === "orders" && app.ordersSent) return;
    if (s?.phase === "toss" && s.toss.step === "orders") {
      const t = myTeam();
      if (t) renderOrderBuilders(t, amCaptainOf(t));
      const n = Game.teamPlayers(app.players, t).length;
      const ready = app.draftBat.length === n && app.draftBowl.length === n;
      $("#btn-lock-orders").disabled = !ready || !amCaptainOf(t);
      if (amCaptainOf(t)) {
        $("#orders-status").textContent = !ready
          ? `batting: ${app.draftBat.length} of ${n} set · bowling: ${app.draftBowl.length} of ${n} set — fill both lists, then lock in`
          : "both lists look complete — hit lock in";
      }
    }
    if (s?.phase === "break" && s.awaitingBreakReady) {
      renderBreakPanel();
    }
  }

  function lockMyOrders() {
    const s = app.state;
    const t = myTeam();
    if (!s || s.phase !== "toss" || s.toss.step !== "orders" || !t) return;
    if (!amCaptainOf(t)) return;
    const n = Game.teamPlayers(app.players, t).length;
    if (app.draftBat.length !== n || app.draftBowl.length !== n) return;
    sfx.click();

    if (Net.role === "host") {
      applyOrders(t, app.draftBat, app.draftBowl);
    } else {
      Net.sendToHost({ t: "orders", team: t, batting: app.draftBat, bowling: app.draftBowl });
      app.ordersSent = true;
      $("#orders-status").textContent = "lineup sent — waiting for the other team…";
      $("#btn-lock-orders").disabled = true;
    }
  }

  function applyOrders(team, batting, bowling) {
    const s = app.state;
    if (!Game.lockOrders(s, app.players, team, batting, bowling)) return;
    Game.autoLockSmallTeams(s, app.players);
    if (s.toss.ordersLocked.A && s.toss.ordersLocked.B) {
      goLiveFromToss();
    } else {
      afterTossChange();
    }
  }

  // net play //


  async function createRoom() {
    app.mode = "host";
    app.name = ($("#input-name").value || "Player").trim().slice(0, 14) || "Player";
    $("#net-status").textContent = "opening room…";

    try {
      await Net.create(app.name);
    } catch (e) {
      $("#net-status").textContent = "couldn't open room (network). try again or play vs AI.";
      console.error(e);
      return;
    }

    $("#net-status").textContent = "";
    app.youId = Net.myId;
    app.players = [{ id: Net.myId, name: app.name, team: null, isYou: true, isCaptain: false }];
    app.ballHistory = [];

    $("#invite-link").value = Net.linkFor(Net.roomCode);
    $("#room-code-label").textContent = Net.roomCode;
    renderLobby();
    show("#screen-lobby");

    Net.on("host-msg", ({ from, msg }) => handleHostMsg(from, msg));
    Net.on("lobby-change", () => renderLobby());
    Net.on("peer-left", ({ id }) => {
      app.players = app.players.filter((p) => p.id !== id);
      // if captain left, hand crown to someone else
      ensureCaptains();
      renderLobby();
      broadcastLobby();
    });
  }

  function handleHostMsg(from, msg) {
    const sender = app.players.find((p) => p.id === from);
    const senderTeam = sender?.team;

    if (msg.t === "hello") {
      if (!app.players.find((p) => p.id === from)) {
        app.players.push({ id: from, name: String(msg.name || "Player").slice(0, 14), team: null, isYou: false, isCaptain: false });
      }
      Net.send(from, { t: "lobby", players: lobbySnapshot(), youId: from, room: Net.roomCode });
      renderLobby();
      return;
    }
    if (msg.t === "team") {
      if (sender) {
        assignTeam(sender, msg.team);
        renderLobby();
        broadcastLobby();
      }
      return;
    }
    if (msg.t === "elect") {
      const target = app.players.find((p) => p.id === msg.id);
      if (target && senderTeam && target.team === senderTeam) {
        applyElect(msg.id);
        broadcastLobby();
      }
      return;
    }

    // ---- toss messages (captain only) ----
    if (msg.t === "toss-call") {
      if (senderTeam && amCaptainOfHost(msg.team, from)) {
        Game.setTossCall(app.state, msg.team, msg.call);
        afterTossChange();
      }
      return;
    }
    if (msg.t === "toss-choice") {
      const s = app.state;
      if (s?.phase === "toss" && s.toss.step === "choice" && senderTeam === s.toss.winner && s.captains[senderTeam] === from) {
        Game.setTossChoice(s, msg.choice);
        app.draftBat = [];
        app.draftBowl = [];
        afterTossChange();
      }
      return;
    }
    if (msg.t === "orders") {
      const s = app.state;
      if (s?.phase === "toss" && s.toss.step === "orders" && senderTeam && s.captains[senderTeam] === from) {
        applyOrders(senderTeam, msg.batting, msg.bowling);
      }
      return;
    }

    // ---- balls ----
    if (msg.t === "commit") {
      app.state.commits[from] = msg.hash;
      maybeStartReveal();
      return;
    }
    if (msg.t === "reveal") {
      app.state.reveals[from] = { pick: msg.pick, salt: msg.salt };
      maybeResolveNet();
      return;
    }

    // ---- between-over bowler (bowling captain) ----
    if (msg.t === "bowler") {
      const s = app.state;
      if (s?.pendingBowler && senderTeam === s.bowling && s.captains[senderTeam] === from) {
        pickNextBowler(msg.id);
      }
      return;
    }

    // ---- innings break (chasing captain) ----
    if (msg.t === "break-ready") {
      const s = app.state;
      if (s?.phase === "break" && senderTeam === s.bowling && s.captains[senderTeam] === from) {
        applyBreakReady(msg.batting);
      }
      return;
    }

    if (msg.t === "bye") {
      app.players = app.players.filter((p) => p.id !== from);
      ensureCaptains();
      renderLobby();
      broadcastLobby();
    }
  }

  function amCaptainOfHost(team, playerId) {
    const s = app.state;
    return s?.phase === "toss" && s.toss.step === "call" && s.captains[team] === playerId;
  }

  function enterNetGameUI() {
    show("#screen-game");
    hideGamePanels();
    const you = myPlayer();
    $("#you-name").textContent = you?.name || app.name;
    const opp = you ? app.players.find((p) => p.team !== you.team) : null;
    $("#them-name").textContent = opp ? opp.name : "them";
    resetArena();
    renderScoreboard();
    renderLog();
    $("#ball-log").innerHTML = `<div class="log-line muted">waiting for ball…</div>`;
  }

  function beginNetBall() {
    const s = app.state;
    if (!s) return;
    if (s.phase === "done") return finishNetMatch();
    if (s.phase === "break" || s.pendingBowler) return; // flows handled elsewhere

    const batId = Game.currentBatter(s, app.players)?.id;
    const bowlId = Game.currentBowler(s, app.players)?.id;
    s.commits = {};
    s.reveals = {};
    s.awaiting = "both";
    app.myPick = null;
    app.mySalt = null;

    const youBatting = batId === app.youId;
    const youBowling = bowlId === app.youId;

    hideGamePanels();
    resetArena();
    $("#you-name").textContent = youBatting ? `${app.name} batting` : youBowling ? `${app.name} bowling` : app.name;
    const otherId = batId === app.youId ? bowlId : batId;
    $("#them-name").textContent = `${playerName(otherId)} ${otherId === batId ? "batting" : "bowling"}`;

    if (youBatting || youBowling) {
      setPickUI(youBatting ? "you're batting — pick" : "you're bowling — pick", true);
    } else {
      setPickUI(`waiting for ${playerName(batId)} & ${playerName(bowlId)}…`, false);
    }

    Net.broadcast({ t: "ball", batId, bowlId, ballNo: s.ballNo + 1 });
  }

  function maybeStartReveal() {
    const s = app.state;
    const batId = Game.currentBatter(s, app.players)?.id;
    const bowlId = Game.currentBowler(s, app.players)?.id;
    if (s.commits[batId] && s.commits[bowlId]) {
      Net.broadcast({ t: "reveal-now" });
      setPickUI("both locked in — reveal!", false);
      promptHostRevealIfNeeded();
    }
  }

  function promptHostRevealIfNeeded() {
    const s = app.state;
    const batId = Game.currentBatter(s, app.players)?.id;
    const bowlId = Game.currentBowler(s, app.players)?.id;
    const involved = batId === app.youId || bowlId === app.youId;
    if (involved && app.myPick != null && !s.reveals[app.youId]) {
      setTimeout(() => sendMyReveal(), 400);
    }
  }

  function sendMyReveal() {
    const s = app.state;
    if (app.myPick == null || app.mySalt == null) return;
    s.reveals[app.youId] = { pick: app.myPick, salt: app.mySalt };
    Net.sendToHost({ t: "reveal", pick: app.myPick, salt: app.mySalt });
    if (Net.role === "host") maybeResolveNet();
  }

  async function maybeResolveNet() {
    const s = app.state;
    if (app._resolving) return;
    const batId = Game.currentBatter(s, app.players)?.id;
    const bowlId = Game.currentBowler(s, app.players)?.id;
    if (!s.reveals[batId] || !s.reveals[bowlId]) return;
    app._resolving = true;

    const res = await Game.resolveBall(s, app.players);
    app._resolving = false;
    if (!res || res.error) {
      $("#ball-log").innerHTML = `<div class="log-line bad">that ball got scrambled — playing it again</div>`;
      s.commits = {};
      s.reveals = {};
      beginNetBall();
      return;
    }

    // between overs: bowling captain may swap next bowler (multi-player teams only)
    const bowlTeamPlayers = Game.teamPlayers(app.players, s.bowling);
    if (res.overEnded && bowlTeamPlayers.length > 1) {
      s.pendingBowler = true;
    }

    const lb = s.lastBall;
    app.ballHistory.push({ n: s.ballNo, bat: lb.bat, bowl: lb.bowl, runs: lb.runs, out: lb.out });

    Net.broadcast({ t: "ball-result", state: serializeState(s), ballHistory: app.ballHistory });
    applyBallVisual(s, lb);

    setTimeout(() => {
      if (s.phase === "done") {
        finishNetMatch();
      } else if (s.phase === "break") {
        onInningsBreak();
      } else if (s.pendingBowler) {
        renderBowlerPanel();
      } else {
        beginNetBall();
      }
    }, 1400);
  }

  function applyBallVisual(s, lb) {
    const you = myPlayer();
    const yourId = you?.id;
    let left, right;
    if (lb.scorer === yourId || lb.vs === yourId) {
      const yourPick = lb.scorer === yourId ? lb.bat : lb.bowl;
      const theirPick = lb.scorer === yourId ? lb.bowl : lb.bat;
      left = yourPick;
      right = theirPick;
    } else {
      left = lb.bat;
      right = lb.bowl;
    }
    showHands(left, right);
    if (lb.out) burst("OUT!", "out");
    else burst(`+${lb.runs}`, "runs");
    renderScoreboard();
    renderLog();
  }

  /* ---------- between-over bowler picker ---------- */
  function renderBowlerPanel() {
    const s = app.state;
    if (!s?.pendingBowler) return;
    const panel = $("#bowler-panel");
    panel.classList.remove("hidden");
    setPickUI("over done — waiting for the bowling captain to pick…", false);
    const team = s.bowling;
    const captain = amCaptainOf(team);
    const roster = Game.teamPlayers(app.players, team);
    $("#bowler-hint").textContent = captain
      ? `over ${Math.floor(s.teams[team].balls / 6) + 1} is next — captain, who's bowling it? pick whoever matches up best against their batter.`
      : `waiting for Team ${team}'s captain to pick who bowls the next over…`;
    $("#bowler-row").innerHTML = captain
      ? roster.map((p) => `<button class="btn" data-bowler="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`).join("")
      : `<span class="bowler-wait">…</span>`;
    $("#bowler-row").querySelectorAll("[data-bowler]").forEach((b) => {
      b.onclick = () => {
        sfx.click();
        if (Net.role === "host") pickNextBowler(b.dataset.bowler);
        else Net.sendToHost({ t: "bowler", id: b.dataset.bowler });
        b.disabled = true;
      };
    });
  }

  function pickNextBowler(playerId) {
    const s = app.state;
    if (!Game.setNextBowler(s, playerId)) return;
    Net.broadcast({ t: "sync", state: serializeState(s) });
    $("#bowler-panel").classList.add("hidden");
    beginNetBall();
  }

  /* ---------- innings break ---------- */
  function onInningsBreak() {
    const s = app.state;
    const chaseTeam = s.bowling;
    const roster = Game.teamPlayers(app.players, chaseTeam);
    if (roster.length <= 1) {
      // no decision to make — auto proceed
      Game.startInnings2(s);
      Net.broadcast({ t: "innings2", state: serializeState(s) });
      renderScoreboard();
      resetArena();
      $("#ball-log").innerHTML = `<div class="log-line"><span class="ok">innings break — target ${s.target}</span></div>`;
      setTimeout(() => beginNetBall(), 900);
      return;
    }
    // chasing captain may re-set the batting order
    s.awaitingBreakReady = true;
    app.draftBreak = s.teams[chaseTeam].battingOrder.slice();
    app.breakDraftInit = true;
    Net.broadcast({ t: "sync", state: serializeState(s) });
    renderBreakPanel();
  }

  function renderBreakPanel() {
    const s = app.state;
    if (!s || s.phase !== "break") return;
    const panel = $("#break-panel");
    panel.classList.remove("hidden");
    hidePickDuringHold();
    const chaseTeam = s.bowling;
    const captain = amCaptainOf(chaseTeam);
    const roster = Game.teamPlayers(app.players, chaseTeam);
    $("#break-order-team").innerHTML = `<span class="team-tag tag-${chaseTeam.toLowerCase()}">${chaseTeam}</span>`;
    const clearBtn = $("#break-order-box [data-clear]");
    if (clearBtn) clearBtn.classList.toggle("hidden", !captain);

    if (!captain) {
      $("#break-status").textContent = `waiting for Team ${chaseTeam}'s captain to set the chase order…`;
      $("#btn-break-ready").disabled = true;
      $("#break-order-pool").innerHTML = "";
      $("#break-order-list").innerHTML = s.teams[chaseTeam].battingOrder
        .map((id, i) => `<div class="order-chip"><span><span class="ord-pos">${i + 1}.</span>${escapeHtml(playerName(id))}</span></div>`).join("");
      return;
    }

    const listEl = $("#break-order-list");
    const poolEl = $("#break-order-pool");
    const n = roster.length;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const id = app.draftBreak[i];
      if (id) {
        rows.push(`
          <div class="order-chip" data-rm="${id}">
            <span><span class="ord-pos">${i + 1}.</span>${escapeHtml(playerName(id))}</span>
            <span class="ord-x">${ICON.x}</span>
          </div>`);
      } else {
        rows.push(`<div class="order-slot"><span class="ord-pos">${i + 1}.</span><span>next up — click a name below</span></div>`);
      }
    }
    listEl.innerHTML = rows.join("");

    const remaining = roster.map((p) => p.id).filter((id) => !app.draftBreak.includes(id));
    poolEl.innerHTML = remaining.length
      ? remaining.map((id) => `<button class="pool-chip" data-add="${id}">${escapeHtml(playerName(id))}</button>`).join("")
      : `<span class="order-empty">everyone's in — looks good</span>`;

    const done = app.draftBreak.length === n;
    $("#btn-break-ready").disabled = !done;
    $("#break-status").textContent = done
      ? `target ${s.target} — your lineup's set, go get it`
      : `captain: ${app.draftBreak.length} of ${n} batters set — click the rest into place`;
  }

  function hidePickDuringHold() {
    setPickUI("innings break…", false);
    $("#num-row").style.opacity = "0.35";
  }

  function breakReady() {
    const s = app.state;
    const t = s?.bowling;
    if (!s || s.phase !== "break" || !amCaptainOf(t)) return;
    const n = Game.teamPlayers(app.players, t).length;
    if (app.draftBreak.length !== n) return;
    sfx.click();
    if (Net.role === "host") applyBreakReady(app.draftBreak);
    else Net.sendToHost({ t: "break-ready", batting: app.draftBreak });
    $("#btn-break-ready").disabled = true;
    $("#break-status").innerHTML = `ready — starting the chase ${ICON.check}`;
  }

  function applyBreakReady(batting) {
    const s = app.state;
    const chaseTeam = s.bowling;
    const pool = Game.teamPlayers(app.players, chaseTeam).map((p) => p.id);
    const ok = Array.isArray(batting) && batting.length === pool.length &&
      batting.every((id) => pool.includes(id)) && new Set(batting).size === batting.length;
    if (ok) s.teams[chaseTeam].battingOrder = batting.slice();

    Game.startInnings2(s);
    Net.broadcast({ t: "innings2", state: serializeState(s) });
    renderScoreboard();
    resetArena();
    hideGamePanels();
    $("#num-row").style.opacity = "";
    $("#ball-log").innerHTML = `<div class="log-line"><span class="ok">innings break — target ${s.target}</span></div>`;
    setTimeout(() => beginNetBall(), 900);
  }

  function finishNetMatch() {
    const s = app.state;
    const a = s.teams.A.runs;
    const b = s.teams.B.runs;
    const yourTeam = myTeam();
    const tie = a === b;
    const youWon = (yourTeam === "A" && a > b) || (yourTeam === "B" && b > a);
    Net.broadcast({ t: "result", a, b });
    showResultScreen({
      tie,
      youWon,
      title: tie ? "tie!" : youWon ? "you win!" : "you lose",
      stamp: tie ? "TIE" : youWon ? "WIN" : "LOSE",
      line: `Team A ${a} — Team B ${b}`,
      detail: app.players.map((p) => `${p.name} (${p.team})`).join(" · "),
    });
  }

  // net play - guest .. //

  async function joinRoom(code) {
    app.mode = "guest";
    app.name = ($("#input-name").value || "Player").trim().slice(0, 14) || "Player";
    $("#net-status").textContent = `joining ${code}…`;
    try {
      await Net.join(code);
    } catch (e) {
      $("#net-status").textContent = "couldn't join — wrong code or room closed.";
      console.error(e);
      return;
    }
    $("#net-status").textContent = "";
    app.youId = Net.myId;
    Net.sendToHost({ t: "hello", name: app.name });
    Net.on("guest-msg", ({ msg }) => handleGuestMsg(msg));
    $("#invite-link").value = Net.linkFor(code);
    $("#room-code-label").textContent = code;
    $("#btn-start").classList.add("hidden");
    $("#team-pick").classList.remove("hidden");
    $("#lobby-hint").textContent = "pick a team, wait for host";
    show("#screen-lobby");
  }

  function handleGuestMsg(msg) {
    if (msg.t === "lobby") {
      app.players = msg.players.map((p) => ({ ...p, isYou: p.id === Net.myId }));
      app.youId = Net.myId;
      renderLobby();
      return;
    }
    if (msg.t === "toss") {
      if (msg.players) app.players = msg.players.map((p) => ({ ...p, isYou: p.id === Net.myId }));
      app.state = msg.state;
      app.coinAnimated = false;
      app.coinLanded = false;
      if (msg.state?.toss?.step !== "orders") app.ordersSent = false;
      renderToss();
      return;
    }
    if (msg.t === "start") {
      app.players = msg.players.map((p) => ({ ...p, isYou: p.id === Net.myId }));
      app.state = msg.state;
      app.ballHistory = [];
      enterNetGameUI();
      return;
    }
    if (msg.t === "ball") {
      const s = app.state;
      s.commits = {};
      s.reveals = {};
      app.myPick = null;
      app.mySalt = null;
      hideGamePanels();
      $("#num-row").style.opacity = "";
      const batId = msg.batId;
      const bowlId = msg.bowlId;
      const youBatting = batId === app.youId;
      const youBowling = bowlId === app.youId;
      resetArena();
      const otherId = batId === app.youId ? bowlId : batId;
      $("#you-name").textContent = youBatting ? `${app.name} batting` : youBowling ? `${app.name} bowling` : app.name;
      $("#them-name").textContent = `${playerName(otherId)} ${otherId === batId ? "batting" : "bowling"}`;
      if (youBatting || youBowling) {
        setPickUI(youBatting ? "you're batting — pick" : "you're bowling — pick", true);
      } else {
        setPickUI(`waiting for ${playerName(batId)} & ${playerName(bowlId)}…`, false);
      }
      return;
    }
    if (msg.t === "reveal-now") {
      setPickUI("both locked — reveal!", false);
      if (app.myPick != null && app.mySalt != null) {
        setTimeout(() => {
          Net.sendToHost({ t: "reveal", pick: app.myPick, salt: app.mySalt });
        }, 400);
      }
      return;
    }
    if (msg.t === "ball-result") {
      app.state = msg.state;
      app.ballHistory = msg.ballHistory || [];
      const lb = app.state.lastBall;
      if (lb) applyBallVisual(app.state, lb);
      // after visual, host will send follow-ups; but render hold-UI early if needed
      if (app.state.phase === "break") {
        setTimeout(() => renderBreakPanelIfHeld(), 1400);
      } else if (app.state.pendingBowler) {
        setTimeout(() => renderBowlerPanel(), 1400);
      }
      return;
    }
    if (msg.t === "sync") {
      app.state = msg.state;
      if (app.state.phase === "toss") renderToss();
      if (app.state.phase === "break" && app.state.awaitingBreakReady) {
        if (!app.breakDraftInit) {
          app.draftBreak = app.state.teams[app.state.bowling].battingOrder.slice();
          app.breakDraftInit = true;
        }
        renderBreakPanel();
      }
      return;
    }
    if (msg.t === "innings2") {
      app.state = msg.state;
      renderScoreboard();
      resetArena();
      hideGamePanels();
      $("#num-row").style.opacity = "";
      $("#ball-log").innerHTML = `<div class="log-line"><span class="ok">innings break — target ${app.state.target}</span></div>`;
      return;
    }
    if (msg.t === "result") {
      const yourTeam = myTeam();
      const tie = msg.a === msg.b;
      const youWon = (yourTeam === "A" && msg.a > msg.b) || (yourTeam === "B" && msg.b > msg.a);
      const stamp = tie ? "TIE" : youWon ? "WIN" : "LOSE";
      showResultScreen({
        tie,
        youWon,
        title: tie ? "tie!" : youWon ? "you win!" : "you lose",
        stamp,
        line: `Team A ${msg.a} — Team B ${msg.b}`,
        detail: app.players.map((p) => `${p.name} (${p.team})`).join(" · "),
      });
      return;
    }
    if (msg.t === "bye") {
      $("#ball-log").innerHTML = `<div class="log-line bad">host left</div>`;
    }
  }

  function renderBreakPanelIfHeld() {
    if (app.state?.phase === "break" && app.state.awaitingBreakReady) {
      if (!app.breakDraftInit) {
        app.draftBreak = app.state.teams[app.state.bowling].battingOrder.slice();
        app.breakDraftInit = true;
      }
      renderBreakPanel();
    }
  }

  // pick buttons //

  function onPickNumber(n) {
    sfx.pick();
    $$(".num-btn").forEach((b) => b.classList.toggle("picked", +b.dataset.n === n));

    if (app.mode === "ai") {
      if (app.turnLock && app._resolvePick) {
        const r = app._resolvePick;
        app._resolvePick = null;
        $("#hand-you").innerHTML = Hands.svg(n, { size: 130 });
        $("#pick-you").textContent = n;
        $("#pick-them").textContent = "…";
        setPickUI("locked in…", false);
        r(n);
      }
      return;
    }

    // netplay
    const s = app.state;
    if (!s || s.phase !== "live" || s.pendingBowler) return;
    const batId = Game.currentBatter(s, app.players)?.id;
    const bowlId = Game.currentBowler(s, app.players)?.id;
    if (app.youId !== batId && app.youId !== bowlId) return;
    if (s.commits[app.youId]) return;

    const salt = Game.randomSalt();
    app.myPick = n;
    app.mySalt = salt;
    setPickUI("locked in — waiting for the other player…", false);
    $("#hand-you").innerHTML = Hands.svg(n, { size: 130 });
    $("#pick-you").textContent = n;

    Game.makeCommit(n, salt).then((hash) => {
      s.commits[app.youId] = hash;
      if (Net.role === "host") {
        Net.broadcast({ t: "commit", hash });
        maybeStartReveal();
      } else {
        Net.sendToHost({ t: "commit", hash });
      }
    });
  }

  // result screen //

  function showResultScreen({ tie, youWon, title, stamp, line, detail }) {
    hideGamePanels();
    $("#num-row").style.opacity = "";
    $("#result-title").textContent = title;
    $("#result-stamp").textContent = stamp;
    $("#result-stamp").className = `result-stamp ${tie ? "tie" : youWon ? "win" : "lose"}`;
    $("#final-line").textContent = line;
    $("#final-detail").textContent = detail;
    show("#screen-result");
    if (tie || youWon) sfx.win();
    else sfx.lose();
    const el = $("#result-stamp");
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }

  // wiring //
  
  function bind() {
    renderHands();
    bindOrderBoxes();

    $("#btn-ai").onclick = () => { sfx.click(); startAIMatch(); };

    $("#btn-create").onclick = () => { sfx.click(); createRoom(); };

    $("#btn-join-open").onclick = () => {
      sfx.click();
      $("#join-row").classList.toggle("hidden");
      $("#input-code").focus();
    };

    $("#btn-join").onclick = () => {
      sfx.click();
      const code = $("#input-code").value.trim();
      if (code.length >= 4) joinRoom(code);
    };

    $("#input-code").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#btn-join").click();
    });

    $("#btn-copy").onclick = async () => {
      const inp = $("#invite-link");
      inp.select();
      try {
        await navigator.clipboard.writeText(inp.value);
        $("#btn-copy").textContent = "copied!";
      } catch {
        document.execCommand("copy");
        $("#btn-copy").textContent = "copied!";
      }
      setTimeout(() => ($("#btn-copy").textContent = "copy"), 1500);
    };

    $$(".team-btn").forEach((btn) => {
      btn.onclick = () => {
        sfx.click();
        const team = btn.dataset.team;
        const me = myPlayer();
        if (!me) return;
        assignTeam(me, team);
        if (Net.role === "host") {
          renderLobby();
          broadcastLobby();
        } else {
          Net.sendToHost({ t: "team", team });
          renderLobby();
        }
        $$(".team-btn").forEach((b) => b.classList.toggle("active", b === btn));
      };
    });

    $("#btn-start").onclick = () => {
      sfx.click();
      if (Net.role === "host") beginToss();
    };

    $("#btn-leave").onclick = () => {
      Net.leave();
      show("#screen-home");
    };

    $("#btn-home").onclick = () => {
      Net.leave();
      app.state = null;
      show("#screen-home");
    };

    $("#btn-rematch").onclick = () => {
      sfx.click();
      if (app.mode === "ai") {
        startAIMatch();
      } else if (Net.role === "host") {
        beginToss();
      } else {
        $("#final-detail").textContent = "waiting for host to start the rematch — new toss coming…";
      }
    };

    // toss: calls / choice / lock orders
    $$(".call-btn").forEach((b) => {
      b.onclick = () => doTossCall(b.dataset.team, b.dataset.call);
    });
    $$(".choice-btn").forEach((b) => {
      b.onclick = () => doTossChoice(b.dataset.choice);
    });
    $("#btn-lock-orders").onclick = lockMyOrders;

    // break / bowler
    $("#btn-break-ready").onclick = breakReady;

    // number buttons + keyboard
    $("#num-row").addEventListener("click", (e) => {
      const btn = e.target.closest(".num-btn");
      if (!btn || btn.disabled) return;
      onPickNumber(+btn.dataset.n);
    });

    addEventListener("keydown", (e) => {
      if (e.key >= "1" && e.key <= "6") {
        const btn = $(`.num-btn[data-n="${e.key}"]`);
        if (btn && !btn.disabled) onPickNumber(+e.key);
      }
    });

    // hash invite on load
    const pre = Net.roomFromHash();
    if (pre) {
      $("#input-code").value = pre;
      $("#join-row").classList.remove("hidden");
      $("#net-status").textContent = `invite detected for room ${pre} — hit join`;
    }

    // rules screen (opens over whatever screen you were on, back returns there)
    const openRules = () => {
      sfx.click();
      app._rulesBack = document.querySelector(".screen.active")?.id || "screen-home";
      show("#screen-rules");
    };
    $("#btn-rules").onclick = openRules;
    $("#btn-rules-foot").onclick = openRules;
    $("#btn-rules-back").onclick = () => {
      sfx.click();
      show("#" + (app._rulesBack || "screen-home"));
    };
  }

  bind();
})();
