# Architektur & Schnittstellen (verbindlich)

Dieses Dokument ist der Vertrag zwischen allen Teilen. Wer etwas baut, hält sich an die Namen,
Pfade und Datenformate hier. Änderungen nur, wenn alle betroffenen Teile mitziehen.

## 1. Überblick

Ein Node.js-Prozess (`npm start`, Node ≥ 22.13, ESM) startet:

- **Dashboard** (Express 5) auf `http://localhost:3000` – statische Oberfläche in `src/web/public`, JSON-API unter `/api`.
- **Creator Radar** (`src/radar`) – Suche (YouTube/Twitch), Anreicherung, Vorlagen, Senden-Warteschlange, Aufbewahrung.
- **Creator HQ** (`src/bot`) – Discord-Bot (discord.js 14) mit Modulen in `src/bot/modules`.
- **Datenbank** – SQLite über das eingebaute `node:sqlite` in `data/radar.db` (Schema: `src/core/schema.js`).

Abhängigkeiten: nur `discord.js`, `express`, `eld` (Spracherkennung). **Keine neuen Pakete** ohne Absprache.
Kein Build-Schritt, kein Bundler, keine CDNs (alles läuft offline/lokal).

### Zuständigkeiten (wer schreibt welche Dateien)

| Bereich | Dateien |
|---|---|
| Kern (fertig) | `src/core/*`, `src/web/server.js`, `src/web/http.js`, `src/web/routes/system.js`, `src/bot/index.js`, `src/bot/context.js`, `src/bot/util.js`, `src/bot/modules/index.js`, `src/index.js` |
| Radar | `src/radar/*` (außer `default-templates.js`), `src/web/routes/radar.js`, `src/radar/cli-commands.js`, Tests `test/radar-*.test.js` |
| Oberfläche | `src/web/public/*` (inkl. `capture.html`) |
| Bot Teil A | `src/bot/modules/{setup,applications,invites,creator,live,leaderboard,help}.js`, `src/web/routes/discord.js`, Tests `test/bot-a-*.test.js` |
| Bot Teil B | `src/bot/modules/{playtests,bugs,events}.js`, `src/web/routes/playtests.js`, Tests `test/bot-b-*.test.js` |
| Inhalte & Doku | `src/radar/default-templates.js`, `README.md`, `CLAUDE.md`, `docs/*.md` (außer dieser Datei), `.env.example`, `start.bat`, `start.command`, `start.sh` |

Kern-Dateien nicht umschreiben. Fehlt dort etwas, eine **kleine, abwärtskompatible** Ergänzung machen
und im Abschlussbericht nennen.

## 2. Konventionen

- ESM (`import`/`export`), Node-Built-ins mit `node:`-Präfix, `fetch` ist global.
- Oberfläche, Bot-Texte und Fehlermeldungen an Nutzer: **Deutsch** (Bot zusätzlich Englisch, siehe 7.4).
  Code-Kommentare kurz, Englisch oder Deutsch.
- Zeitstempel immer ISO-8601 UTC (`new Date().toISOString()`), Helfer in `src/core/time.js`.
  Eingaben wie „21.11.2026“ + „19:00“ (Europe/Berlin) → `parseLocalDateTime()`.
- DB-Zugriff: `getDb()` aus `src/core/db.js`. Benannte Parameter `:name`, Objekt übergeben
  (unbekannte Schlüssel werden ignoriert, `undefined` → NULL, `true/false` → 1/0, Objekte → JSON).
  `db.tx(fn)` ist synchron (kein `await` darin!).
- Einstellungen: `getSettings()` / `updateSettings(patch)` aus `src/core/settings.js` (Defaults dort).
- Secrets nur über `env('NAME')` aus `src/core/config.js` (Datei `.env`). Niemals Secrets loggen oder an die Oberfläche geben.
- Logging: `createLogger('scope')` aus `src/core/log.js`.
- Netzwerkaufrufe so schreiben, dass `fetch` für Tests ersetzbar ist (Parameter `fetchImpl = fetch`).
- Keine automatische Versendung von Nachrichten an Creator. Keine Scraper für TikTok/Instagram/YouTube-Webseiten.

## 3. Kern-API (fertig, zum Benutzen)

