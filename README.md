# Creator Launch Kit

Dein Werkzeugkasten für den Launch deines Roblox-Spiels mit kleinen Creatorn:

- **Creator Radar** – findet kleine Roblox-Creator auf YouTube und Twitch (TikTok/Instagram per Klick), bereitet für jeden eine passende Nachricht vor und zeigt dir, wer geantwortet hat.
- **Discord ohne Bot** – Anleitung und fertige Texte, wie du Bewerbungen, Playtests, Bugs und die Launch Hour mit Discords eigenen Funktionen und Google-Formularen machst: [docs/DISCORD-OHNE-BOT.md](docs/DISCORD-OHNE-BOT.md).
- **Creator HQ (optional)** – ein Discord-Bot, der das automatisiert. Nur nötig, wenn ein Rechner dauerhaft läuft. Standard: aus.
- **Vorlagen & Anleitungen** – Nachrichten in 7 Sprachen, Creator-Programm, Launch-Ablauf, Datenschutz- und Eltern-Vorlagen.

Alles läuft auf deinem PC. Die Daten bleiben bei dir. **Gesendet wird immer von dir selbst** – das Tool öffnet nur das richtige Fenster und kopiert den Text.

---

## Schnellstart

Du brauchst **Node.js 22.13 oder neuer** (am besten die aktuelle LTS-Version von [nodejs.org](https://nodejs.org)).

| System | So startest du |
|---|---|
| Windows | Doppelklick auf **`start.bat`** |
| macOS | Doppelklick auf **`start.command`** (beim ersten Mal: Rechtsklick → „Öffnen“) |
| Linux | `./start.sh` im Terminal |
| Alle | oder im Terminal: `npm install` und danach `npm start` |

Danach öffnet sich das Dashboard im Browser: **http://localhost:3000**

Das Tool läuft, solange das Fenster offen ist. **Kein Dauerbetrieb nötig:** Starte es einfach, wenn du Creator suchst oder anschreibst, und schließ es danach (`Strg + C` oder Fenster zu).

---

## Erste Einrichtung (ca. 30 Minuten)

Die Startseite im Dashboard zeigt eine Checkliste mit allem, was noch fehlt. Die genauen Schritte stehen in **[docs/EINRICHTUNG.md](docs/EINRICHTUNG.md)**.

1. **Einstellungen → Spiel:** Name, 1–2 Sätze Beschreibung (Deutsch + Englisch), Launch-Termin, Absendername, Studio-Name, allgemeiner Discord-Link.
   - **Datenschutz-Link: empfohlen.** Ein Google-Doc reicht („Jeder mit dem Link kann ansehen“). Ohne Link setzt das Tool automatisch einen kurzen Datenschutz-Hinweis in jede Nachricht.
   - **Infoseite: optional.** Ohne sie verlinken die Nachrichten dein Roblox-Spiel.
2. **Einrichtung → YouTube-API-Schlüssel** (kostenlos, Google Cloud Console).
3. **Einrichtung → Twitch Client-ID + Secret** (optional, kostenlos).
4. **Discord mit Bordmitteln einrichten** (Rollen, Kanäle, Onboarding, Formulare): [docs/DISCORD-OHNE-BOT.md](docs/DISCORD-OHNE-BOT.md).
5. *Optional, nur wenn ein Rechner dauerhaft läuft:* Discord-Bot einschalten (Einstellungen → Discord → „Discord-Bot verwenden“), Token unter Einrichtung eintragen, Bot einladen, im Discord `/setup`.

Prüfen geht auch im Terminal: `npm run check`

---

## Dein Tagesablauf

1. **Finden** (Seite „Finden“)
   - YouTube-Suche starten. YouTube erlaubt 100 Suchen pro Tag, das reicht für mehrere Hundert Kanäle in ein paar Tagen.
   - Twitch-Suche starten: Sie findet alle Roblox-Streams, die gerade live sind. Am besten mehrmals am Tag laufen lassen oder die automatische Suche einschalten.
   - TikTok/Instagram: Lesezeichen-Button einmal in die Lesezeichenleiste ziehen. Auf einem Profil klicken → Creator ist gespeichert.
   - Oder Links/CSV-Dateien importieren.
2. **Prüfen** (Seite „Creator“) – nach Bewertung sortieren, Unpassendes als „ungeeignet“ markieren.
3. **Senden** (Seite „Senden“) – ein Creator nach dem anderen:
   - **Enter** = Text kopieren + Profil/E-Mail öffnen (bei E-Mail ist alles schon ausgefüllt)
   - **S** = gesendet · **L** = später · **U** = ungeeignet
   - Tageslimits schützen deine Accounts. Nachfass-Mails werden automatisch fällig (nur E-Mail, höchstens eine).
4. **Antworten erfassen** – beim Creator „Geantwortet“ klicken: interessiert, Fragen oder kein Interesse. Wer „Nein“ sagt: **„Abmelden“** – dann wird der Eintrag gelöscht und die Person nie wieder vorgeschlagen.
5. **Discord** – Interessierte kommen über deinen Discord-Link und bewerben sich über das Formular in **#creator-bewerbung**. Du gibst ihnen die Rolle „Creator“ und setzt im Tool den Status auf „Dabei“. (Mit Bot geht das automatisch.)

Fertige Antworten auf typische Fragen: **[docs/ANTWORT-BAUSTEINE.md](docs/ANTWORT-BAUSTEINE.md)**

### Der Kontaktweg (wichtig)

Das Tool wählt für jeden Creator automatisch einen erlaubten Weg:

- 🟢 **E-Mail** – nur öffentlich angegebene Adressen, am liebsten die Business-Mail.
- 🟢 **DM** – nur wenn das Profil ausdrücklich zu Anfragen per DM einlädt („DM for collabs“).
- 🟡 **Discord** – der eigene Server des Creators (Partner- oder Anfrage-Kanal).
- 🔴 **Kein Weg** – der Creator wird nicht angeschrieben.

Hintergrund: In Deutschland sind ungefragte Werbe-Nachrichten ohne Einwilligung verboten (§ 7 UWG), auch per DM. Eine persönliche Anfrage an eine veröffentlichte Business-Adresse ist vertretbar. Massen-DMs dagegen nicht.

---

## Discord-Befehle (nur mit Bot – optional)

Ohne Bot brauchst du keine Befehle. So geht es mit Bordmitteln: [docs/DISCORD-OHNE-BOT.md](docs/DISCORD-OHNE-BOT.md).

| Befehl | Wer | Wofür |
|---|---|---|
| `/setup` | Team | Rollen, Kanäle und Buttons anlegen (mehrfach ausführbar) |
| `/hilfe` | alle | Übersicht der Befehle |
| `/creator code` · `/creator profil` | Creator | eigener Code, Share Link, Punkte, Rang |
| `/creator info` · `link` · `code-setzen` · `punkte` · `entfernen` | Team | Creator verwalten |
| `/content` | Creator | Video/Short/Stream einreichen (gibt Punkte nach Prüfung) |
| `/live` | Creator | „Ich bin live“ melden (Twitch wird automatisch erkannt) |
| `/rangliste` | alle | Rangliste der Creator oder Tester |
| `/playtest erstellen` · `liste` · `absagen` · `beenden` · `teilnehmer` | Team | Playtest-Termine verwalten |
| `/bug` | Tester/Creator | Fehler melden |
| `/feedback` | Tester/Creator | Feedback zum letzten Playtest |
| `/event erstellen` · `liste` · `absagen` | Team | Launch Hour und wöchentliche Events mit Countdown und Spielerzahl |

Der Bot antwortet automatisch auf Deutsch oder Englisch – je nach Spracheinstellung der Person in Discord.

---

## Regeln, die eingebaut sind

- **Keine Robux- oder Geldpreise, keine Gewinnspiele.** Das verbieten die Roblox-Regeln. Belohnt wird mit exklusiven Ingame-Items, Titeln, Creator-Wall, Rängen und frühem Zugang.
- **Unter 13:** keine Aufnahme. **13–15:** nur mit Einverständnis der Eltern ([Vorlage](docs/ELTERN-EINVERSTAENDNIS.md)). **16–17:** dabei, aber ohne bezahlte Deals. **Bezahlte Deals nur ab 18** und schriftlich.
- **Werbung kennzeichnen:** Creator bekommen eine Gegenleistung (früher Zugang, Items) – also schreiben sie „Werbung“ an den Anfang. Vorlagen im [Creator-Kit](docs/CREATOR-KIT.md).
- **Keine Kauf-Aufrufe an Kinder** („Kauft jetzt …“).
- **Gespräche mit Minderjährigen nur in Gruppen-Kanälen,** nicht privat.

Mehr dazu im [Plan](docs/PLAN.md) und im [Creator-Programm](docs/CREATOR-PROGRAMM.md). Das ist keine Rechtsberatung – bevor du Kampagnen für andere verkaufst, einmal mit Anwalt oder IHK sprechen.

---

## Daten & Datenschutz

- Alle Daten liegen im Ordner **`data/`** (Datenbank `radar.db`, Logs). Zugangsdaten liegen in **`.env`**. Beides wird nie mit Git hochgeladen.
- **Sicherung:** den Ordner `data/` und die Datei `.env` kopieren (am besten, während das Tool aus ist).
- Das Tool räumt selbst auf:
  - Plattform-Daten werden spätestens nach 30 Tagen aktualisiert oder gelöscht (Vorgabe von YouTube).
  - Nie kontaktierte Creator werden nach 30 Tagen gelöscht.
  - Wer nie antwortet, wird nach 6 Monaten gelöscht.
- **Abmeldung:** Der Eintrag wird gelöscht. Es bleibt nur ein Prüfwert (Hash), damit die Person nicht erneut angeschrieben wird.
- Die erste Nachricht muss sagen, woher du den Kontakt hast und wie man widerspricht. Das steht in jeder Vorlage. **Empfohlen:** zusätzlich ein Link zu deinem Datenschutz-Text, z. B. als Google-Doc (Vorlage: [docs/DATENSCHUTZ-VORLAGE.md](docs/DATENSCHUTZ-VORLAGE.md)). Ohne Link setzt das Tool automatisch einen kurzen Datenschutz-Hinweis in die Nachricht.
- **Kontaktlisten nie verkaufen oder weitergeben.** Für Kampagnen anderer Spiele nur Creator fragen, die ausdrücklich zugestimmt haben.

---

## Hilfe bei Problemen

| Problem | Lösung |
|---|---|
| „Node.js ist zu alt“ | Aktuelle LTS-Version von nodejs.org installieren, Fenster schließen, neu starten. |
| „Port 3000 ist belegt“ | Läuft das Tool schon? Dann einfach http://localhost:3000 öffnen. Sonst in `.env` `PORT=3001` eintragen. |
| (Bot) bleibt offline: „Server Members Intent“ | Developer Portal → deine Anwendung → Bot → „Server Members Intent“ einschalten → speichern. |
| (Bot) offline: „Token ungültig“ | Developer Portal → Bot → „Reset Token“, neuen Token im Dashboard eintragen. |
| (Bot) Slash-Befehle fehlen in Discord | Bot ist auf dem Server? Discord neu laden (`Strg + R`). Bei mehreren Servern die Server-ID in den Einstellungen setzen. |
| (Bot) kann keine Rollen vergeben | Server-Einstellungen → Rollen: die Bot-Rolle **über** „Creator“, „Founding Creator“ und „Tester“ ziehen. |
| YouTube-Suche stoppt | Tageskontingent verbraucht (100 Suchen). Es setzt sich gegen 9 Uhr deutscher Zeit zurück (Mitternacht an der US-Westküste). |
| Twitch-Suche meldet Fehler | Client-ID und Secret prüfen. Bei der Twitch-App muss der Client-Typ „Vertraulich“ sein. |
| E-Mail öffnet sich nicht richtig | In den Einstellungen das E-Mail-Programm wählen (Gmail, Outlook oder Standard-Programm). |
| Lesezeichen tut nichts | Popups für die Seite erlauben. Das Tool muss laufen. Chrome fragt evtl. nach „Zugriff auf lokale Geräte“ – erlauben. |
| macOS: „start.command kann nicht geöffnet werden“ | Rechtsklick → „Öffnen“. Oder im Terminal: `chmod +x start.command` |

Die letzten Meldungen stehen im offenen Konsolenfenster und in `data/logs/app.log`.

---

## Aktualisieren

- **Mit Git:** `git pull`, danach `npm install` und neu starten.
- **Als ZIP:** neue Version herunterladen und entpacken. Deinen alten Ordner `data/` und die Datei `.env` in den neuen Ordner kopieren.

Die Datenbank wird beim Start automatisch auf den neuen Stand gebracht.

---

## Weitere Dokumente

- [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md) – alle Zugänge Schritt für Schritt
- [docs/PLAN.md](docs/PLAN.md) – der Gesamtplan bis zum Launch und danach
- [docs/LAUNCH-PLAYBOOK.md](docs/LAUNCH-PLAYBOOK.md) – Tag für Tag: Playtests 24./25.10., Launch Hour Sa 31.10.2026, Samstags-Events bis 28.11.
- [docs/DISCORD-OHNE-BOT.md](docs/DISCORD-OHNE-BOT.md) – Discord mit Bordmitteln + Texte zum Kopieren
- [docs/CREATOR-PROGRAMM.md](docs/CREATOR-PROGRAMM.md) – das Programm zum Weitergeben (DE/EN)
- [docs/CREATOR-KIT.md](docs/CREATOR-KIT.md) – Titel, Beschreibungen und Ablauf für Creator
- [docs/ANTWORT-BAUSTEINE.md](docs/ANTWORT-BAUSTEINE.md) – Antworten auf typische Fragen
- [docs/ELTERN-EINVERSTAENDNIS.md](docs/ELTERN-EINVERSTAENDNIS.md), [docs/DATENSCHUTZ-VORLAGE.md](docs/DATENSCHUTZ-VORLAGE.md), [docs/TEILNAHMEBEDINGUNGEN-PLAYTEST.md](docs/TEILNAHMEBEDINGUNGEN-PLAYTEST.md) – Vorlagen
- [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) – technischer Aufbau (für Entwickler)
