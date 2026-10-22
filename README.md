# Wonder Wars – Tester-Bot

Discord-Bot für den Spieltester-Server von **Wonder Wars** (Roblox).

- **Bewerbung:** Regeln + „Bewerben“-Button. Abgefragt werden nur Roblox-Name, Altersgruppe, Geräte, wie oft man spielt und optional die Motivation. Das Team nimmt per Button an oder lehnt ab.
- **Kein „Verify“ nötig:** Der Roblox-Name aus der Bewerbung reicht. Das Spiel meldet Spielzeit und Werte über die Roblox-ID, der Bot ordnet sie dem Tester zu.
- **Playtests:** Termin ankündigen, Tester melden sich an, Erinnerung 15 Minuten vorher, automatische Auswertung, wer wie lange gespielt hat.
- **Rangliste & Profil:** Spielzeit und alle Werte, die das Spiel meldet (z. B. Kills, Siege).
- **Giveaways:**
  - *Verlosung* mit Bedingungen, z. B. „mindestens 15 Min. beim Playtest gespielt“, optional mit Extra-Losen für Playtests und Bug-Reports.
  - *Rangliste*, z. B. „Platz 1–3 nach Spielzeit in 5 Tagen gewinnen“.
- **Bug-Reports:** `/bug` öffnet ein Formular (inkl. Screenshot). Jeder Bug wird ein eigener Beitrag, das Team setzt den Status per Button und der Melder bekommt Bescheid, wenn er behoben ist.

---

## Befehle

| Befehl | Wer | Was |
|---|---|---|
| `/setup einstellungen` | Team | Tester-Rolle, Team-Rolle und Kanäle festlegen |
| `/setup bewerbungs-panel` | Team | Regeln mit „Bewerben“-Button in den aktuellen Kanal posten |
| `/tester hinzufuegen` / `entfernen` / `anzahl` | Team | Tester direkt aufnehmen, entfernen, zählen |
| `/playtest erstellen` | Team | z. B. `start: 24.10.2026 18:00`, `dauer: 60`, `mindestzeit: 15` |
| `/playtest liste` / `auswertung` / `absagen` | Team | |
| `/giveaway verlosung` | Team | z. B. `preis: Discord-Deko`, `dauer: 3d`, `playtest: #1`, `gewichtet: ja` |
| `/giveaway rangliste` | Team | z. B. `preis: Discord-Deko`, `tage: 5`, `wert: spielzeit`, `plaetze: 3` |
| `/giveaway beenden` / `neu-auslosen` / `liste` | Team | |
| `/profil` | alle | Eigenes Profil oder `nutzer:` / `roblox:` |
| `/rangliste` | alle | `wert:` (Standard Spielzeit), `tage:` (Standard 7, 0 = gesamt) |
| `/bug` | Tester | Bug melden |

„Team“-Befehle sieht standardmäßig nur, wer **Server verwalten** darf. Für eine Team-Rolle freischalten:
*Servereinstellungen → Integrationen → Bot → Befehle*.

---

## Einrichtung

### 1. Bot bei Discord anlegen

1. Auf <https://discord.com/developers/applications> → **New Application** → Name z. B. „Wonder Wars Bot“.
2. Links **Bot** → **Reset Token** → Token kopieren (das ist `DISCORD_TOKEN`). Niemandem zeigen!
3. Links **General Information** → **Application ID** kopieren (das ist `DISCORD_CLIENT_ID`).
4. Bot auf deinen Server einladen (Application ID einsetzen):
   ```
   https://discord.com/oauth2/authorize?client_id=DEINE_APPLICATION_ID&scope=bot+applications.commands&permissions=326686198784
   ```
5. In Discord: *Einstellungen → Erweitert → Entwicklermodus* an. Dann Rechtsklick auf deinen Server → **Server-ID kopieren** (das ist `DISCORD_GUILD_ID`).
6. *Servereinstellungen → Rollen:* Die Rolle des Bots **über** die Tester-Rolle ziehen, sonst kann er sie nicht vergeben.

### 2. Bot starten