`src/core/creators.js`
- `STATUS_FLOW` = `neu, qualifiziert, kontaktiert, nachgefasst, geantwortet, interessiert, im_discord, dabei, live`
- `STATUS_SIDE` = `ungeeignet, kein_interesse, keine_antwort, abgemeldet`; `STATUS_LABELS`; `AGE_GROUPS` = `unbekannt, u13, 13-15, 16-17, 18+`; `minAgeOf(group)`
- `getCreator(id)`, `getCreatorFull(id)` → `{ creator, accounts, contacts, outreach, activity, application }` (tags/score_details/genres schon geparst)
- `findCreatorByDiscordId(userId)`, `findCreatorByAccount(platform, { externalId, handle })`, `findCreatorByEmail(email)`
- `createCreator(fields)` → id (legt Outreach-Zeile der aktiven Kampagne an), `updateCreator(id, fields)`, `deleteCreator(id)`
- `upsertAccount(creatorId, account)` → accountId (Abgleich über external_id, dann handle)
- `addContact(creatorId, { type, value, label, source, is_business, dm_invited })`
- `ensureOutreach`, `getOutreach(creatorId)`, `updateOutreach(outreachId, fields)`
- `setOutreachStatus(creatorId, to, { force, data, extra })` – bewegt standardmäßig nur vorwärts, loggt Aktivität, feuert `bus 'outreach.status'`
- `logActivity(creatorId, type, data)`
- `linkDiscordUser(creatorId, userId, tag)`, `generateCreatorCode(name)`
- `isSuppressed({ emails, accounts })`, `suppressAndDeleteCreator(id)` (Abmeldung: nur Hashes bleiben)

`src/core/urls.js` – `parseProfileUrl(url)`, `profileUrl(platform, handle)`, `extractLinks(text)` → `{ emails:[{value,index}], profiles:[{platform,handle|externalId,url}], discordInvites:[code] }`, `PLATFORMS`, `PLATFORM_LABELS`

`src/core/points.js` – `addPoints({ userId, kind:'creator'|'tester', points, reason, ref })` (ref = einmalig pro Nutzer), `getPoints`, `getLeaderboard(kind, limit)`, `getRank`, `tierFor(points)`

`src/core/scheduler.js` – `schedule(name, everyMs, fn, { runImmediately })`, `unschedule`, `stopAll(prefix)`, `listJobs`

`src/core/services.js` – `services.bot` (Status + Funktionen, die Bot-Module per `ctx.provide` anbieten), `callBot(name, ...args)` (wirft 503, wenn Bot offline)

`src/core/time.js` – `nowIso, toDate, addMinutes/Hours/Days, daysSince, parseDateInput, parseTimeInput, parseLocalDateTime, zonedToUtc, dayKey(date, tz), formatDate(date, lang, tz), formatTime, zoneLabel, discordTs(date, style)`

`src/core/util.js` – `sleep, chunk, uniq, sha256, truncate, safeJson, clamp, normalizeEmail, normalizeHandle, stripDiacritics, makeCode, deepMerge, getPath, parseCount('12,3K') → 12300`

`src/web/http.js` – `HttpError, badRequest, notFound, conflict, intParam, listParam, requireFields, sendCsv(res, filename, columns, rows)`

Event-Bus (`src/core/bus.js`): `settings.changed`, `secrets.changed`, `outreach.status`, `creator.joined`, `creator.accepted`, `discovery.finished`.

## 4. Datenmodell – Begriffe

- **creators**: eine Person. `contact_channel` = bester erlaubter Kontaktweg (`email|dm|discord|none`), `contact_target` (Adresse/URL), `contact_platform` (bei dm: `tiktok|instagram|x|twitch`). `contact_locked=1` → manuell gesetzt, nicht neu berechnen.
- **accounts**: Plattform-Konten (youtube/twitch/tiktok/instagram/x/kick). Plattform-Daten (Follower, Bio, Titel) unterliegen der Aufbewahrungsregel (30 Tage).
- **contacts**: gefundene Kontaktwege. `is_business=1` wenn als Business/Kooperation markiert, `dm_invited=1` wenn das Profil ausdrücklich zu Anfragen per DM einlädt.
- **outreach**: Pipeline-Zustand pro Kampagne (aktive Kampagne: `settings.activeCampaignId`, Standard 1).
- **activity**: Verlauf. Typen: `discovered, status, sent, followup_sent, reply, note, joined_discord, application, accepted, live, content, skipped`. `sent`/`followup_sent` haben `data.channel` → Grundlage für Tageslimits und Statistik.
- Altersgruppen: `u13` wird nie aufgenommen. Unter `settings.discord.parentConsentUnder` (Standard 16) braucht es Eltern-OK. Bezahlte Deals (`paid_ok`) nur 18+.

### Kontaktweg-Ampel (rechtliche Leitplanke, siehe docs/PLAN.md)

