# CLAUDE.md – Hinweise für Claude Code in diesem Repo

## Worum es geht

**Creator Launch Kit** für den Launch eines Roblox-Spiels (Team-Shooter mit Turmbau-Rennen):

- **Creator Radar** (Dashboard unter http://localhost:3000): findet kleine Roblox-Creator (YouTube- und Twitch-API, TikTok/Instagram per Lesezeichen oder Import), bewertet sie, bereitet Nachrichten vor und verfolgt die Antworten. **Gesendet wird immer von Hand durch den Nutzer.**
- **Creator HQ** (Discord-Bot, **optional, Standard aus**): `/setup`, Creator-Bewerbungen, persönliche Einladungslinks, Creator-Codes, Live-Meldungen, Ranglisten, Playtests, Bug-Meldungen, Launch-/Wochen-Events. Nur sinnvoll, wenn ein Rechner dauerhaft läuft. Einschalten: Dashboard → Einstellungen → Discord → „Discord-Bot verwenden“ (`discord.useBot`).
- **Discord ohne Bot** (der Normalfall): Onboarding, Events, Forum-Kanal und Google-Formulare – Anleitung und Texte in [docs/DISCORD-OHNE-BOT.md](docs/DISCORD-OHNE-BOT.md).

Das Tool muss **nicht dauernd laufen**. Der Nutzer startet es nur, wenn er Creator sucht oder anschreibt.

Der Nutzer spricht Deutsch. Antworte auf Deutsch, kurz und ohne Fachjargon.

Das Roblox-Spiel selbst ist **nicht** Teil dieses Repos. Ändere am Spiel nichts, außer der Nutzer bittet ausdrücklich darum.

## Befehle

```bash
npm install          # Pakete installieren (discord.js, express, eld)
npm start            # Dashboard starten (http://localhost:3000); Bot nur, wenn eingeschaltet
npm test             # alle Tests (node:test)
npm run check        # Checkliste: was ist noch nicht eingerichtet?
npm run discover:youtube   # YouTube-Suche einmal laufen lassen
npm run discover:twitch    # Twitch-Suche einmal laufen lassen
npm run retention          # Aufräumen nach den Aufbewahrungsregeln
```

Voraussetzung: Node.js ≥ 22.13 (nutzt das eingebaute `node:sqlite`, kein Kompilieren nötig).

## Wo Einstellungen liegen

| Was | Wo |
|---|---|
| Zugangsdaten (Discord-Token, YouTube-Schlüssel, Twitch-ID/-Secret, Dashboard-Passwort) | `.env` (Vorlage `.env.example`) oder Dashboard → Einrichtung |
| Spiel, Launch-Termin, Limits, Discord-IDs, Punkte | Datenbank-Tabelle `settings` (Defaults: `src/core/settings.js`), bearbeitbar im Dashboard → Einstellungen |
| Creator, Pipeline, Vorlagen, Playtests usw. | `data/radar.db` (SQLite) |
| Logs | `data/logs/app.log` |

`data/` und `.env` sind in `.gitignore` und dürfen **nie** committet werden.

Einstellungen per API ändern (das Tool muss laufen; ändernde Anfragen brauchen den Header `X-CLK: 1`):

```bash
curl -X PUT http://localhost:3000/api/settings -H "X-CLK: 1" -H "Content-Type: application/json" \
  -d '{"game":{"name":"Tower Rush","pitch_de":"…","pitch_en":"…","launchDate":"31.10.2026","launchTime":"19:00","senderName":"Robert","studioName":"…","privacyUrl":"https://…"}}'
curl http://localhost:3000/api/status    # Checkliste, Bot-Status, Kontingent
```

## So hilfst du bei der Einrichtung

Führe den Nutzer durch [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md) und frag nach diesen Werten:

1. **Spiel:** Name, 1–2 Sätze Beschreibung auf Deutsch und Englisch, Roblox-Spiel-Link, Launch-Datum und -Uhrzeit (nach Absprache, Vorschlag: Sa 31.10.2026, 19:00 MEZ; Playtests Sa 24.10. und So 25.10.; danach Samstags-Events). Zeitplan: [docs/LAUNCH-PLAYBOOK.md](docs/LAUNCH-PLAYBOOK.md).
2. **Absender:** Name, Studio-Name, Studio-E-Mail.
3. **Links:** allgemeiner Discord-Einladungslink (steht in den Nachrichten). Datenschutzerklärung **empfohlen** – ein Google-Doc mit „Jeder mit dem Link kann ansehen“ reicht; ohne Link setzt das Tool einen kurzen Datenschutz-Hinweis in die Nachricht. Infoseite und Impressum **optional** (ohne Infoseite verlinken die Nachrichten das Roblox-Spiel).
4. **Belohnung für den Creator-Code** (was Zuschauer bekommen; muss ein Ingame-Item ohne Echtgeldwert sein, das man nicht kaufen kann).
5. **Zugangsdaten:** YouTube-API-Schlüssel, optional Twitch Client-ID + Secret. Discord-Bot-Token nur, wenn der Bot genutzt wird.

**Zugangsdaten nie im Chat erfragen.** Bitte den Nutzer, sie selbst im Dashboard unter „Einrichtung“ oder in `.env` einzutragen. Gibt der Nutzer trotzdem einen Schlüssel im Chat an: nur in `.env` schreiben, nie wiederholen, nie loggen, nie committen.

Danach: Discord mit Bordmitteln einrichten ([docs/DISCORD-OHNE-BOT.md](docs/DISCORD-OHNE-BOT.md)), Roblox-Spiel im Dashboard verknüpfen, `npm run check` zur Kontrolle. Nur mit Bot: Bot einladen (Button im Dashboard) und im Discord `/setup` ausführen.

## Architektur in Kürze

Ein Node.js-Prozess (ESM, kein Build). Genaue Schnittstellen: **[docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)** – das ist der verbindliche Vertrag.

- `src/core/` – Datenbank (`db.js`, Schema in `schema.js`), Einstellungen, `.env`, Creator-/Pipeline-Funktionen (`creators.js`), Link-Erkennung (`urls.js`), Punkte, Zeit-Helfer, Zeitplaner.
- `src/radar/` – YouTube/Twitch-Suche, Anreicherung, Bewertung, Vorlagen (`default-templates.js`), Senden-Warteschlange, Import, Aufbewahrung.
- `src/web/` – Express-Server, API unter `/api`, Oberfläche in `public/` (Vanilla JS).
- `src/bot/` – Discord-Bot-Kern (`index.js`), Module in `modules/` (eine Datei pro Funktion).
- `test/` – Tests mit `node:test`. Netz nie echt aufrufen (fetch ersetzen), DB mit `openDb(':memory:')`.

Konventionen: Zeitstempel ISO-UTC, DB-Parameter `:name`, `db.tx()` ist synchron, Texte für Nutzer auf Deutsch (Bot zusätzlich Englisch nach `interaction.locale`). Keine neuen npm-Pakete ohne Rückfrage.

## Leitplanken (nicht verhandelbar)

- **Kein automatisches Senden** von Nachrichten an Creator (keine Massen-DMs, keine Bots für TikTok/Instagram/E-Mail). Das Tool öffnet nur Fenster und kopiert Text.
- **Kein Scraping** von TikTok, Instagram oder YouTube-Webseiten. Nur offizielle APIs (YouTube Data API, Twitch Helix) und Daten, die der Nutzer selbst erfasst.
- **Kontaktweg-Ampel:** nur öffentliche (Business-)Mail, DM nur bei ausdrücklicher Einladung im Profil, sonst der eigene Discord des Creators – sonst gar nicht (§ 7 UWG).
- **Minderjährige:** unter 13 keine Aufnahme; unter 16 nur mit Eltern-OK; bezahlte Deals nur ab 18; keine privaten Chats mit Minderjährigen.
- **Keine Robux- oder Geldpreise, keine Gewinnspiele** (Roblox Community Standards). Belohnungen: Ingame-Items ohne Echtgeldwert, Titel, Ränge, früher Zugang. Keine Belohnung für Likes/Favoriten.
- **Werbekennzeichnung:** Creator-Inhalte mit Gegenleistung tragen „Werbung“. Keine Kauf-Aufrufe an Kinder.
- **Daten:** YouTube-Daten spätestens nach 30 Tagen aktualisieren/löschen, Abmeldungen sofort umsetzen, Kontaktlisten nie verkaufen oder weitergeben.
- **Secrets** nie in Git, Logs, Oberfläche oder Chat.
