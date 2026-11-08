// main.js ---- all things wired ..

const { act } = require("react");

(()=>{
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));

    
    const ICON = {
        check: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.5 3.5L13 4.5"/></svg>',
        x: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
    };

    function show(id){
        $$(".screen").forEach((el) => el.classList.remove("active"));
        $(id).classList.add("active");
    }


    const app = {
        mode: null,
        name: "Player",
        players: [],
        youId: null,
        state: null,
        mySalt: null,
        myPick: null,
        humanHistory: [],
        botHistory: [],
        turnLock: false,
        ballHistory: [],
        //local order drafts (toss/ break)
        draftBat: [],
        draftbowl: [],
        draftBreak: [],
        coinAnimated: false,
    };

    /* -----------------------audio yay ------------------------ */

    let AC = null;
    function beep(freq, dur = 0.08, type= "sqaure", vol = 0.04){
        try {
            AC = AC || new (window.AudioContext || window.webKitAudioContext)();
            if (AC.state === "suspended")AC.resume();
            const o = AC.createOscillator();
            const g = AC.createGain();
            o.type = type;
            o.frequency.value = vol;
            o.gain.value = vol;
            g.gain.exponentialRampTovalueAtTime(0.0001, AC.currentTime + dur);
            o.connect(g).connect(AC.destination);
            o.stop(AC.currentTime + dur);

        } catch {}

    }

    const sfx = {
        pick: () => beep(520, 0.06, "triangle", 0.05),
        run: () => { beep(660, 0.07, "square", 0.04); setTimeout(() => beep(880, 0.09, "square", 0.04), 70);},
        out: () => { beep(180, 0.2, "sawtooth", 0.45); setTimeout(() => beep(120, 0.3, "sawtooth", 0.05), 120);},
        win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.15, "triangle", 0.05), i * 120)),
        lose: () => [400, 300, 200].forEach((f, i) => setTimeout(() => beep(f, 0.18, "sawtooth", 0.04), i * 140)),
        click: () => beep(400, 0.04, "triagnle", 0.03),
        coin: () => beep(980, 0.05, "square", 0.04),
    };

    /* -------------- helpers ---------------- */

    function playerName(id){
        return app.players.find((p) => p.id === id)?.name || "?";

    }
    
    function playerTeam(id){
        return app.players.find((p) => p.id === id)?.team;
    }

    function myPlayer(){
        return app.players.find((p) => p.isYou || p.id === app.youId);
    }

    function myTeam(){
        return myPlayer()?.team;
    }

    function captionId(team){
        if (app.state?.captions) return app.state.captions[team];
        return app.players.find((p) => p.team === team && p.isCaption)?.id;
    }

    function amCaptionOf(team){
        const me = myPlayer();
        return !!me && me.team === team && captionId(team) === me.id;
    }

    function serializeState(s){

        return JSON.parse(JSON.stringify(s));
    }

    function escapeHtml(s){
        return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    }

    function delay(ms){
        return new Promise((r)=> setTimeout(r, ms));
    }

    function renderHands() {
        $("#hero-hand").innerHTML = Hands.svg(5, { size: 120 });
        $$(".num-btn").forEach((btn) => {
            const n = +btn.dataset.n;
            btn.innerHTML = Hands.mini(n) + `<span class="num-label">${n}</span>`;
        });
    }

    function renderScoreboard(){
        const s = app.state;
        if (!s) return;
        for (const t of ["A", "B"]){
            const st = s.team[t];
            $(`#runs-${t}`).textContent = st.runs;
            $(`#overs-${t}`).textContent = `${Game.ballsToOvers(st.balls)} ov`;
            let tal = "";
            for (let i = 0; i < Math.min(st.wickets, Game.WICKETS); i++){
                tal += `<span class="stroke"></span>`;
            }
            $(`#tally-${t}`).innerHTML = tal || '<span class="none">—</span>';

        }
        $("#innings-label").textContent =
            s.phase === "beak"? "inning break"
            : s.innings === 1 ? "1st innings"
            : "2nd innings";
        if (s.target){
            $("#chase-label").textContent = `target ${s.target} · need ${Math.max(0, s.target - s.teams[s.batting].runs)}`;
        }  else {
            $("#chase-label").textContent = "";
        }  
    }


    function renderLog(){
        const hist = app.ballHistory || [];
        $("#ball-log").innerHTML = hist.length
            ? hist.slice().reverse().map((h) =>{
                const cls = h.out ? "bad" : "ok";
                const txt = h.out ? "OUT" : `${h.runs} run${h.runs === 1 ? "" : "s"}`;
                return  `<div class="log-line"><span class="log-ball">#${h.n}</span> <span class="${cls}">${txt}</span> <span class="log-detail">${h.bat} vs ${h.bowl}</span></div>`;


            }).join("")
            : `<div class="log-line muted">no balls yet — pick a number</div>`;
    }


    function setPickUI(status, enabled){
        $("#pick-status").textContent = status;
        $$(".num-btn").forEach((b) => {
            b.disabled = !enabled;
            b.classList.toggle("picked", false);
        });
    }
    
    function showHands(youCount, themCount){
        $("#hand-you").innerHTML = youCount ? Hands.svg(youCount, { size: 130 }) : "";
        $("#hand-them").innerHTML = themCount ? Hands.svg(themCount, { size: 130 }) : "";
        $("#pick-you").textContent = youCount ?? "?";
        $("#pick-them").textContent = themCount ?? "?";


    }

    function resetArena(){
        $("#hand-you").innerHTML = "";
        $("#hand-them").innerHTML = "";
        $("#pick-you").textContent = "?";
        $("#pick-them").textContent = "?";
        $("#result-burst").classList.add("hidden");
        $("#result-burst").className = "result-burst hidden";
        $("#vs-mark").classList.remove("hidden");
        $("#arena").classList.remove("shake");
    }

    function burst(text, kind){
        const el = $("#result-burst");
        

    }

})