1. **email** (grün) – öffentlich angegebene E-Mail; bevorzugt `is_business=1`.
2. **dm** (grün) – nur wenn das Profil ausdrücklich zu Anfragen per DM einlädt (`dm_invited=1`) und ein DM-fähiges Konto bekannt ist (tiktok/instagram/x/twitch).
3. **discord** (gelb) – eigener Discord-Server des Creators (Einladungslink gefunden).
4. **none** (rot) – kein erlaubter Weg → nicht in der Senden-Warteschlange.

## 5. Radar – fachliche Regeln

### 5.1 YouTube-Suche
- Kontingent: **100 Suchaufrufe/Tag** (`search.list`, eigener Topf seit 1.6.2026) + 10 000 Einheiten/Tag für den Rest (`channels.list`, `videos.list`, `playlistItems.list` je 1 Einheit). Zählen in `api_usage` mit `day = dayKey(now, 'America/Los_Angeles')`, `api` = `youtube_search` bzw. `youtube_units`. Vor jedem Aufruf prüfen, bei Erreichen sauber stoppen.
- Ablauf: Suchbegriffe je Sprache (`settings.radar.youtube.queries[lang]`) → `search.list` (`part=snippet, type=video, maxResults=50, publishedAfter=now-publishedWithinDays, relevanceLanguage=lang`, bis `pagesPerQuery` Seiten) → Kanal-IDs sammeln → `channels.list` (`snippet,statistics,brandingSettings,contentDetails`, 50 IDs pro Aufruf) → Filter (Abos zwischen `minFollowers` und `maxFollowers`, nicht versteckt) → je Kandidat `playlistItems.list` (Uploads, `recentVideos`) + `videos.list` (`snippet,statistics,contentDetails,liveStreamingDetails`) → Kennzahlen, Kontakte, Sprache, Score → speichern.
- Kennzahlen: `roblox_share` (Anteil „roblox“ in Titel/Tags der letzten Videos), `live_share`, `avg_views`, `uploads_30d`, `last_active_at`, `genres` (Treffer aus `settings.radar.genres`), `latest_title/latest_url`, `platform_language` (Mehrheit von `defaultAudioLanguage`/`defaultLanguage`).
- Kontakte aus Kanalbeschreibung + Beschreibungen der letzten 3 Videos (`extractLinks`). E-Mail gilt als Business, wenn in ±80 Zeichen eines der Wörter steht: business, geschäftlich, anfragen, kooperation, collab, sponsor, inquiries, contact, kontakt, negocios, parcerias, contato, partenariat, booking, management.
- Bereits vorhandene Kanäle aktualisieren statt doppelt anlegen. Abgemeldete (`isSuppressed`) überspringen.

### 5.2 Twitch-Suche
- App-Token (Client-Credentials, `https://id.twitch.tv/oauth2/token`), im Speicher cachen.
- Roblox-Kategorie: `GET /helix/games?name=Roblox` → in `settings.radar.twitch.gameId` merken.
- `GET /helix/streams?game_id=…&language=…&first=100` mit Paging bis `maxPages`; Filter `minViewers..maxViewers`.
- `GET /helix/users?id=…` (100 pro Aufruf) für Bio, Profilbild, `broadcaster_type`.
- Pro Sichtung: `times_seen_live+1`, gleitender Schnitt `avg_live_viewers`, `max_live_viewers`, `last_active_at`, `latest_title`, `platform_language = stream.language`.
- Export für den Bot: `getStreamsByLogins(logins, { fetchImpl })` → `[{ user_login, user_name, title, game_name, viewer_count, started_at, url }]` (bis 100 Logins pro Aufruf, intern stückeln).
- Whispers niemals verwenden.

### 5.3 Sprache
- `initLanguage()` lädt `eld` (`await eld.load('medium')`, Subset: de,en,es,pt,fr,pl,tr,it,nl,ru,id,vi,tl,ja,ko).
- Reihenfolge: Plattform-Angabe (YouTube `defaultAudioLanguage` / Twitch `language`) → Text-Erkennung über Titel+Beschreibung (vorher „roblox“, Spielnamen, Zahlen, Emojis, URLs entfernen; nur übernehmen wenn zuverlässig und ≥ 20 Zeichen) → sonst `null`. Manuell gesetzte Sprache (`language_source='manual'`) nie überschreiben.

