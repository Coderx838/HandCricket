/* net.js — PeerJS room system
   host creates short room id → invite link #r=CODE
   guest connects to host's peer id. no login.
   host is authoritative for match state. commit/reveal for fair picks. */

const Net = (() => {
  let peer = null;
  let hostConn = null;      // guest: connection to host
  let conns = {};           // host: playerId -> DataConnection
  let role = null;          // 'host' | 'guest' | null
  let myId = null;
  let roomCode = null;
  let handlers = {};

  function emit(ev, data) {
    if (handlers[ev]) handlers[ev](data);
  }

  function on(ev, fn) {
    handlers[ev] = fn;
  }

  function randCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  function send(toId, msg) {
    const c = conns[toId];
    if (c && c.open) c.send(JSON.stringify(msg));
  }

  function broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const id of Object.keys(conns)) {
      const c = conns[id];
      if (c && c.open) c.send(s);
    }
  }

  function attach(conn) {
    conn.on("open", () => {
      // wait for hello
    });
    conn.on("data", (raw) => {
      let msg;
      try {
        msg = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return;
      }
      const from = conn.peer;

      if (role === "host") {
        emit("host-msg", { from, msg });
        // auto-track membership on hello
        if (msg.t === "hello") {
          conns[from] = conn;
          emit("lobby-change", {});
        }
        if (msg.t === "bye") {
          delete conns[from];
          emit("lobby-change", {});
        }
      } else {
        emit("guest-msg", { msg });
      }
    });
    conn.on("close", () => {
      if (role === "host") {
        delete conns[conn.peer];
        emit("lobby-change", {});
        emit("peer-left", { id: conn.peer });
      } else {
        emit("disconnected", {});
      }
    });
    conn.on("error", () => {});
    if (role === "host") conns[conn.peer] = conn;
  }

  function create(name) {
    return new Promise((resolve, reject) => {
      role = "host";
      roomCode = randCode();
      myId = "hcricket-" + roomCode;
      try {
        peer = new Peer(myId, { debug: 0 });
      } catch (e) {
        reject(e);
        return;
      }
      peer.on("open", (id) => {
        myId = id;
        resolve({ id, roomCode, link: linkFor(roomCode) });
      });
      peer.on("connection", (conn) => attach(conn));
      peer.on("error", (err) => {
        emit("error", err);
        if (err.type === "unavailable-id" || err.type === "peer-unavailable") {
          // collision — retry once with new code
          roomCode = randCode();
          try {
            peer.destroy();
          } catch {}
          create(name).then(resolve, reject);
          return;
        }
        reject(err);
      });
    });
  }

  function join(code) {
    return new Promise((resolve, reject) => {
      role = "guest";
      roomCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
      try {
        peer = new Peer({ debug: 0 });
      } catch (e) {
        reject(e);
        return;
      }
      peer.on("open", (id) => {
        myId = id;
        const conn = peer.connect("hcricket-" + roomCode, {
          reliable: true,
          serialization: "json",
        });
        hostConn = conn;
        attach(conn);
        conn.on("open", () => {
          resolve({ id, roomCode });
        });
        setTimeout(() => {
          if (!conn.open) reject(new Error("could not reach room"));
        }, 8000);
      });
      peer.on("error", (err) => {
        emit("error", err);
        reject(err);
      });
    });
  }

  function leave() {
    try {
      broadcast({ t: "bye" });
      if (hostConn) hostConn.close();
      for (const id of Object.keys(conns)) {
        try { conns[id].close(); } catch {}
      }
      if (peer) peer.destroy();
    } catch {}
    peer = null;
    hostConn = null;
    conns = {};
    role = null;
    roomCode = null;
    myId = null;
  }

  function linkFor(code) {
    const base = location.origin + location.pathname;
    return `${base}#r=${code}`;
  }

  function roomFromHash() {
    const m = location.hash.match(/r=([A-Za-z0-9]+)/);
    return m ? m[1].toUpperCase() : null;
  }

  function sendToHost(msg) {
    if (hostConn && hostConn.open) hostConn.send(JSON.stringify(msg));
  }

  return {
    on, create, join, leave, send, broadcast, sendToHost,
    linkFor, roomFromHash,
    get role() { return role; },
    get myId() { return myId; },
    get roomCode() { return roomCode; },
    get conns() { return conns; },
  };
})();
