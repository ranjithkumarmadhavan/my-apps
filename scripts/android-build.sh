#!/usr/bin/env bash
# Builds the signed SplitEasy Android app (Play bundle + installable APK) with Bubblewrap.
#   bash scripts/android-build.sh
# Outputs: android/spliteasy/app-release-bundle.aab (upload to Play) and app-release-signed.apk.
#
# Needs the toolchain in ~/.bubblewrap (JDK 17 + Android SDK, see CLAUDE.md) and the upload key in
# ~/.android-keys/spliteasy/. Bump appVersionCode/appVersionName in twa-manifest.json for each Play upload.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/android/spliteasy"
KEYDIR="$HOME/.android-keys/spliteasy"
JDK_BIN="$HOME/.bubblewrap/jdk/bin"

PW=$(sed -n 's/^Keystore password and key password (same): //p' "$KEYDIR/README-PASSWORD.txt")
[ ${#PW} -ge 16 ] || { echo "Upload key password not found in $KEYDIR/README-PASSWORD.txt" >&2; exit 1; }

cd "$PROJECT"
npx bubblewrap update --skipVersionUpgrade < /dev/null

# - jarsigner must be on PATH (it ships with the JDK).
# - Windows shells here set NoDefaultCurrentDirectoryInExePath, which hides gradlew.bat.
# - Bubblewrap prints the signing command (with passwords) when signing fails, so redact all output.
set +e
env -u NoDefaultCurrentDirectoryInExePath PATH="$JDK_BIN:$PATH" \
  BUBBLEWRAP_KEYSTORE_PASSWORD="$PW" BUBBLEWRAP_KEY_PASSWORD="$PW" \
  npx bubblewrap build --skipPwaValidation < /dev/null 2>&1 | sed "s/$PW/[REDACTED]/g" | tee build.log
status=${PIPESTATUS[0]}
set -e

# Stop the Gradle daemon so it doesn't keep build files locked (OneDrive folder).
env -u NoDefaultCurrentDirectoryInExePath JAVA_HOME="$HOME/.bubblewrap/jdk" ./gradlew.bat --stop > /dev/null 2>&1 || true

[ "$status" -eq 0 ] && "$JDK_BIN/keytool" -printcert -jarfile app-release-bundle.aab | grep "SHA256:"
exit "$status"