### 5.4 Score (0–100) – `score_details` speichert die Einzelwerte
| Teil | Punkte |
|---|---|
| Roblox-Fokus | bis 30 (`roblox_share × 30`; Twitch-Sichtung in Roblox = 25) |
| Aktivität | 15 (≤7 Tage), 11 (≤14), 7 (≤30), 3 (≤60), sonst 0 |
| Größe | 20 im Sweet Spot (YouTube 500–15 000 Abos; Twitch Ø 3–100 Zuschauer), 12 knapp außerhalb, 5 sonst |
| Engagement | bis 10 (YouTube Ø Views/Abos: >0,3→10, >0,15→7, >0,05→4, sonst 1; Twitch Sichtungen: ≥3→10, 2→6, 1→3) |
| Genre | bis 15 (shooter +8, newgames +8, buildfight +6, viewers +5, gedeckelt) |
| Kontakt | 10 Business-Mail, 8 Mail, 7 DM-Einladung, 5 Discord, 2 nur Social, 0 nichts |

### 5.5 Vorlagen
- Schlüssel `step.channel.language.variant`, z. B. `first.email.de.A`. `step`: `first|followup`. `channel`: `email|dm|discord`. Sprachen: de, en, es, pt, fr, pl, tr (+ weitere möglich). Varianten: A, B.
- `DEFAULT_TEMPLATES` aus `src/radar/default-templates.js` werden beim Start eingefügt bzw. aktualisiert, **außer** `is_custom=1`.
- Auswahl: Sprache des Creators → sonst `en`. Variante: bei `abTest` abwechselnd/gleich verteilt (z. B. nach outreach_id gerade/ungerade), sonst A.
- Platzhalter: `{name} {video} {game} {pitch} {date} {time} {link} {discord} {sender} {studio} {privacy} {reward} {platform}`
  - `{pitch}` = `game.pitch_<lang>` (Fallback en, dann de), `{reward}` = `game.codeReward_<lang>`.
  - `{date}`/`{time}`: aus `game.launchAt` in `game.timezone`, lokalisiert. Deutsch „Samstag, 21. November“ / „19:00 Uhr“; andere Sprachen zusätzlich mit Zonenkürzel, z. B. „7:00 PM CET (1:00 PM ET)“.
  - `{link}` = `game.infoUrl` (Fallback `game.url`), `{privacy}` = `game.privacyUrl`, `{discord}` = persönlicher Einladungslink (Fallback `game.discordInvite`).
- Bedingte Teile: `[[Text mit {video}||Ersatztext]]` → erster Teil, wenn alle Platzhalter darin gefüllt sind, sonst Ersatztext (darf leer sein). Ohne `||` fällt der Block weg.
- Pflicht in jeder Erstnachricht: wer schreibt, woher der Kontakt stammt, Abmelde-Satz, Link zur Datenschutzerklärung.

### 5.6 Senden-Warteschlange
- **Erstkontakt**: Outreach-Status `neu` oder `qualifiziert`, `contact_channel != 'none'`, nicht abgemeldet, nicht `snoozed_until > jetzt`, Score ≥ `radar.minScore`; sortiert nach Score. Alter `u13` nie.
- **Nachfassen**: Status `kontaktiert`, `channel='email'`, `followups_sent < maxFollowups`, `followup_due_at <= jetzt`, keine Antwort.
- Tageslimits (`radar.dailyLimits` je Kanal) zählen `activity` vom Typ `sent`/`followup_sent` des heutigen Tages (Europe/Berlin).
- `open_url`:
  - email → je `radar.emailClient`: Gmail `https://mail.google.com/mail/?view=cm&fs=1&to=…&su=…&body=…`, Outlook `https://outlook.live.com/mail/0/deeplink/compose?to=…&subject=…&body=…`, sonst `mailto:…?subject=…&body=…` (alles URL-kodiert).
  - dm → Profil-URL (tiktok/x/twitch); Instagram: `instagramLink='app'` → `https://ig.me/m/<handle>`, sonst Profil-URL.
  - discord → Einladungslink des Creator-Servers.
- „Gesendet“ (Erstkontakt): Status `kontaktiert`, `contacted_at`, `channel/channel_target/channel_platform/template_key/variant`, bei email `followup_due_at = jetzt + followupAfterDays`; Aktivität `sent` mit `{ channel, template_key, variant }`.
- „Gesendet“ (Nachfassen): `followups_sent+1`, `last_followup_at`, Status `nachgefasst`, `followup_due_at = NULL`; Aktivität `followup_sent`.
- Job (stündlich): `kontaktiert`/`nachgefasst` ohne Antwort seit `noReplyAfterDays` nach dem letzten Kontakt → `keine_antwort`.
- Antwort erfassen: `geantwortet` (+`reply_sentiment`, `replied_at`), `interessiert` → Status `interessiert`, `kein_interesse` → Status `kein_interesse`.

