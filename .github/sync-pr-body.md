Automated sync of the published widget from the upstream origin.

Every fetched file was checked against the sha256 in `manifest.json`, the
relay's own `--selftest` passed, and the relay was started and proven to serve
the control room and the overlay over HTTP **before** this PR was opened. A
sync that fetched a truncated or tampered file opens no PR.

Merging replaces any hand-edits to the generated files. To change the widget
itself, open an issue here and it comes back through this lane.
