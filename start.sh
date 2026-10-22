#!/usr/bin/env bash
# Creator Launch Kit starten (Linux).
cd "$(dirname "$0")" || exit 1

# Node aus nvm oder Homebrew finden, falls nicht im PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

pause_if_interactive() {
  if [ -t 0 ]; then
    echo
    read -r -p "Enter drücken zum Schließen …" _
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[FEHLER] Node.js ist nicht installiert."
  echo "Bitte die LTS-Version von https://nodejs.org installieren und danach erneut starten."
  pause_if_interactive
  exit 1
fi

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo
  echo "[FEHLER] Deine Node.js-Version ist zu alt: $(node -v)"
  echo "Benötigt wird mindestens 22.13. Bitte die LTS-Version von https://nodejs.org installieren."
  pause_if_interactive
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installiere benötigte Pakete (einmalig, dauert 1–2 Minuten) …"
  if ! npm install --no-fund --no-audit; then
    echo
    echo "[FEHLER] Die Pakete konnten nicht installiert werden. Internetverbindung prüfen und erneut starten."
    pause_if_interactive
    exit 1
  fi
fi

export OPEN_BROWSER="${OPEN_BROWSER:-1}"
echo
echo "Creator Launch Kit startet … Dashboard: http://localhost:3000"
echo "Dieses Fenster offen lassen. Beenden mit Strg+C."
echo
npm start
status=$?
if [ $status -ne 0 ] && [ $status -ne 130 ]; then
  echo
  echo "Das Programm wurde mit einem Fehler beendet (Code $status). Die Meldung steht oben."
  pause_if_interactive
fi
exit $status