### 5.7 Aufbewahrung (täglich + manuell)
- Plattform-Daten älter als `retention.platformDataDays`: wenn der Creator kontaktiert wurde → mit API aktualisieren (falls Schlüssel vorhanden), sonst Plattform-Felder leeren (`followers, avg_views, bio, latest_title, …`); nie kontaktierte Creator älter als `uncontactedDays` → löschen.
- Status `keine_antwort`/`kein_interesse` älter als `noReplyDeleteDays` → löschen (keine Hashes nötig).
- Abmeldung → `suppressAndDeleteCreator`.

### 5.8 Import & Schnell-Erfassung
- URL-Liste: eine URL pro Zeile, optional `URL; Follower; E-Mail`. YouTube/Twitch werden mit API ergänzt (falls Schlüssel da: YouTube `channels.list?forHandle=@x` bzw. `id=`, Video-Links über `videos.list` → Kanal; Twitch `users?login=`).
- CSV (Trennzeichen `;` oder `,`, Kopfzeile, Spalten frei aus: name, platform, url, handle, email, followers, language, notes, tags, age_group).
- Lesezeichen („Bookmarklet“): öffnet ein kleines Fenster `http://localhost:PORT/capture?platform=…&url=…&handle=…&name=…&followers=…&bio=…` (nur Top-Level-Navigation, kein fetch von der fremden Seite). TikTok: Handle aus URL, Follower aus `[data-e2e="followers-count"]`, Name aus `[data-e2e="user-subtitle"]`/`h1`, Bio aus `[data-e2e="user-bio"]`. Instagram: Handle aus URL, Rest aus `meta[property="og:description"]`/`og:title`. Sonst nur URL + Seitentitel.

## 6. REST-API (alle Antworten JSON; Fehler `{ error }` mit HTTP-Status)

Ändernde Anfragen (POST/PUT/PATCH/DELETE) brauchen den Header **`X-CLK: 1`**.

### System (fertig)
- `GET /api/health` → `{ ok, version }`
- `GET /api/status` → `{ version, node, setup:[{key,label,done,optional?,where,detail?}], bot:{state,error,tag,appId,guild,guilds,inviteUrl,commandsRegistered,modules}, secrets:{KEY:{set,hint}}, counts:{creators,members,testers,byStatus}, quota:{day,youtubeSearches,youtubeSearchLimit,youtubeUnits,youtubeUnitLimit}, game:{name,launchAt} }`
- `GET /api/settings` → `{ settings, secrets }`; `PUT /api/settings` (Teilobjekt; `game.launchDate` „21.11.2026“ + `game.launchTime` „19:00“ werden zu `game.launchAt`) → `{ settings, secrets }`
- `GET /api/secrets` → `{ secrets }`; `PUT /api/secrets` `{ DISCORD_TOKEN?, YOUTUBE_API_KEY?, TWITCH_CLIENT_ID?, TWITCH_CLIENT_SECRET?, DASHBOARD_PASSWORD? }` (leerer Text löscht) → `{ secrets }`. Discord-Token-Änderung startet den Bot neu.
- `GET /api/logs?level=info` → `{ lines }`; `GET /api/jobs` → `{ jobs }`
- `POST /api/roblox/resolve` `{ input }` (Spiel-Link oder Place-ID) → `{ placeId, universeId, name, playing, visits }` (speichert in settings.game)

### Radar
- `GET /api/creators?status=a,b&platform=&language=&channel=&minScore=&q=&member=0|1&sort=score|followers|created|updated|name|last_active&dir=asc|desc&limit=50&offset=0`
  → `{ total, items:[CreatorListItem] }`
  `CreatorListItem = { id, display_name, language, age_group, score, contact_channel, contact_target, contact_platform, tags, status, followers, platforms:[{platform, handle, url, followers}], latest_title, latest_url, last_active_at, contacted_at, followup_due_at, replied_at, reply_sentiment, is_member, discord_user_id, creator_code, share_link, created_at, updated_at }`
