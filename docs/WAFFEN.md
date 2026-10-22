# Waffen-Pipeline (Meshy AI → Roblox)

40 eigene Low-Poly-Waffen im Stil der CoD-Waffenklassen, neutral (ohne Skins), mit
Visier/Zielfernrohr, damit sie im FPS-Modus (Zielen über Kimme, Rotpunkt oder Scope)
nutzbar sind.

| Datei | Inhalt |
|---|---|
| `weapons/weapons.json` | Alle 40 Waffen: Name, Klasse, Visier, Meshy-Beschreibung, Startwerte (Schaden, Feuerrate, Magazin) |
| `tools/meshy_generate.py` | Schickt die Waffen an Meshy, wartet und lädt die fertigen Modelle herunter |
| `models/<klasse>/<id>/` | Ergebnis pro Waffe: `<id>.glb`, `preview.png`, `meta.json` |
| `models/meshy_state.json` | Fortschritt (welche Waffe ist fertig), damit nichts doppelt bezahlt wird |

## Die 40 Waffen

| ID | Name | Klasse | Visier | Schaden | Schuss/Min | Magazin |
|---|---|---|---|---|---|---|
| `ar_vanguard` | Vanguard | Sturmgewehr | Rotpunkt | 28 | 750 | 30 |
| `ar_kestrel` | Kestrel-7 | Sturmgewehr | Holo | 26 | 820 | 30 |
| `ar_bastion` | Bastion 762 | Sturmgewehr | Zielfernrohr 3× | 38 | 560 | 20 |
| `ar_ravager` | Ravager | Sturmgewehr | Kimme & Korn | 32 | 620 | 30 |
| `ar_halcyon` | Halcyon | Sturmgewehr | Rotpunkt | 27 | 780 | 32 |
| `ar_tundra` | Tundra-9 | Sturmgewehr | Holo | 25 | 860 | 30 |
| `ar_ironclad` | Ironclad | Sturmgewehr | Kimme & Korn | 33 | 900 | 30 |
| `ar_sentinel` | Sentinel | Sturmgewehr | Zielfernrohr 2× | 30 | 680 | 30 |
| `smg_wasp` | Wasp | Maschinenpistole | Rotpunkt | 21 | 950 | 32 |
| `smg_jackal` | Jackal | Maschinenpistole | Kimme & Korn | 23 | 850 | 30 |
| `smg_hornet` | Hornet PDW | Maschinenpistole | Rotpunkt | 19 | 1000 | 50 |
| `smg_viper` | Viper-45 | Maschinenpistole | Holo | 27 | 700 | 25 |
| `smg_ferret` | Ferret | Maschinenpistole | Kimme & Korn | 18 | 1100 | 30 |
| `smg_mantis` | Mantis | Maschinenpistole | Rotpunkt | 20 | 900 | 64 |
| `smg_rattler` | Rattler | Maschinenpistole | Kimme & Korn | 24 | 780 | 50 |
| `sg_breacher` | Breacher | Schrotflinte | Kimme & Korn | 14 ×8 | 70 | 6 |
| `sg_maul` | Maul-12 | Schrotflinte | Rotpunkt | 11 ×8 | 220 | 8 |
| `sg_twinfang` | Twinfang | Schrotflinte | Kimme & Korn | 18 ×10 | 300 | 2 |
| `sg_rhino` | Rhino Drum | Schrotflinte | Holo | 9 ×8 | 360 | 20 |
| `lmg_juggernaut` | Juggernaut | LMG | Rotpunkt | 30 | 700 | 100 |
| `lmg_anvil` | Anvil | LMG | Kimme & Korn | 34 | 600 | 75 |
| `lmg_rampart` | Rampart | LMG | Zielfernrohr 3× | 32 | 640 | 60 |
| `lmg_tempest` | Tempest | LMG | Holo | 28 | 780 | 120 |
| `dmr_falcon` | Falcon DMR | Marksman-Gewehr | Zielfernrohr 4× | 55 | 300 | 15 |
| `dmr_lancer` | Lancer | Marksman-Gewehr | Zielfernrohr 3× | 70 | 120 | 8 |
| `dmr_warden` | Warden | Marksman-Gewehr | Zielfernrohr 4× | 58 | 280 | 12 |
| `dmr_stinger` | Stinger (Armbrust) | Marksman-Gewehr | Rotpunkt | 100 | 50 | 1 |
| `sr_obsidian` | Obsidian | Scharfschützengewehr | Zielfernrohr 8× | 110 | 45 | 5 |
| `sr_harbinger` | Harbinger .50 | Scharfschützengewehr | Zielfernrohr 10× | 150 | 40 | 5 |
| `sr_specter` | Specter | Scharfschützengewehr | Zielfernrohr 6× | 85 | 120 | 10 |
| `sr_needle` | Needle | Scharfschützengewehr | Zielfernrohr 8× | 100 | 60 | 6 |
| `pst_rook` | Rook 9 | Pistole | Kimme & Korn | 25 | 400 | 15 |
| `pst_bulldog` | Bulldog | Pistole | Kimme & Korn | 45 | 180 | 6 |
| `pst_goliath` | Goliath .50 | Pistole | Kimme & Korn | 60 | 150 | 7 |
| `pst_hailstorm` | Hailstorm | Pistole | Rotpunkt | 17 | 1100 | 25 |
| `pst_arbiter` | Arbiter | Pistole | Rotpunkt | 23 | 900 | 18 |
| `ln_hellfire` | Hellfire RL | Werfer | Zielfernrohr 2× | 150 | 30 | 1 |
| `ln_thumper` | Thumper GL | Werfer | Kimme & Korn | 120 | 90 | 6 |
| `ml_talon` | Talon | Nahkampf | – | 55 | 100 | – |
| `ml_cleaver` | Cleaver | Nahkampf | – | 75 | 70 | – |

