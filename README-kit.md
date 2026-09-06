# Tug-of-War donation overlay -- operator kit

Kit version **2026.09.06.659f16f** (commit `659f16fd5f`)

This is the whole show in one folder: the graphic OBS displays, the page you
drive it from, and the small program that connects them. It runs off a USB
stick. It never talks to the internet, and there is no account to log into.

You need Node.js on the machine running the stream (free, from nodejs.org).
On Windows, open this folder, hold Shift, right-click an empty space, and
choose "Open PowerShell window here".


## 1. Start it

    node relay.js

Leave that window open -- closing it stops the show. It runs everything on
port 8787:

  - the CONTROL ROOM      http://127.0.0.1:8787/
  - the OBS OVERLAY       http://127.0.0.1:8787/overlay.html

Open the control room in a browser tab. That is the page you drive from.

Port 8787 already in use? `node relay.js 9001` uses another one, and prints
the address to use. Want to check it works before you are live?
`node relay.js --selftest` -- it says SELF-TEST OK or tells you what failed.


## 2. Put the graphic in OBS

In OBS: Sources > + > Browser. Set it to 1920x1080 and tick transparent.
For the URL, use the control room's **Copy** button -- it builds the exact
address with your own settings already in it.

It looks like this:

    http://127.0.0.1:8787/overlay.html?goal=10000&guarantee=120&big=2500&ws=ws://127.0.0.1:8787

If you ever type one by hand:

  goal=       how much KICK money it takes to kick the guest, in cents
              (10000 = $100). Minimum 100 (= $1).
  guarantee=  how long the guest is safe on air no matter what, in seconds.
              Minimum 10.
  big=        a donation this size or larger flashes its amount on screen,
              in cents (2500 = $25). Minimum 1.
  ws=         the address the control room uses. Leave it out and the graphic
              runs on its own, which is only useful for testing.

Type a number below one of those minimums and it is quietly raised to the
minimum rather than refused -- so if a setting seems to be ignored, that is
why.


## 3. How the game works

KICK donations fill the pot. KEEP donations push the goal further away, so
the keepers are defending. When the pot reaches the goal the guest is kicked,
but never before their guaranteed time is up -- if the goal is reached early
the kick is PENDING, the timer counts it down, and keep donations can still
save them.

When a guest is kicked, the KICKED message stays on screen. Nothing moves on:
no timer, no new guest, no reset. The next contestant sits down, and then you
press **NEXT GUEST READY -- START THEM** in the control room. Their clock
starts when you start them.

Donations that arrive while that message is up are not lost and are not
counted against the guest who just left. They land on the next guest's board
the moment you press the button.


## 4. When nothing is happening

The control room always shows what OBS is actually doing. If a button does
not seem to work, read the line under the relay box first.

  "relay: connected"
      Everything is fine; OBS is following this page.

  "relay: DISCONNECTED -- OBS is not following these buttons"
      The connection dropped, usually because the `node relay.js` window was
      closed or the machine slept. It retries every few seconds on its own.
      If it does not come back, start `node relay.js` again and reload the
      OBS browser source.

  "relay: NOT SENT ... -- OBS did not get that"
      You pressed something while the connection was down, so it changed this
      page but not the graphic on air. Wait for "connected" and press it
      again.

  The graphic shows "ws: reconnecting"
      The OBS copy lost the connection and is trying to get it back. Same
      cause and same fix as DISCONNECTED.

  The KICKED message will not go away
      That is deliberate -- it waits for you. Press NEXT GUEST READY. If the
      button is not showing, the control room is not connected to the copy in
      OBS: check the relay line above.

  Nothing at all on screen in OBS
      Check the browser source URL and that the `node relay.js` window is
      still open. Right-click the source and Refresh.


## 5. Reporting a problem

Paste the version line that `node relay.js` prints when it starts (or run
`node relay.js --version`). It names the exact build, which is the difference
between a quick fix and an hour of guessing.

To check your download arrived intact: `sha256sum -c kit.zip.sha256`
(PowerShell: `Get-FileHash kit.zip`). Per-file hashes are in `manifest.json`.