- `GET /api/creators/:id` → `{ creator, accounts, contacts, outreach, activity, application }`
- `POST /api/creators` `{ display_name, platform?, url?, handle?, email?, followers?, language?, notes? }` → `{ id }`
- `PATCH /api/creators/:id` `{ display_name?, language?, age_group?, notes?, tags?, creator_code?, share_link?, discord_user_id?, paid_ok?, parent_consent?, contact_channel?, contact_target?, contact_platform? }` (Kontaktweg setzen → `contact_locked=1`; `contact_channel:null` → wieder automatisch) → `{ creator }`
- `DELETE /api/creators/:id` → `{ ok }`
- `POST /api/creators/:id/status` `{ status, note? }` (manuell, `force`) → `{ outreach }`
- `POST /api/creators/:id/reply` `{ sentiment: 'interessiert'|'fragen'|'kein_interesse', note? }` → `{ outreach }`
- `POST /api/creators/:id/optout` → `{ ok }` (löscht + sperrt)
- `POST /api/creators/:id/rescore` → `{ creator }`; `POST /api/creators/:id/refresh` (API neu laden) → `{ creator }`
- `POST /api/creators/:id/note` `{ text }` → `{ ok }` (Aktivität `note`)
- `POST /api/creators/bulk` `{ ids:[], action:'qualify'|'reject'|'delete'|'tag'|'untag'|'status'|'snooze', value? }` → `{ changed }`
- `POST /api/creators/:id/contacts` `{ type, value, is_business?, dm_invited? }` → `{ contact }`; `DELETE /api/contacts/:id` → `{ ok }`
- `GET /api/queue?mode=first|followup&language=&platform=&channel=&minScore=&limit=20`
  → `{ mode, limits:{ email:{used,max}, dm:{used,max}, discord:{used,max} }, total, items:[QueueItem] }`
  `QueueItem = { outreach_id, creator: CreatorListItem, channel, target, platform, template_key, variant, message:{ subject, body }, open_url, warnings:[text] }`
- `POST /api/queue/:outreachId/prepare` `{ mode }` → `{ channel, target, platform, template_key, variant, message:{subject, body}, open_url, invite_url }` (legt bei `{discord}` einen persönlichen Einladungslink an, wenn der Bot läuft)
- `POST /api/queue/:outreachId/sent` `{ mode, channel, target, platform, template_key, variant }` → `{ outreach }` (429 wenn Tageslimit erreicht)
- `POST /api/queue/:outreachId/skip` `{ reason:'later'|'unsuitable'|'no_contact' }` → `{ outreach }` (`later` = morgen wieder, `unsuitable` = Status ungeeignet, `no_contact` = Kontaktweg none + gesperrt)
- `GET /api/templates` → `{ items:[{key,step,channel,language,variant,subject,body,active,is_custom,updated_at}], placeholders:[{key,label}], languages:[…] }`
- `PUT /api/templates/:key` `{ subject?, body?, active? }` → `{ template }` (setzt `is_custom=1`)
- `POST /api/templates` `{ step, channel, language, variant, subject?, body }` → `{ template }`
- `DELETE /api/templates/:key` → `{ ok }` (nur eigene); `POST /api/templates/:key/reset` → `{ template }`
- `POST /api/templates/preview` `{ key? | subject?, body?, creatorId?, language? }` → `{ subject, body, missing:[placeholder] }`
- `POST /api/discovery/youtube` `{ languages?, queries?, maxSearches? }` → `{ runId }` (409 wenn schon läuft, 400 ohne Schlüssel)
- `POST /api/discovery/twitch` `{ languages?, minViewers?, maxViewers? }` → `{ runId }`
- `POST /api/discovery/:runId/cancel` → `{ ok }`
- `GET /api/discovery/runs?limit=20` → `{ items:[Run] }`, `GET /api/discovery/runs/:id` → `{ run }`
  `Run = { id, source, params, status:'laeuft'|'fertig'|'fehler'|'abgebrochen', found, added, updated, skipped, log, error, started_at, finished_at }`
- `GET /api/discovery/quota` → `{ youtube:{ day, searchesUsed, searchLimit, unitsUsed, unitLimit, keySet }, twitch:{ keySet } }`
- `POST /api/import/urls` `{ text, language?, tags? }` → `{ added, updated, skipped, errors:[{line, error}] }`
- `POST /api/import/csv` `{ csv, language?, tags? }` → gleiches Format
- `GET /api/export/creators.csv?<Filter wie /api/creators>` → CSV-Download
- `POST /api/capture` `{ platform?, url, handle?, name?, followers?, bio?, email?, language? }` → `{ id, created, creator }`
- `GET /api/bookmarklet` → `{ code, origin }` (fertiger `javascript:`-Link)
- `GET /api/stats` → `{ funnel:{status:n}, totals:{ creators, contacted, replied, interested, joined, members, live }, byLanguage:[{language, contacted, replied, interested, joined}], byChannel:[{channel, sent, replied}], byTemplate:[{template_key, variant, sent, replied, rate}], daily:[{day, sent, followups, replies}], discovery:{ byPlatform:[{platform,n}], byLanguage:[{language,n}] } }`
- `POST /api/maintenance/retention` → `{ deleted, cleared, refreshed }`; `POST /api/maintenance/rescore-all` → `{ updated }`

