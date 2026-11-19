#!/bin/sh
set -e

install_dir='/opt/${sanitizedProductName}'
update-alternatives --install '/usr/bin/${executable}' '${executable}' "$install_dir/${executable}" 100

# A root namespace probe can succeed even when AppArmor blocks the desktop user.
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] ||
  ! runuser -u nobody -- unshare --user true 2>/dev/null; then
  chmod 4755 "$install_dir/chrome-sandbox"
else
  chmod 0755 "$install_dir/chrome-sandbox"
fi
