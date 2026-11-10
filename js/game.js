// game.js - the core rules of the game , the ai for it and more //

const Game = (() => {
    const OVERS = 2 // using hardcoded for now
    const BALLS = OVERS * 6 // 12 for now yeh
    const WICKETS = 3 // hardcoded

    const defaultState = () => ({
        phase: "idle", 
        teams: {
            A: { runs: 0 , wickets: 0, balls: 0 , battingOrder: [], batIdx: 0, bowlingOrder: [], bowlIdx: 0},
            B: { runs: 0 , wickets: 0, balls: 0 , battingOrder: [], batIdx: 0, bowlingOrder: [], bowlIdx: 0},
        },
        captains: { A: null, B: null},
        toss: {
            step:  "call", // call | flip | choice | orders
            callA: null, callB: null, // H | T
            flip: null, winner: null,
            choice: null, // bat | bowl
            ordersLocked: { A: false, B: false},
            msg: "",
        },
        batting: "A",
        bowling: "B",
        innings: 1,
        target: null,
        awaiting: "both",
        commits: {},
        reveals: {},
        lastBall: null,
        ballNo: 0,
        pendingBowler: false, // waiting for the bowling captio
        awaitingBreakReady: false, // waiting for chasing caption

    });

    /* ------------------ lookups --------------------- */

    function ballsToOvers(b){
        return `${Math.floor(b / 6)}.${b % 6}`;
    }

    function battingSide(state){
        return state.teams[state.batting];
    }
    function bowlingSide(state){
        return state.teams[state.bowling];
    }

    function currentBatter(state, players){
        const t = battingSide(state)
        if (!t.battingOrder.length) return null;
        return players.find((p) => p.id === t.battingOrder[t.batIdx % t.battingOrder.length]) || null;

    }

    function currentBowler(state, players){
        const t = bowlingSide(state);
        if (!t.bowlingOrder.length) return null;
        return players.find((p) => p.id === t.bowlingOrder[t.bowlIdx % t.bowlingOrder.length]) || null;

    }

    function teamPlayers(players, team){
        return players.filter((p) => p.team === team);
    }

    /* ------------ */
    async function makeCommit(pick, salt){
        const data = new TextEncoder().encode(`${pick}:${salt}`);
        const buf = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    function verifyCommit(pick , salt, hash){
        return makeCommit(pick, salt).then((h) => h === hash);
    }

    function randomSalt(){
        const a = new Uint8Array(16);
        crypto.getRandomValues(a)
        return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
    }


    /* -------- resolve one  ball ----------- */

    async function resolveBall(state, players) {
        const batId = currentBatter(state, players)?.id;
        const bowlId = currentBowler(state, players)?.id;
        const batReveal = state.reveals[batId];
        const bowlReveal = state.reveals[bowlId];
        if(!batReveal || !bowlReveal) return null;

        const batOk = await verifyCommit(batReveal.pick, batReveal.salt, state.commits[batId]);
        const bowlOk = await verifyCommit(bowlReveal.pick, bowlReveal.salt, state.commits[bowlId]);

        if(!batOk || !bowlOk) return { error: "cheat" };

        const bat = batReveal.pick;
        const bowl = bowlReveal.pick;
        const out = bat === bowl;
        const st = state.teams[state.batting];


        if (out){
            st.wickets += 1;
            st.batIdx += 1; // caption's order decides who comes in

        } else {
            st.runs += bat;
        }

        st.balls += 1;
        state.ballNo += 1;

        const overEnded = st.balls % 6 === 0;
        if (overEnded){
            st.bowlIdx += 1; // next over slot - bowler many is overridden by caption.

        }

        state.lastBall = { bat, bowl , runs: out ? 0: bat, out , scorer: batId, vs: bowlId};
        state.commits = {};
        state.reveals = {};
        state.awaiting = "both";


        const inningsOver =
            st.balls >= BALLS ||
            st.wickets >= WICKETS ||
            (state.target != null && st.runs >= state.target);
        
        if (inningsOver){
            if (state.innings === 1){
                state.phase = "break";
                state.target = st.runs + 1;

            } else {
                state.phase = "done";
            }
        }
        
        return {
            state,
            overEnded: overEnded && !inningsOver,
            inningsOver,
            phaseChanged: inningsOver,
        };
        
    }


    function startInnings2(state){
        state.innings = 2;
        const tmp = state.batting;
        state.batting = state.bowling;
        state.bowling = tmp;
        state.teams[state.batting].batIdx = 0;
        state.teams[state.bowling].bowlIdx = 0;
        state.commits = {};
        state.reveals = {};
        state.awaiting = "both";
        state.phase = "live";
        state.lastBall = null;
        state.awaitingBreakReady = false;
        return state;

    }


    /* ---- toss -------- */

    function setTossCall(state, team, call){
        if (state.toss.step !== "call") return false;
        if (call !== "H" && call !== "T") return false;
        if (team === "A") state.toss.callA = call;
        else state.toss.callB = call;

        if(state.toss.callA && state.toss.callB){
            if (state.toss.callA === state.toss.callB){
                state.toss.callA = null;
                state.toss.callB = null;
                state.toss.msg = "both called it - toss again!";
                return true;
            }
            
            state.toss.flip = Math.random() < 0.5 ? "H" : "T";
            state.toss.winner = state.toss.callA === state.toss.flip ? "A" : "B";
            state.toss.step = "flip";
            state.toss.msg = "";
        }
        return true;
        
    }

    function setTossChoice(state, choice){
        if (state.toss.step !== "choice") return false;
        if (choice !== "bat" &&  choice !== "bowl") return false;
        state.toss.choice = choice;
        const w = state.toss.winner;
        const l = w === "A" ? "B" : "A";
        if (choice === "bat"){
            state.batting = w;
            state.bowling = l;

        } else {
            state.batting = l;
            state.bowling = w;

        }
        state.toss.step = "orders";
        return true;
        
    }


    // auto fills the order for size-1 teams 
    function autoLockSmallTeams(state, players){
        for (const t of ["A", "B"]) {
            const ps = teamPlayers(players, t);
            if (ps.length == 1 && !state.toss.ordersLocked[t]){
                state.teams[t].battingOrder = [ps[0].id];
                state.teams[t].bowlingOrder = [ps[0].id];
                state.toss.ordersLocked[t] = true;
            }
            if (ps.length === 0) return false;
        }
        return state.toss.ordersLocked.A && state.toss.ordersLocked.B;
    }



    // validate and lock order from a caption

    function lockOrders(state, players, team , batting, bowling){
        const pool = teamPlayers(players, team).map((p) => p.id);
        const valid = (arr) =>
            Array.isArray(arr) &&
            arr.length === pool.length &&
            arr.every((id) => pool.includes(id)) &&
            new Set(arr).size === arr.length;
        if (!valid(batting) || !valid(bowling)) return false;
        state.teams[team].battingOrder = batting.slice();
        state.teams[team].bowlingOrder = bowling.slice();
        state.toss.ordersLocked[team] = true;
        return true;

    }


    function startFromToss(state){
        state.phase = "live";
        state.innings = 1;
        state.target = null;
        state.ballNo = 0;
        state.awaiting = "both";
        state.commits = {};
        state.reveals = {};
        state.pendingBowler = false;
        state.awaitingBreakReady = false;
        for (const t of ["A", "B"]){
            state.teams[t].runs = 0;
            state.teams[t].wickets = 0;
            state.teams[t].balls = 0;
            state.teams[t].batIdx = 0;
            state.teams[t].bowlIdx = 0;
        }
        return state;
    }


    // AI mode quick start (no wait like captions order etc)

    function startMatch({players, tossWinnerId}){
        const state = defaultState();
        state.phase = "live";
        for (const t of ["A", "B"]){
            const ps = teamPlayers(players, t).map((p) => p.id)
            state.teams[t].battingOrder = ps;
            state.teams[t].bowlingOrder = ps;
        }
        const tossTeam = players.find((p) => p.id === tossWinnerId)?.team || "A";
        state.batting = tossTeam;
        state.bowling = tossTeam === "A" ? "B" : "A";
        state.innings = 1;
        state.target = null;
        return state;
    }

    function whoPicks(state, players){
        return {
            batId : currentBatter(state, players)?.id,
            bowlId: currentBowler(state, players)?.id,
        };
    }

    function setNextBowler(state, playerId){
        if (!state.pendingBowler) return false;
        const bs = bowlingSide(state);
        const idx = bs.bowlIdx % bs.bowlingOrder.length;
        bs.bowlingOrder[idx] = playerId;
        state.pendingBowler = false;
        return true;
    }

    /* ------------- simple bot ------------------ */

    function makeBot(history){
        const recent = history.slice(-3);
        const counts = {};
        for (const n of recent) counts[n] = ( counts[n]||0) + 1;
        let lean = null;
        let best = 0;
        for (const k of Object.keys(counts)){
            if (counts[k] > best){
                best = counts[k];
                lean = +k;
            }
        }
        if (lean && Math.random() < 0.4) return lean;
        return 1 + Math.floor(Math.random() * 6);
    }



    return {
        OVERS, BALLS, WICKETS,
        defaultState,
        ballsToOvers,
        currentBatter,
        currentBowler,
        teamPlayers,
        makeCommit,
        verifyCommit,
        randomSalt,
        resolveBall,
        startInnings2,
        startMatch,
        startFromToss,
        whoPicks,
        makeBot,
        setTossCall,
        setTossChoice,
        lockOrders,
        autoLockSmallTeams,
        setNextBowler,
    };
})();