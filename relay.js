#!/usr/bin/env node
/**
 * tugofwar_relay.js — WebSocket relay for the tug-of-war donation overlay.
 *
 * The control room (tugofwar/) and the OBS copy of the overlay
 * (tugofwar/overlay.html) are separate processes; a browser page cannot
 * postMessage into OBS's embedded Chromium. This relay bridges them:
 *
 *   1. Control room: put ws://localhost:8787 in the relay box.
 *   2. OBS overlay:  append &ws=ws://localhost:8787 to the overlay URL.
 *
 * Every control action (donations included) then reaches both graphics, so
 * the operator drives the copy that is actually on air.
 *
 * Zero dependencies on purpose — it is a raw RFC6455 server (~120 lines).
 * Messages are small JSON text frames; anything larger than 65535 bytes is
 * refused loudly rather than half-broadcast.
 *
 * Usage:
 *   node tugofwar_relay.js [port]     (default 8787)
 *   node tugofwar_relay.js --selftest (two clients, proves the broadcast)
 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CLIENTS = new Set();

function acceptKey(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

function encodeTextFrame(payload) {
  const b = Buffer.from(payload, "utf8");
  if (b.length > 65535) throw new Error("frame too large: " + b.length);
  const head = [0x81];                                  // FIN + text opcode
  if (b.length < 126) {
    head.push(b.length);
  } else {
    head.push(126, (b.length >> 8) & 0xff, b.length & 0xff);
  }
  return Buffer.concat([Buffer.from(head), b]);
}

/** Parse one client frame off the head of buf; null when incomplete. */
function tryParseFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const op = buf[0] & 0x0f;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  if (len > 65535) return { err: "frame too large: " + len };
  if ((buf[1] & 0x80) === 0) return { err: "client frames must be masked" };
  if (buf.length < off + 4 + len) return null;
  const mask = buf.slice(off, off + 4);
  off += 4;
  const payload = Buffer.alloc(len);
  for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i & 3];
  return { fin, op, payload, consumed: off + len };
}

/** The kit manifest (version, source commit, per-file sha256) written beside
 *  relay.js by the emitter. Null when absent -- an unversioned/hand-copied kit.
 *  The version is printed on every start so a customer's paste or screenshot
 *  identifies the exact build: the 2026-09-01 "spins forever" report could not
 *  be tied to a build for an hour because nothing in the kit said which it was. */
function kitManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[1]), "manifest.json"), "utf8"));
  } catch (e) {
    return null;
  }
}

/** Serve the kit pages over plain HTTP — one command runs the whole show.
 *  "node relay.js" then gives the operator the control room AND the overlay
 *  AND the websocket on one port: OBS points at a normal http URL (query
 *  params guaranteed, no file:// quirks), the control room is a browser tab.
 *  Files are read from the relay's own directory, so the unzipped kit IS the
 *  server. */
