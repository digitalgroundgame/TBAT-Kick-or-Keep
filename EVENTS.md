# Event contract -- what the overlay actually reads

Written for whoever wires a donation feed to this graphic. Every statement here
is a description of the shipped `overlay.html` in this same kit, not a plan.

The overlay is deliberately dumb about your platform: it never authenticates,
never calls your API, and knows nothing about donors. It reads **an amount and
a piece of text**, decides which side the text voted for, and moves the bar.
Everything else in an event is ignored.

## 1. The three doors, and the one difference that matters

| door | how it is turned on | what it accepts |
|---|---|---|
| `postMessage` | always on | the FULL envelope (donations + operator control) |
| WebSocket | `?ws=ws://host:port` | the FULL envelope (donations + operator control) |
| HTTP poll | `?poll=https://host/path` | **donations only** |

**The poll lane cannot carry operator control.** Polled items go straight to the
donation path, so `play`, `reset`, `clear`, `window` and `setgoal` sent that way
are silently ignored -- they are not errors and nothing will log them. Use the
relay (`?ws=`) for anything the operator drives; use `?poll=` for money only.

## 2. A donation event: the four fields that are read

```json
{ "id": "abc123", "amount_cents": 2500, "message": "kick him" }
```

| field | required | what happens |
|---|---|---|
| `id` | optional -- but see section 4 | de-duplication key. A repeat is DROPPED. |
| `amount_cents` | one of the two | integer cents, rounded. Must be > 0. **Wins over `amount`.** |
| `amount` | one of the two | DOLLARS, converted with `round(amount * 100)`. |
| `message` | yes, in effect | the text a side is read from. |
| `comment` | alternative | used when `message` is absent. |
| `note` | alternative | used when `message` and `comment` are absent. |

They are tried in the order `message`, `comment`, `note`, and the first one
**present** wins -- an explicit empty string counts as present and scores
nothing. Anything else in the object (donor name, currency, avatar, tier,
timestamps) is ignored: not rejected, just never read.

An event with no usable amount, or with text that names no side, is **not an
error**. It is a donation that was not a vote. The bar does not move and the
overlay stays silent about it.

## 3. How a side is chosen

The text is lowercased and each keyword is matched on a WORD BOUNDARY:

    (^|[^a-z0-9]) kick ([^a-z0-9]|$)

- kick only -> fills the POT (pulls the line toward the kick).
- keep only -> raises the GOAL (the goalkeepers push it back).
- **neither, or BOTH -> not a vote.** "kick or keep?" scores nothing, on purpose.

The boundary is why `kickoff`, `sidekick` and `keepsake` do not score: a donor
who typed an ordinary word is never dragged onto a side they did not pick.
Keywords are configurable per segment with `&left=` and `&right=`.

## 4. Re-delivery is expected -- send an id

The overlay marks an `id` the moment the event arrives and drops any repeat.
That is what makes the poll lane safe: your endpoint should return a **rolling
window** (the last N events, or the last few minutes) rather than only what is
new since some cursor. Re-sending the same rows every 5 seconds is the intended
usage; double-counting a $500 donation on air is not recoverable, and the id is
the only thing preventing it.

An event with **no** `id` is always counted, every time it arrives. For a polled
feed that means a rolling window without ids will multiply every donation by the
number of polls it appears in. Send ids.

## 5. The poll lane in detail

    fetch(url, { cache: "no-store" })   every 5000 ms

- **Both response shapes are accepted:** a bare array `[ {...}, {...} ]`, or an
  object `{ "events": [ {...} ] }`. Any other shape reads as zero events.
- **Non-2xx skips the whole batch** and shows `poll: HTTP <code>` in the
  overlay's status corner. A network or JSON failure shows `poll: unreachable`.
- The interval is fixed. There is no backoff, and a slow response does not delay
  the next tick -- a consistently slow endpoint will be re-entered.
- **CORS applies.** This is a browser fetch from the OBS page, so a
  cross-origin endpoint MUST send `Access-Control-Allow-Origin`. `curl` against
  your endpoint proves nothing about this: curl does not enforce CORS, so an
  endpoint that answers curl perfectly can be completely unusable from OBS. Test
  it in a browser tab, or watch the overlay's status corner.

A minimal endpoint answers:

```json
{ "events": [
  { "id": "evt-1041", "amount_cents": 500,  "message": "KICK" },
  { "id": "evt-1042", "amount": 25.00,      "message": "keep him on!" },
  { "id": "evt-1043", "amount_cents": 1000, "message": "love the show" }
] }
```

That is $5 to the pot, $25 onto the goal, and a $10 donation that was not a vote.

## 6. The WebSocket lane in detail

One JSON object per frame. Both of these are accepted for a donation:

```json
{ "type": "donation", "payload": { "id": "d-9", "amount_cents": 500, "message": "kick" } }
{ "type": "donation", "id": "d-9", "amount_cents": 500, "message": "kick" }
```

An unparseable frame is ignored silently. The socket reconnects every 3 seconds
after a drop and shows `ws: reconnecting` while it is down. The bundled
`relay.js` broadcasts each frame to every OTHER client, so the control room and
the OBS copy stay in step without echoing back to the sender.

## 7. Operator control (postMessage and WebSocket only)

| envelope | effect |
|---|---|
| `{"type":"play"}` | the next contestant is seated -- see below |
| `{"type":"reset"}` | identical to `play` (the control room's "New guest") |
| `{"type":"clear"}` | fresh pot and goal for the SAME guest; the guest counter does not move |
| `{"type":"window"}` | restart the guaranteed airtime for the current guest |
| `{"type":"setgoal","goal_cents":50000}` | set the goal outright (`goal` also accepted) |
| `{"type":"snapshot"}` | ask for the live state; the reply is posted back to the sender |

`play` (and its twin `reset`) does four things in one: it clears a held KICKED
splash, resets the board, starts the new guest's clock from that moment, and
lands every donation buffered during the hold onto the fresh board.

**While the KICKED splash is held, `clear` and `window` do nothing.** Only
`play`/`reset` end a hold -- the operator explicitly starting the next guest.
That is deliberate: a mis-click must not clear the splash the hold exists to
keep on screen, and a `window` during a hold would otherwise resume the guest
who was just kicked and count them as kicked a second time.

## 8. The snapshot reply

```json
{ "type": "snapshot", "payload": {
  "pot": 4500, "goal": 10000, "guest": 3, "kicked": 2,
  "kickPending": null, "held": false,
  "guestStart": 1757183000000, "now": 1757183042000, "guarantee": 120000
} }
```

`held` is true while the KICKED message is up and the board is frozen between
guests -- that is the flag the control room's play button is drawn from. All
amounts are integer CENTS and all times are epoch milliseconds. `guarantee` is
sent so a control surface never hardcodes its own copy of the segment length.

## 9. Query parameters are CLAMPED, not rejected

Three settings have a silent floor. Asking for less does not fail and does not
warn -- it is quietly raised, so a segment configured below one of these runs
with a value nobody chose:

| parameter | floor | asking for less gives you |
|---|---|---|
| `goal` | 100 cents ($1) | 100 |
| `guarantee` | 10 seconds | 10 |
| `big` | 1 cent | 1 |

An unparseable value falls back to the default (goal 10000, guarantee 120,
big 2500) rather than the floor.

## 10. What the overlay never does

It sends no requests except the poll you configure, stores nothing, carries no
credentials, and reads no donor identity. If your platform can produce a public
JSON endpoint of recent donations, or push JSON frames at a socket, it can drive
this graphic -- and nothing else about your platform has to be exposed.