### Discord (Bot Teil A)
- `GET /api/discord/overview` → `{ bot, setupDone, missing:[text], counts:{ applications:{offen,eltern_ausstehend,angenommen,abgelehnt}, members, founding, testers }, upcoming:{ playtests:[…], events:[…] } }`
- `GET /api/discord/applications?status=` → `{ items:[application + creator display_name] }`
- `POST /api/discord/applications/:id/:action` (`accept|reject|parent-ok`) → `{ application }` (über `callBot('reviewApplication', id, action, null)`)
- `GET /api/discord/leaderboard?kind=creator|tester&limit=25` → `{ items:[{ discord_user_id, name, points, tier, rank }] }`
- `GET /api/discord/content?status=` → `{ items }`
- `POST /api/discord/invite/:creatorId` → `{ code, url }` (über `callBot('createPersonalInvite', creatorId)`)

### Playtests & Events (Bot Teil B)
- `GET /api/playtests` → `{ items:[playtest + { signups, waitlist, feedback }] }`
- `GET /api/playtests/:id` → `{ playtest, signups:[…], feedback:[…] }`
- `GET /api/playtests/:id/feedback.csv` → CSV
- `POST /api/playtests` `{ title, date, time, duration_min?, slots?, join_link?, description?, min_age? }` → `{ playtest }` (über `callBot('createPlaytest', data)`)
- `GET /api/bugs?status=` → `{ items }`; `PATCH /api/bugs/:id` `{ status }` → `{ bug }`
- `GET /api/events` → `{ items }`; `GET /api/events/:id` → `{ event, ccu:[{at, playing}], live:[…] }`
- `POST /api/events` `{ title, kind:'launch'|'event', date, time, duration_min?, repeat_weekly?, game_link?, description? }` → `{ event }` (über `callBot('createEvent', data)`)

## 7. Discord-Bot

