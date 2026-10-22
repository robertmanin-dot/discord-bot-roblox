# Einrichtung – Schritt für Schritt

Plane etwa 30–45 Minuten ein. Die Startseite im Dashboard zeigt dir jederzeit, was noch fehlt.
Im Terminal geht das auch mit `npm run check`.

**Wichtig:** Zugangsdaten (Tokens, Schlüssel, Secrets) trägst du **nur** im Dashboard unter „Einrichtung“
oder in der Datei `.env` ein. Nie in Chats, Screenshots oder Git.

---

## 1. Node.js installieren

1. Auf [nodejs.org](https://nodejs.org) die **LTS-Version** herunterladen und installieren (mindestens 22.13).
2. Prüfen: Terminal bzw. Eingabeaufforderung öffnen, `node -v` eingeben. Es sollte `v22.13` oder höher erscheinen.

## 2. Projekt holen und starten

**Variante A – ohne Git:**
1. Auf GitHub das Repo `robertmanin-dot/discord-bot-roblox` öffnen.
2. Solange die Änderungen noch nicht im Haupt-Branch sind: oben links den Branch `claude/exciting-babbage-m1e4hy` wählen.
3. „Code“ → „Download ZIP“, entpacken (z. B. nach `Dokumente/creator-launch-kit`).

**Variante B – mit Git:**
```bash
git clone https://github.com/robertmanin-dot/discord-bot-roblox.git
cd discord-bot-roblox
git checkout claude/exciting-babbage-m1e4hy   # nur nötig, solange nicht in main
```

**Starten:**
- Windows: Doppelklick auf `start.bat`
- macOS: Doppelklick auf `start.command` (beim ersten Mal Rechtsklick → „Öffnen“)
- Linux: `./start.sh`

Beim ersten Start werden die Pakete installiert (1–2 Minuten). Danach öffnet sich **http://localhost:3000**.
Das Fenster offen lassen – schließt du es, sind Dashboard und Bot aus.

## 3. Spiel-Infos eintragen

Dashboard → **Einstellungen**:

| Feld | Beispiel |
|---|---|
| Spielname | Tower Rush |
| Kurzbeschreibung (DE) | Ein Team-Shooter, bei dem ihr um die Blöcke in der Mitte kämpft. Wer zuerst seinen Turm fertig hat, gewinnt. |
| Kurzbeschreibung (EN) | A team shooter where you fight over the blocks in the middle. First team to finish their tower wins. |
| Launch-Termin | 21.11.2026, 19:00 (Zeitzone Europe/Berlin) |
| Absendername / Studio | Robert / Name deines Studios |
| Studio-E-Mail | creators@deine-domain.de |
| Infoseite für Creator | Link zu deiner Seite „Founding Creator“ |
| Datenschutzerklärung | Link (Vorlage: [DATENSCHUTZ-VORLAGE.md](DATENSCHUTZ-VORLAGE.md)) |
| Impressum | Link |
| Allgemeiner Discord-Link | dauerhafter Einladungslink zu deinem Server (Fallback, wenn der Bot aus ist) |
| Belohnung für den Code | z. B. „einen exklusiven Founding-Skin, den man nicht kaufen kann“ |

Die Belohnung für den Creator-Code muss ein Ingame-Item **ohne Echtgeldwert** sein. Man darf es nirgends für Robux kaufen können. So verlangen es die Roblox-Regeln für Promo-Codes.

## 4. Discord-Bot erstellen

1. [discord.com/developers/applications](https://discord.com/developers/applications) öffnen → **New Application** → Name eingeben (z. B. „Tower Rush HQ“) → **Create**.
2. Links **Bot** wählen.
3. **Reset Token** → bestätigen → Token **kopieren**. Er wird nur einmal angezeigt.
4. Etwas weiter unten bei **Privileged Gateway Intents**: **Server Members Intent** einschalten → **Save Changes**.
   (Ohne diesen Schalter startet der Bot nicht. Die anderen beiden Schalter brauchst du nicht.)
5. Empfohlen: **Public Bot** ausschalten, damit nur du ihn einladen kannst.
   Kommt dabei eine Fehlermeldung? Dann zuerst links unter **Installation** den „Install Link“ auf **None** stellen.
6. Dashboard → **Einrichtung** → **Discord-Bot-Token** einfügen → Speichern. Nach ein paar Sekunden steht dort „online“.
7. Dashboard → **Bot einladen** → deinen Server wählen → Berechtigungen bestätigen → **Autorisieren**.
8. In Discord: **Server-Einstellungen → Rollen** → die Rolle des Bots (heißt wie die Anwendung) ganz nach oben ziehen.
   Sie muss über allen Rollen stehen, die der Bot vergeben soll.
9. In einem beliebigen Kanal **`/setup`** eingeben.
   Der Bot legt Rollen (Creator, Founding Creator, Tester, Creator-Team), Kategorien, Kanäle und die Buttons für Bewerbung und Tester an.
   `/setup` kannst du jederzeit erneut ausführen. Vorhandenes wird wiederverwendet.
10. Rollen-Reihenfolge noch einmal prüfen: Bot-Rolle über „Creator“, „Founding Creator“, „Tester“ und „Creator-Team“.

Wer gehört zum Team? Alle mit dem Recht „Server verwalten“ und alle mit der Rolle **Creator-Team**.
Gib diese Rolle nur Erwachsenen, denen du vertraust.

Ist der Bot auf mehreren Servern? Dann in den Einstellungen die **Server-ID** festlegen.
Rechtsklick auf den Server → „Server-ID kopieren“. Dafür muss in Discord unter Einstellungen → Erweitert der Entwicklermodus an sein.

## 5. YouTube-API-Schlüssel

1. [console.cloud.google.com](https://console.cloud.google.com) öffnen und mit einem Google-Konto anmelden.
2. Oben in der Projektauswahl → **Neues Projekt** → Name (z. B. „creator-radar“) → **Erstellen** → Projekt auswählen.
3. Menü → **APIs & Dienste → Bibliothek** (APIs & Services → Library) → nach **YouTube Data API v3** suchen → **Aktivieren**.
4. **APIs & Dienste → Anmeldedaten** (Credentials) → **+ Anmeldedaten erstellen → API-Schlüssel** (Create credentials → API key).
5. Schlüssel bearbeiten → bei **API-Einschränkungen** „Schlüssel einschränken“ → nur **YouTube Data API v3** anhaken → **Speichern**.
6. Schlüssel kopieren → Dashboard → **Einrichtung** → **YouTube-API-Schlüssel** → Speichern.

Kosten: keine. Kontingent: **100 Suchen pro Tag** plus 10 000 Einheiten für Kanal- und Video-Abfragen.
Das reicht für mehrere Hundert passende Kanäle in ein paar Tagen.
Das Kontingent setzt sich gegen 9 Uhr deutscher Zeit zurück (Mitternacht an der US-Westküste). Das Tool zählt mit und stoppt rechtzeitig.

## 6. Twitch-App (optional, empfohlen)

1. Dein Twitch-Konto braucht die **Zwei-Faktor-Authentifizierung**. Ohne sie lässt Twitch dich keine App anlegen.
2. [dev.twitch.tv/console](https://dev.twitch.tv/console) → **Applications** → **Register Your Application**.
3. Ausfüllen:
   - Name: eindeutig, z. B. `towerrush-radar`
   - OAuth Redirect URLs: `http://localhost`
   - Category: „Analytics Tool“ (oder „Application Integration“)
   - Client Type: **Confidential**
4. **Create** → **Manage** → **Client ID** kopieren → **New Secret** → **Client Secret** kopieren.
5. Dashboard → **Einrichtung** → Twitch Client-ID und Client-Secret eintragen → Speichern.

Die Twitch-Suche findet nur Streamer, die **gerade live** sind. Lass sie deshalb mehrmals am Tag laufen.
Oder schalte in den Einstellungen die automatische Suche ein (z. B. stündlich).
Twitch-Flüstern (Whispers) nutzt das Tool absichtlich nicht.

## 7. Roblox

1. **Spiel verknüpfen:** Dashboard → Einstellungen → Spiel-Link einfügen (`https://www.roblox.com/games/123…`) → **Verknüpfen**.
   Das Tool holt sich die Universe-ID. Damit zeigt der Bot beim Launch die Live-Spielerzahl.
2. **Freischaltung für Spieler unter 16 prüfen (sehr wichtig):**
   - Seit Juni 2026 gibt es eigene Konten für 5–8 (Roblox Kids) und 9–15 Jahre (Roblox Select). Neue Spiele sehen zuerst nur altersgeprüfte Spieler ab 16.
   - Im **Creator Hub** (create.roblox.com) bei deinem Spiel den Stand der **Select-Freischaltung** („Select Eligibility“) ansehen.
   - Was du dafür brauchst:
     - Ausweis-Prüfung (ID-Verifizierung) für dein Konto
     - 2-Schritt-Verifizierung
     - ein aktives Roblox Plus
     - den ausgefüllten Fragebogen zur Altersfreigabe deines Spiels
     - genug sehr aktive Spieler ab 16 in 60 Tagen (laut Roblox 250 bis 500; die Zahl ändert sich öfter)
   - Playtests mit Testern ab 16 und die Launch Hour helfen dabei. Bis zur Freischaltung lieber Creator mit älterem Publikum ansprechen.
3. **Share Links pro Creator:**
   - Im Creator Hub bei deinem Spiel unter **Share Links** für jeden angenommenen Creator einen eigenen Link anlegen. Gib ihm den Creator-Namen.
   - Link kopieren und eintragen: im Dashboard beim Creator (Feld „Share Link“) oder in Discord mit `/creator link`.
   - Roblox zeigt dir pro Link, wie viele neue Spieler darüber kommen. Bringt ein Creator neue oder lange inaktive Roblox-Spieler, kann dein Spiel zusätzlich über „Creator Rewards“ verdienen.
4. **Discord-Link auf der Spielseite:** Im Creator Hub bei den Social Links deinen Discord eintragen.
   Roblox zeigt ihn nur altersgeprüften Spielern ab 16. Im Spiel selbst sind Links zu Discord nicht erlaubt.
5. **Creator-Codes im Spiel:** Hat dein Spiel schon ein Code-System, trag dort die Codes der Creator ein. Der Bot zeigt jedem seinen Code mit `/creator code`.
   Die Belohnung ist für alle gleich, öffentlich beschrieben und nicht kaufbar.

## 8. E-Mail-Absender vorbereiten

- Nutze eine **Studio-Adresse** (z. B. `creators@deine-domain.de`), nicht deine private.
- Beim Mail-Anbieter **SPF, DKIM und DMARC** aktivieren. Die meisten Anbieter haben dafür eine Anleitung. So landen deine Mails seltener im Spam.
- Dashboard → Einstellungen → E-Mail-Programm wählen: Gmail, Outlook (Web) oder dein Standard-Mailprogramm.
- Bleib unter etwa 40–50 Mails pro Tag. Das Tool hat dafür ein Tageslimit.
- Lege vorher 3–5 Gameplay-Clips auf einen TikTok- oder YouTube-Kanal zum Spiel. Creator schauen nach, wer schreibt.

## 9. Datenschutz & Impressum

1. Mit [DATENSCHUTZ-VORLAGE.md](DATENSCHUTZ-VORLAGE.md) eine Datenschutzerklärung erstellen. Am besten einmal prüfen lassen.
2. Sie auf einer einfachen Webseite veröffentlichen, zusammen mit einem Impressum und der Infoseite für Creator.
3. Die Links in den Einstellungen eintragen und in der Discord-Serverbeschreibung verlinken.
4. Für Tester unter 16: [ELTERN-EINVERSTAENDNIS.md](ELTERN-EINVERSTAENDNIS.md). Für Playtests: [TEILNAHMEBEDINGUNGEN-PLAYTEST.md](TEILNAHMEBEDINGUNGEN-PLAYTEST.md).

## 10. Rund um die Uhr betreiben (optional)

Der Bot ist nur online, solange das Tool läuft. Ist er offline, funktionieren die Buttons nicht. Beitritte über Einladungslinks werden dann nicht erkannt.

**Variante A – eigener PC:** reicht für den Anfang. In der heißen Phase (Bewerbungen, Launch) das Tool einfach laufen lassen.

**Variante B – kleiner Server** (z. B. ein günstiger Server ab etwa 5 € im Monat oder ein Raspberry Pi):

1. Node.js installieren, Projekt klonen, `npm install`.
2. `data/` und `.env` vom PC kopieren (vorher das Tool am PC beenden). Danach nur noch eine Instanz laufen lassen!
3. Als Dienst starten, z. B. mit systemd (`/etc/systemd/system/creator-launch-kit.service`):
   ```ini
   [Unit]
   Description=Creator Launch Kit
   After=network-online.target

   [Service]
   WorkingDirectory=/opt/creator-launch-kit
   ExecStart=/usr/bin/npm start
   Restart=on-failure
   User=clk

   [Install]
   WantedBy=multi-user.target
   ```
   Dann `sudo systemctl enable --now creator-launch-kit`.
4. Aufs Dashboard zugreifen – am sichersten per SSH-Tunnel:
   ```bash
   ssh -L 3000:localhost:3000 dein-user@dein-server
   ```
   Danach im Browser `http://localhost:3000` öffnen.
5. Nur wenn du das Dashboard direkt im Netz brauchst: in `.env` `HOST=0.0.0.0` **und** ein starkes `DASHBOARD_PASSWORD` setzen, am besten mit HTTPS davor.
   Ohne Passwort antwortet das Dashboard absichtlich nur auf localhost.

---

Alles erledigt? `npm run check` zeigt überall ✅. Dann kann es mit der ersten Welle losgehen – siehe [LAUNCH-PLAYBOOK.md](LAUNCH-PLAYBOOK.md).
