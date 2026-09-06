# Kick or Keep — TBAT stream widget

The donation tug-of-war graphic for **Kick or Keep**: a transparent OBS browser
source, an operator control room, and a tiny WebSocket relay that keeps the two
in step. It runs off a USB stick on the streaming rig with **no connection to
any platform, no account and no network**.

Kit version `2026.09.06.cc56e40` — see [`manifest.json`](manifest.json) for per-file hashes.

## Run the whole show — one command

```
node relay.js
```

That serves everything on port 8787:

| what | where |
|---|---|
| control room (the operator's tab) | http://127.0.0.1:8787/ |
| OBS browser source | http://127.0.0.1:8787/overlay.html |
| WebSocket relay | ws://127.0.0.1:8787 |

Node.js is the only requirement (free, nodejs.org). Prove the relay works
before air with `node relay.js --selftest` — it exits 0 only when two real
clients connect and a broadcast round-trips.

## Add it to OBS

Sources → **+** → **Browser**, 1920×1080, transparent:

```
http://127.0.0.1:8787/overlay.html?goal=10000&guarantee=120&big=2500&ws=ws://127.0.0.1:8787
```

The control room's **Copy** button produces exactly this URL with your own
settings already in it.

| parameter | meaning |
|---|---|
| `goal=` | cents of KICK needed to kick the guest (10000 = $100) |
| `guarantee=` | seconds of guaranteed airtime before a kick can land |
| `big=` | cents at which a donation pops its amount on screen |
| `left=` / `right=` | the two keywords (default `kick` / `keep`) |
| `ws=` / `poll=` | a live donation feed — see [EVENTS.md](EVENTS.md) |
| `theme=` | `tbat` (default), `aither`, `mono`, or four hex overrides |
| `demo=1` | synthesise donations, so it can be shown with no feed wired |

`goal`, `guarantee` and `big` have silent floors — 100 cents, 10 seconds and
1 cent. Asking for less is quietly raised, not refused, so a segment set below
one of them runs on a value nobody chose.

## The mechanic

- **KICK** donations fill the pot toward the goal.
- **KEEP** donations *raise the goal* — keepers are goalkeepers, and the two
  forces tug.
- When the pot meets the goal the guest is kicked — but **never before their
  guaranteed airtime**. If the goal is met during the guarantee the kick is
  PENDING, the timer counts it down, and keep donations can still save them.
- **The KICKED message then HOLDS until the operator presses play.** The next
  contestant sits down first; their clock starts when you start them. Donations
  that arrive during the pause are buffered and land on the next guest's board —
  never lost, never early.
- A donation naming **both** keywords, or **neither**, counts as a donation but
  not as a vote. The bar does not move.

## Wiring a real donation feed

[**EVENTS.md**](EVENTS.md) is the integration contract: exactly which fields the
overlay reads, how a side is chosen, how de-duplication works, the difference
between the `?ws=` and `?poll=` lanes, and the CORS requirement that `curl`
cannot test for you.

## Where these files come from

This repository is a **published copy**. The single source is
`overlay-html.ts` in the Aitherium monorepo, where the panel renders it, the
test suite evaluates it and the emitter extracts it — one copy, so a generated
twin can never drift from a hand-edited original.

**Edits made directly here are reverted by the next sync.** To change the
widget, open an issue on this repo or send it to the Aitherium team, and the
change flows back here automatically with a new version in `manifest.json`.

## Reporting a problem

Paste the version line that `node relay.js` prints on start — it names the
exact build, which is the difference between a five-minute fix and an hour of
guessing.