Die Werte sind Startwerte zum Balancen, keine fertige Balance.

## 1. Einrichten (einmalig)

1. **Meshy-API-Schlüssel** im Meshy-Konto erstellen (die API braucht in der Regel ein
   bezahltes Abo). Als Umgebungsvariable `MESHY_API_KEY` hinterlegen, **nie** ins Repo
   oder in einen Chat schreiben.
2. **Nur für Claude-Cloud-Sitzungen:** In den Umgebungseinstellungen unter
   *Network access → Allowed domains* `api.meshy.ai` eintragen. Die Download-Links der
   fertigen Modelle können auf einer anderen Meshy-Domain liegen (z. B.
   `assets.meshy.ai`). Wenn der Download blockiert wird, die Domain aus der
   Fehlermeldung ebenfalls eintragen.
   Anleitung: https://code.claude.com/docs/en/cloud-environments#network-access

## 2. Modelle erzeugen

```bash
# Nur anzeigen, was an Meshy geschickt würde (kostet nichts)
python3 tools/meshy_generate.py --dry-run

# Erst EINE Waffe testen und das Ergebnis ansehen
python3 tools/meshy_generate.py --only ar_vanguard

# Eine Klasse
python3 tools/meshy_generate.py --category smg

# Alle 40
python3 tools/meshy_generate.py
```

Nützliche Optionen:

| Option | Wirkung |
|---|---|
| `--no-texture` | Nur Form, keine Textur: halb so viele Meshy-Aufträge, graue Modelle |
| `--formats glb fbx` | Zusätzlich FBX laden (Standard ist nur GLB, das enthält die Textur in einer Datei) |
| `--polycount 3000` | Polygonzahl für alle Waffen überschreiben |
| `--parallel 4` | Wie viele Meshy-Aufträge gleichzeitig laufen |
| `--retry-failed` | Fehlgeschlagene Waffen erneut versuchen |

**Kosten:** Pro Waffe laufen 2 Meshy-Aufträge (Form + Textur), bei 40 Waffen also 80.
Jeder kostet Meshy-Credits; aktuelle Preise auf meshy.ai prüfen. Das Skript merkt sich
fertige Waffen und bezahlt sie bei einem Neustart nicht noch einmal.

**Eine Waffe neu machen:** Ihren Eintrag aus `models/meshy_state.json` löschen und das
Skript mit `--only <id>` starten. Gefällt die Form grundsätzlich nicht, zuerst die
`description` in `weapons/weapons.json` anpassen.

## 3. Import in Roblox Studio (für FPS)

Diese Schritte kann ein lokales Claude mit Roblox-Studio-MCP übernehmen, oder man macht
sie von Hand.

1. **Import:** Studio → *Datei → 3D importieren* (3D Importer) → `models/<klasse>/<id>/<id>.glb`.
   Ein MeshPart mit Textur entsteht.
2. **Ausrichten:** Lauf zeigt in Richtung **-Z** des Teils (Roblox `LookVector`), Oberseite
   (Visier) nach **+Y**.
3. **Skalieren:** Die längste Seite auf `target_length_studs` aus `meta.json` bringen
   (Sturmgewehr ≈ 3,2 Studs, Pistole ≈ 1,0, Sniper ≈ 4,3).
4. **Aufbau pro Waffe** als Tool in `ReplicatedStorage/Weapons/<klasse>/<id>`:
   ```
   <Name> (Tool)
   └── Handle (MeshPart, das importierte Modell)
       ├── AimPoint   (Attachment) Mitte des Visiers / Rotpunkts / Zielfernrohrs.
       │                           Beim Zielen (ADS) liegt die Kamera genau hier.
       ├── Muzzle     (Attachment) Laufende: Mündungsfeuer, Projektil-Start
       ├── RightGrip  (Attachment) Pistolengriff: rechte Hand
       └── LeftGrip   (Attachment) Handschutz/Vordergriff: linke Hand (Pistolen: leer lassen)
   ```
5. **Werte als Attributes** am Tool setzen (aus `meta.json`): `Damage`, `RPM`, `MagSize`,
   `FireMode`, `Range`, `Sight` und bei Schrotflinten `Pellets`.
6. **Kollision:** `CanCollide = false`, `CanQuery = false`, `Massless = true` am Handle.

### Zielen (ADS) je Visier

Vorschlag für das Kamera-Sichtfeld beim Zielen (Basis-FOV 70):

| Visier | ADS-FOV | Hinweis |
|---|---|---|
| Kimme & Korn | 60 | Kamera auf `AimPoint` |
| Rotpunkt / Holo | 55 | Kamera auf `AimPoint`, Punkt per `SurfaceGui`/`Decal` oder Neon-Part |
| Zielfernrohr 2×–3× | 35–25 | 3D-Optik reicht |
| Zielfernrohr 4×–10× | 20–7 | Scope-Overlay als `ScreenGui` (schwarzer Rand + Fadenkreuz) einblenden und das Waffenmodell ausblenden |

Low-Poly-Meshes von Meshy haben keine echte Glaslinse. Bei starken Zielfernrohren ist das
Overlay deshalb die übliche Lösung in Roblox-Shootern.

## Hinweise

- Roblox begrenzt die Dreiecke pro MeshPart. Die Waffen sind auf 1.500–5.000 Polygone
  eingestellt und liegen damit deutlich darunter.
- Hochgeladene Meshes und Texturen werden von Roblox moderiert und sind erst danach nutzbar.
- Meshy erzeugt ein Modell aus einem Stück. Bewegliche Teile (Magazin, Verschluss) sind
  nicht getrennt. Für Nachlade-Animationen müsste man sie später in Blender abtrennen.