function serveHttp(socket, req) {
  const g = req.match(/^GET (\S+) HTTP/i);
  const reqPath = g ? g[1].split("?")[0] : "/";
  const FILES = {
    "/": "control-room.html",
    "/index.html": "control-room.html",
    "/control-room.html": "control-room.html",
    "/overlay.html": "overlay.html",
    "/relay.js": process.argv[1],
    "/kit.zip": "kit.zip",
    "/manifest.json": "manifest.json",
    "/kit.zip.sha256": "kit.zip.sha256",
  };
  const name = FILES[reqPath];
  const fail = (code) => socket.end("HTTP/1.1 " + code + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  if (!name) { fail("404 Not Found"); return; }
  const file = name === process.argv[1] ? process.argv[1]
             : path.join(path.dirname(process.argv[1]), name);
  fs.readFile(file, (err, data) => {
    if (err) { fail("404 Not Found"); return; }
    const ct = name.endsWith(".html") ? "text/html; charset=utf-8"
             : name.endsWith(".js") ? "application/javascript"
             : name.endsWith(".zip") ? "application/zip"
             : name.endsWith(".json") ? "application/json; charset=utf-8"
             : name.endsWith(".sha256") ? "text/plain; charset=utf-8"
             : "application/octet-stream";
    const head = Buffer.from("HTTP/1.1 200 OK\r\nContent-Type: " + ct
               + "\r\nContent-Length: " + data.length
               + "\r\nConnection: close\r\n\r\n", "latin1");
    socket.end(Buffer.concat([head, data]));
  });
}

function handle(socket) {
  let buf = Buffer.alloc(0);
  let partial = "";                                     // fragmented text frame
  let open = false;

  function sendText(text) {
    if (!socket.destroyed) socket.write(encodeTextFrame(text));
  }
  function broadcast(text, except) {
    // Encode ONCE, and encode AT ALL. Writing raw text into a WebSocket is a
    // protocol violation: the browser answers it by CLOSING the socket, which
    // the overlay surfaces as "ws: reconnecting" on a 3s loop forever.
    // sendText() has always encoded; this path never did, so every control-room
    // message killed the OBS socket instead of driving it. Customer-reported
    // 2026-09-02 -- and the relay --selftest passed throughout, because it
    // asserted a SUBSTRING over raw bytes, which a raw-text write satisfies.
    const frame = encodeTextFrame(text);
    for (const c of CLIENTS) if (c !== except && !c.destroyed) c.write(frame);
  }

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      const i = buf.indexOf("\r\n\r\n");
      if (i < 0) return;
      const req = buf.slice(0, i).toString("utf8");
      buf = buf.slice(i + 4);
      const m = req.match(/Sec-WebSocket-Key: ([^\r\n]+)/i);
      if (!m) { serveHttp(socket, req); return; }
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " + acceptKey(m[1].trim()) + "\r\n\r\n");
      open = true;
      CLIENTS.add(socket);
      return;
    }
    for (;;) {
      const f = tryParseFrame(buf);
      if (!f) break;
      if (f.err) { socket.destroy(); return; }
      buf = buf.slice(f.consumed);
      if (f.op === 0x1) {                               // text (or start)
        partial = f.payload.toString("utf8");
        if (f.fin) { broadcast(partial, socket); partial = ""; }
      } else if (f.op === 0x0) {                        // continuation
        partial += f.payload.toString("utf8");
        if (f.fin) { broadcast(partial, socket); partial = ""; }
      } else if (f.op === 0x8) {                        // close
        socket.end();
        return;
      } else if (f.op === 0x9) {                        // ping -> pong
        socket.write(Buffer.concat([Buffer.from([0x8a]), Buffer.from([f.payload.length]), f.payload]));
      }
    }
  });
  socket.on("close", () => CLIENTS.delete(socket));
  socket.on("error", () => CLIENTS.delete(socket));
}

function serve(port) {
  const server = net.createServer(handle);
  server.listen(port, "127.0.0.1", () => {
    // Announce the BOUND port, not the requested one: "node relay.js 0"
    // (or a busy 8787 fallback) would otherwise print a URL that does not
    // connect. Measured 2026-09-01 -- the offline-kit test caught it.
    const actual = server.address().port;
    const mf = kitManifest();
    const ver = mf && mf.version
      ? "v" + mf.version + " (" + String(mf.source_commit || "").slice(0, 10) + ")"
      : "(unversioned kit -- no manifest.json beside relay.js)";
    console.log("tugofwar relay " + ver + " on ws://127.0.0.1:" + actual);
    console.log("  control room:            http://127.0.0.1:" + actual + "/");
    console.log("  OBS overlay URL:         http://127.0.0.1:" + actual + "/overlay.html");
    console.log("  control room relay box:  ws://127.0.0.1:" + actual);
  });
  server.on("error", (e) => { console.error("relay: " + e.message); process.exit(1); });
  return server;
}