### 7.1 Modul-Schnittstelle (`src/bot/modules/<name>.js`, default export)
```js
export default {
  name: 'playtests',
  commands: [new SlashCommandBuilder()...],       // Definitionen (werden als Server-Befehle registriert)
  commandHandlers: { playtest: async (interaction, ctx) => {} },
  autocomplete: { playtest: async (interaction, ctx) => {} },   // optional
  buttons: { pt: async (interaction, ctx) => {} },  // Schlüssel = customId-Präfix
  selects: { pt: async (interaction, ctx) => {} },
  modals: { pt: async (interaction, ctx) => {} },
  events: { [Events.GuildMemberAdd]: async (ctx, member) => {} },
  jobs: [{ name: 'reminders', everyMs: 60_000, run: async (ctx) => {} }],
  async onReady(ctx) {},                            // nach Login + Befehlsregistrierung
};
```
Fehler in Handlern fängt der Kern ab (Antwort + Eintrag in #bot-log). Handler, die länger als 2 s brauchen,
zuerst `deferReply`/`deferUpdate`. Antworten nur für den Nutzer: `flags: EPHEMERAL` (aus `src/bot/util.js`).

`ctx`: `client, log, bus, db(), settings(), updateSettings(), guildId(), guild(), isOurGuild(id), roleId(key), channelId(key), channel(key), member(userId), isStaff(member), provide(name, fn), post(key, payload), postLog(payload)`.

Helfer in `src/bot/util.js`: `EPHEMERAL, COLORS, langOf, tr(dict, locale, key, vars), publicText(dict, key, vars), fill, cid(prefix, action, ...args), parseCid, safeReply, replyEphemeral, embed({...}), tryDm(user, payload), mentionRole, mentionUser, chunkText, cleanUrl`.

### 7.2 customId-Präfixe (eindeutig je Modul)
| Modul | Präfixe |
|---|---|
| setup | `setup` |
| applications | `apply` (Bewerbende), `app` (Team-Prüfung) |
| creator | `cr`, `content` |
| live | `live` |
| leaderboard | `lb` |
| playtests | `pt` (Termine), `tester` (Tester werden), `fb` (Feedback) |
| bugs | `bug` |
| events | `ev` |

### 7.3 Rollen & Kanäle (von `/setup` angelegt, IDs in `settings.discord.roles|channels`)
Rollen: `creator` „Creator“, `founding` „Founding Creator“, `tester` „Tester“, `staff` „Creator-Team“.

| Schlüssel | Name | Kategorie | Wer sieht/schreibt |
|---|---|---|---|
| `infos` | creator-infos | 📣 CREATOR & TESTER | alle lesen, nur Bot schreibt |
| `apply` | creator-bewerbung | 📣 CREATOR & TESTER | alle lesen, nur Bot schreibt (Bewerben-Button) |
| `testerJoin` | tester-werden | 📣 CREATOR & TESTER | alle lesen, nur Bot schreibt (Tester-Button) |
| `start` | start-hier | 🎬 CREATOR HQ | Creator lesen |
| `kit` | creator-kit | 🎬 CREATOR HQ | Creator lesen |
| `launch` | launch-und-events | 🎬 CREATOR HQ | Creator lesen (Countdown, Erinnerungen, Spielerzahl) |
| `chat` | creator-chat | 🎬 CREATOR HQ | Creator schreiben |
| `live` | jetzt-live | 🎬 CREATOR HQ | Creator lesen (Bot postet) |
| `leaderboard` | rangliste | 🎬 CREATOR HQ | Creator lesen |
| `playtests` | playtest-termine | 🧪 PLAYTESTS | Tester+Creator lesen (Anmelde-Buttons) |
| `bugs` | bug-meldungen | 🧪 PLAYTESTS | Tester+Creator lesen, Threads |
| `testerChat` | tester-chat | 🧪 PLAYTESTS | Tester+Creator schreiben |
| `reviews` | bewerbungen | 🔒 TEAM | nur Team (Bewerbungen, Content-Prüfung) |
| `outreachLog` | outreach-log | 🔒 TEAM | nur Team (Beitritte über Einladungslinks, Annahmen) |
| `botLog` | bot-log | 🔒 TEAM | nur Team (Fehler, Hinweise) |

Kategorien: `catPublic`, `catHq`, `catPlaytest`, `catTeam` (ebenfalls unter `settings.discord.channels`).
Panels (Nachrichten mit Buttons) in `settings.discord.messages[key] = { channelId, messageId }`: `infos, apply, testerJoin, start, kit, leaderboard`.
Persönliche Einladungslinks zeigen auf `apply`.

### 7.4 Sprache im Bot
Antworten an eine Person: nach `interaction.locale` (de → Deutsch, sonst Englisch) mit `tr()`.
Öffentliche Posts: `publicText()` (Einstellung `discord.serverLanguage`: de|en|both).
Slash-Befehle: deutsche Namen + `setNameLocalizations`/`setDescriptionLocalizations` für `en-US`/`en-GB`.

### 7.5 Befehle (Übersicht)
- Bot A: `/setup` (Team), `/creator code|profil` (Creator), `/creator info|link|code-setzen|punkte|entfernen` (Team), `/content link typ`, `/live link`, `/rangliste typ`, `/hilfe`.
- Bot B: `/playtest erstellen|liste|absagen|beenden|teilnehmer` (Team), `/bug`, `/feedback`, `/event erstellen|liste|absagen` (Team).
Team-Befehle mit `setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)` und zusätzlich `ctx.isStaff` prüfen.

### 7.6 Regeln, die der Bot durchsetzt
- Unter 13: keine Aufnahme (Creator & Tester), keine Daten speichern.
- Unter `parentConsentUnder` (16): Status `eltern_ausstehend`, erst nach Team-Klick „Eltern-OK erhalten“ annehmen.
- Minderjährige: `paid_ok` bleibt 0; Bot erwähnt keine Bezahlung.
- Keine Robux-/Geldpreise, keine Gewinnspiele. Punkte = Status/Rang/Ingame-Items.
- Bot-DMs nur für eigene Vorgänge der Person (Bewerbungsstatus, Termin-Erinnerung, Feedback-Link).

## 8. Oberfläche (Dashboard)

Vanilla-JS-SPA ohne Build, Hash-Routing. Seiten: `#/start` (Checkliste, heutige Aufgaben, Zahlen), `#/senden`,
`#/creator` (+ Detail), `#/finden` (YouTube, Twitch, Import, Lesezeichen), `#/vorlagen`, `#/discord`, `#/playtests`,
`#/statistik`, `#/einstellungen`, `#/einrichtung` (Zugangsdaten + Schritt-für-Schritt).
Jede ändernde Anfrage mit Header `X-CLK: 1`. Senden-Seite: Enter = „Öffnen & Kopieren“, S = „Gesendet“,
L = „Später“, U = „Ungeeignet“. Kopieren mit `navigator.clipboard.writeText` (Fallback: Textarea + execCommand).

## 9. Tests
- `node:test` + `node:assert/strict`, Dateien `test/*.test.js`, Start: `npm test`.
- DB pro Test: `openDb(':memory:')` (setzt die Standard-DB) und danach `resetSettingsCache()`.
- Netz nie echt aufrufen: `fetchImpl` übergeben oder `globalThis.fetch` im Test ersetzen und wiederherstellen.
- Discord: Logik in reine Funktionen auslagern und diese testen; Befehls-Definitionen mit `commandDefinitions()` aus `src/bot/index.js` prüfen (wirft bei ungültigen Namen/Längen).
