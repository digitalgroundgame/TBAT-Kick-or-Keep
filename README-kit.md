# Tug-of-War donation overlay -- operator kit

Kit version **2026.09.06.0b42377** -- built from commit `0b42377aa4` (2026-09-06).
Verify your download: `sha256sum -c kit.zip.sha256` (PowerShell: `Get-FileHash kit.zip`); per-file hashes are in `manifest.json`.
When reporting a problem, paste the version line `node relay.js` prints (or run `node relay.js --version`).

Everything needed to run the graphic on a stream, with NO connection to
Aitherium or any platform. Works off a USB stick on the rig.

Requires Node.js on the machine that runs the show (free, nodejs.org).
On a Windows rig, open the folder and shift-right-click > "Open PowerShell
window here".

## 1. Run the kit (ONE command, on the rig)

    node relay.js

That single command runs the WHOLE show on one port (8787):

  - the CONTROL ROOM at  http://127.0.0.1:8787/
      (open it in a browser tab -- every button broadcasts to OBS)
  - the OBS OVERLAY at   http://127.0.0.1:8787/overlay.html
  - the websocket relay on the same port

Different port: `node relay.js 9001`. Prove it works first:
`node relay.js --selftest` (exits 0 only when both clients connect).

## 2. Add the overlay to OBS

OBS > Sources > + > Browser (1920x1080, transparent). URL:

    http://127.0.0.1:8787/overlay.html?goal=10000&guarantee=120&big=2500&ws=ws://127.0.0.1:8787

(The control room's Copy button produces exactly this URL for you, with your
goal/guarantee/big and relay box values in it.)

  goal=      cents of KICK donations needed to kick the guest (10000 = $100)
  guarantee= seconds of guaranteed airtime before a kick can land
  big=       cents at which a donation pops its amount on screen

Each of those has a silent floor -- goal 100 (=$1), guarantee 10 seconds,
big 1 -- so asking for less is quietly raised rather than refused.
  ws=        the relay URL -- omit it and the overlay runs alone (demo/self-test)

KEEP donations RAISE the goal; when KICK fills it the guest is kicked (never
before the guarantee). The KICKED message then HOLDS until you press the
play button in the control room -- the next contestant sits down first, and
their clock starts when you start them (donations during the pause are
buffered onto the next guest).

## 3. Drive the show

Control room at http://127.0.0.1:8787/ (browser tab). Paste the same relay
URL into the relay box if it is not already there -- every button then drives
the OBS copy too, donations included. The overlay's own demo buttons are for
testing; remove that browser source before air.