// ---- self-test: two real sockets, real handshake, real broadcast ----------
function selftest() {
  const server = net.createServer(handle);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    const keyA = "aGVsbG8gd29ybGQ=", keyB = "c29tZS1yYW5kb20ta2V5";
    const BIG = "x".repeat(150);                        // exercises the 126-length path
    const mask = Buffer.from([1, 2, 3, 4]);
    function masked(payload) {
      const b = Buffer.from(payload, "utf8");
      const head = b.length < 126 ? [0x81, 0x80 | b.length]
        : [0x81, 0x80 | 126, (b.length >> 8) & 0xff, b.length & 0xff];
      const out = Buffer.alloc(head.length + 4 + b.length);
      head.forEach((v, i) => { out[i] = v; });
      mask.copy(out, head.length);
      for (let i = 0; i < b.length; i++) out[head.length + 4 + i] = b[i] ^ mask[i & 3];
      return out;
    }
    const a = net.connect(port, "127.0.0.1");
    const b = net.connect(port, "127.0.0.1");
    const fail = (why) => { console.error("SELF-TEST FAIL: " + why); process.exit(1); };
    let handshaken = false;
    let buf = Buffer.alloc(0);
    const got = [];
    // Decode frames the way a BROWSER does. The previous assertion was
    // body.includes("hello") -- a SUBSTRING over raw wire bytes, which a correct
    // frame and an unencoded raw-text write satisfy EQUALLY. So it could not
    // distinguish the 2026-09-02 broadcast defect from its fix: it stayed green
    // while every real client closed the socket on a protocol violation, and a
    // customer became the detector. Parse, and refuse anything that is not a
    // well-formed unmasked text frame.
    function drain() {
      for (;;) {
        if (buf.length < 2) return;
        if ((buf[0] & 0x80) === 0 || (buf[0] & 0x0f) !== 1) {
          fail("not a FIN text frame -- first byte 0x" + buf[0].toString(16) +
               " (an unencoded raw-text write looks exactly like this)");
          return;
        }
        if (buf[1] & 0x80) { fail("a server-to-client frame must not be masked"); return; }
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { fail("unexpected 64-bit length in this test"); return; }
        if (buf.length < off + len) return;
        got.push(buf.slice(off, off + len).toString("utf8"));
        buf = buf.slice(off + len);
      }
    }
    b.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!handshaken) {
        // Byte form, not an escape: this file is a template literal and every
        // backslash in it has to survive two extractors.
        const i = buf.indexOf(Buffer.from([13, 10, 13, 10]));
        if (i < 0) return;                              // header spanning chunks
        handshaken = true;
        buf = buf.slice(i + 4);
      }
      drain();
      // Compare DECODED payloads exactly -- never a substring of the wire.
      if (got.indexOf("hello") >= 0 && got.indexOf(BIG) >= 0) {
        server.close();
        console.log("SELF-TEST OK: handshake + masked broadcast + long frame (decoded)");
        process.exit(0);
      }
    });
    const hs = (k) => "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n" +
      "Connection: Upgrade\r\nSec-WebSocket-Key: " + k + "\r\nSec-WebSocket-Version: 13\r\n\r\n";
    a.on("connect", () => a.write(hs(keyA)));
    b.on("connect", () => {
      b.write(hs(keyB));
      setTimeout(() => { a.write(masked("hello")); a.write(masked(BIG)); }, 100);
    });
    a.on("error", (e) => fail("client A: " + e.message));
    b.on("error", (e) => fail("client B: " + e.message));
    setTimeout(() => fail("timeout — broadcast never arrived"), 5000);
  });
}

if (process.argv.includes("--selftest")) {
  selftest();
} else if (process.argv.includes("--version")) {
  const mf = kitManifest();
  console.log(mf && mf.version ? mf.version : "unversioned");
} else {
  const port = parseInt(process.argv[2] || "8787", 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error("bad port: " + process.argv[2]);
    process.exit(1);
  }
  serve(port);
}
