#!/usr/bin/env bash
#
# Install or update the server-side pieces of the gravindex deployment.
#
# Run as root ON THE SERVER, from a checkout of this repository:
#
#     sudo deploy/server/install.sh
#
# It is idempotent: every file is overwritten and systemd is reloaded. It does
# NOT install Docker, create the deploy user, write `.env` or clone the
# repository — those are bootstrap steps documented in `deploy/README.md`,
# because they happen once and involve decisions (keys, passwords) that do not
# belong in a script.
#
# ⚠️ The deploy script and the units are root-owned and are NOT updated by a
# `git checkout` of a tag. Updating them is a deliberate `git pull` on the
# `develop` branch followed by this script, never a side effect of a deploy.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || {
  echo "install.sh: must run as root" >&2
  exit 1
}

install -m 0755 "$HERE/gravindex-deploy.sh" /usr/local/bin/gravindex-deploy
install -m 0755 "$HERE/gravindex-watchdog.sh" /usr/local/bin/gravindex-watchdog
install -m 0755 "$HERE/gravindex-backup.sh" /usr/local/bin/gravindex-backup
install -m 0755 "$HERE/gravindex-send-backup.py" /usr/local/bin/gravindex-send-backup
install -m 0755 "$HERE/gravindex-heartbeat.sh" /usr/local/bin/gravindex-heartbeat

install -m 0644 "$HERE/gravindex.service" /etc/systemd/system/gravindex.service
install -m 0644 "$HERE/gravindex-watchdog.service" /etc/systemd/system/gravindex-watchdog.service
install -m 0644 "$HERE/gravindex-watchdog.timer" /etc/systemd/system/gravindex-watchdog.timer
install -m 0644 "$HERE/gravindex-backup.service" /etc/systemd/system/gravindex-backup.service
install -m 0644 "$HERE/gravindex-backup.timer" /etc/systemd/system/gravindex-backup.timer
install -m 0644 "$HERE/gravindex-heartbeat.service" /etc/systemd/system/gravindex-heartbeat.service
install -m 0644 "$HERE/gravindex-heartbeat.timer" /etc/systemd/system/gravindex-heartbeat.timer

# The two environment files the units above expect. They hold secrets (the
# healthchecks.io ping URL, the SMTP password) and are NOT part of this
# repository; `deploy/README.md` documents what goes in each. Creating them
# empty and root-only means the units start, log that they are unconfigured and
# do nothing, rather than failing.
install -d -m 0700 /etc/gravindex
for file in heartbeat.env mail.env; do
  if [ ! -e "/etc/gravindex/$file" ]; then
    install -m 0600 /dev/null "/etc/gravindex/$file"
  fi
done

systemctl daemon-reload

# ⚠️ `enable`, not `enable --now`: on a fresh server the image may not exist
# yet, and the first `gravindex-deploy` is what starts the stack. Enabling it
# here is what makes it come back on the next boot.
systemctl enable gravindex.service
systemctl enable --now gravindex-watchdog.timer
systemctl enable --now gravindex-backup.timer
systemctl enable --now gravindex-heartbeat.timer

echo "install.sh: installed. Timers:"
systemctl list-timers --no-pager gravindex-watchdog.timer gravindex-backup.timer gravindex-heartbeat.timer