Benötigt [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
cp .env.example .env      # dann .env ausfüllen
npm run deploy-commands   # Befehle bei Discord anmelden (nach Änderungen an Befehlen erneut)
npm start
```

### 3. Auf dem Discord-Server einrichten

Der Bot nutzt deine vorhandenen Kanäle und Rollen und legt nichts selbst an.

1. `/setup einstellungen` und auswählen:
   - **tester-rolle:** die Rolle für angenommene Tester
   - **bewerbungen-kanal:** ein *privater* Team-Kanal (Bewerbungen und „Preis verschicken an …“)
   - **ankuendigungen-kanal:** wo Playtests und Giveaways erscheinen
   - **bug-kanal:** am besten ein Forum-Kanal
   - **team-rolle** (optional): wer Bewerbungen und Bugs bearbeiten darf
2. In den Kanal gehen, in dem man sich bewerben soll, und `/setup bewerbungs-panel` ausführen.

### 4. Roblox-Spiel anbinden

Damit Spielzeit und Werte ankommen, muss der Bot **von außen per HTTPS erreichbar** sein (siehe „Hosting“).

1. In Roblox Studio: *Game Settings → Security → Allow HTTP Requests* einschalten.
2. Im [Creator Dashboard](https://create.roblox.com/dashboard/creations) → dein Spiel → **Secrets** → neues Secret:
   - Name: `WW_BOT_API_KEY`
   - Wert: derselbe Wert wie `GAME_API_KEY` in der `.env`
   - Domain: die Adresse deines Bots, z. B. `dein-bot.example.com`
3. In `ServerScriptService`:
   - einen **ModuleScript** `WonderWarsTracker` mit dem Inhalt von [`roblox/WonderWarsTracker.lua`](roblox/WonderWarsTracker.lua)
   - ein **Script** `WonderWarsTrackerStart` mit dem Inhalt von [`roblox/WonderWarsTrackerStart.server.lua`](roblox/WonderWarsTrackerStart.server.lua)
4. In `WonderWarsTracker` oben bei `API_URL` die Adresse eintragen, z. B. `https://dein-bot.example.com/api/v1/report`.
5. Werte aus deinen eigenen Skripten melden:
   ```lua
   local Tracker = require(game.ServerScriptService.WonderWarsTracker)
   Tracker.AddStat(player, "kills", 1)
   Tracker.AddStat(player, "siege", 1)
   ```
   Die Spielzeit wird automatisch gezählt. Neue Werte tauchen automatisch in `/rangliste` und bei `/giveaway rangliste` auf.

Test: `https://dein-bot.example.com/api/v1/health` im Browser öffnen, dort sollte `{"ok":true}` stehen.

### Hosting

Der Bot muss rund um die Uhr laufen, und Roblox muss ihn per HTTPS erreichen. Möglichkeiten:

- **Kleiner VPS** (z. B. Hetzner, ca. 4–5 €/Monat) mit [Caddy](https://caddyserver.com) davor. Caddy holt automatisch ein HTTPS-Zertifikat.
- **Railway / Render / Fly.io:** Diese geben dir direkt eine HTTPS-Adresse. Wichtig: dauerhaften Speicher (Volume) für den Ordner `data/` einrichten, sonst ist die Datenbank nach jedem Neustart weg.

---

## Gut zu wissen

- **Datenschutz:** Gespeichert werden Discord-ID, Roblox-Name und -ID, Altersgruppe (nicht das genaue Alter), Geräte, Spielzeit und Spielwerte. Kein Passwort, kein Login.
- **Fremder Roblox-Name:** Jemand könnte bei der Bewerbung den Namen eines anderen eintragen. Ein Roblox-Account kann aber nur bei einem Tester eingetragen sein, und das Team sieht in der Bewerbung Profil und Account-Alter. Bei Giveaways mit wertvollen Preisen lohnt sich ein kurzer Blick, ob der Gewinner wirklich der Account-Besitzer ist.
- **Preise verschicken:** Der Bot lost aus und schreibt in den Team-Kanal, wer gewonnen hat. Den Preis (z. B. Discord-Deko) schickst du selbst. Meldet sich jemand nicht: `/giveaway neu-auslosen`.

## Entwicklung

```bash
npm test
```

Aufbau:

```
src/
  index.js              Start: Bot, Spiel-Schnittstelle, Zeitplaner
  api.js                HTTP-Schnittstelle für das Roblox-Spiel
  db.js                 Datenbank (SQLite)
  commands.js           Slash-Befehle
  interactions.js       Verteilt Befehle, Buttons, Formulare
  features/             Bewerbung, Playtests, Giveaways, Bugs, Profil/Rangliste, Admin
roblox/                 Skripte für das Spiel
test/                   Tests
```
