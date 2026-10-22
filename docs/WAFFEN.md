# Waffen-Pipeline (WaveSpeed → Meshy → Roblox)

30 eigene Low-Poly-Waffen (realistisch, im Stil der CoD-Waffenklassen) und 10 Visiere
zum Aufstecken. Spieler können ihre Waffe anpassen: Jede Schusswaffe hat eine leere
Montageschiene plus Kimme & Korn, die Visiere werden einzeln draufgesetzt.

**Ablauf pro Modell:**
1. **WaveSpeed** erzeugt aus einem Text ein 2D-Konzeptbild (`concept.png`).
2. Das Bild wird geprüft.
3. **Meshy Image-to-3D** (Smart-Topology-Modus für Spiele) macht daraus ein Low-Poly-3D-Modell
   mit Textur (`<id>.glb`).

| Datei | Inhalt |
|---|---|
| `weapons/weapons.json` | Waffen, Visiere, Prompts und alle Einstellungen (Bildmodell, Meshy-Modus, Polygone) |
| `tools/generate_assets.py` | Führt den Ablauf aus, merkt sich den Fortschritt |
| `models/<klasse>/<id>/` | `concept.png`, `<id>.glb`, `preview.png`, `meta.json` |
| `models/asset_state.json` | Fortschritt; fertige Schritte werden nie doppelt bezahlt |

## Die 30 Waffen

„Standard-Visier“ ist das Visier, mit dem die Waffe ausgeliefert wird. Spieler können es tauschen.

| ID | Name | Klasse | Standard-Visier | Schaden | Schuss/Min | Magazin |
|---|---|---|---|---|---|---|
| `ar_vanguard` | Vanguard | Sturmgewehr | Rotpunkt | 28 | 750 | 30 |
| `ar_kestrel` | Kestrel-7 | Sturmgewehr | Holo-Visier | 26 | 820 | 30 |
| `ar_bastion` | Bastion 762 | Sturmgewehr | Kampfvisier 3× | 38 | 560 | 20 |
| `ar_ravager` | Ravager | Sturmgewehr | Kimme & Korn | 32 | 620 | 30 |
| `ar_halcyon` | Halcyon | Sturmgewehr | Reflexvisier | 27 | 780 | 32 |
| `ar_tundra` | Tundra-9 | Sturmgewehr | Holo-Visier | 25 | 860 | 30 |
| `ar_sentinel` | Sentinel | Sturmgewehr | Prisma 2× | 33 | 900 | 30 |
| `smg_wasp` | Wasp | Maschinenpistole | Rotpunkt | 21 | 950 | 32 |
| `smg_jackal` | Jackal | Maschinenpistole | Kimme & Korn | 23 | 850 | 30 |
| `smg_hornet` | Hornet PDW | Maschinenpistole | Reflexvisier | 19 | 1000 | 50 |
| `smg_viper` | Viper-45 | Maschinenpistole | Holo-Visier | 27 | 700 | 25 |
| `smg_ferret` | Ferret | Maschinenpistole | Kimme & Korn | 18 | 1100 | 30 |
| `smg_rattler` | Rattler | Maschinenpistole | Rotpunkt | 24 | 780 | 50 |
| `sg_breacher` | Breacher | Schrotflinte | Kimme & Korn | 14 ×8 | 70 | 6 |
| `sg_maul` | Maul-12 | Schrotflinte | Rotpunkt | 11 ×8 | 220 | 8 |
| `sg_rhino` | Rhino Drum | Schrotflinte | Holo-Visier | 9 ×8 | 360 | 20 |
| `lmg_juggernaut` | Juggernaut | LMG | Rotpunkt | 30 | 700 | 100 |
| `lmg_rampart` | Rampart | LMG | Kampfvisier 3× | 32 | 640 | 60 |
| `lmg_tempest` | Tempest | LMG | Holo-Visier | 28 | 780 | 120 |
| `dmr_falcon` | Falcon DMR | Marksman-Gewehr | Hybrid 4× | 55 | 300 | 15 |
| `dmr_lancer` | Lancer | Marksman-Gewehr | Kampfvisier 3× | 70 | 120 | 8 |
| `dmr_warden` | Warden | Marksman-Gewehr | Wärmebild 4× | 58 | 280 | 12 |
| `sr_obsidian` | Obsidian | Scharfschützengewehr | Sniper 8× | 110 | 45 | 5 |
| `sr_harbinger` | Harbinger .50 | Scharfschützengewehr | Sniper 12× | 150 | 40 | 5 |
| `sr_specter` | Specter | Scharfschützengewehr | Sniper 8× | 85 | 120 | 10 |
| `pst_rook` | Rook 9 | Pistole | Kimme & Korn | 25 | 400 | 15 |
| `pst_goliath` | Goliath .50 | Pistole | Kimme & Korn | 60 | 150 | 7 |
| `pst_hailstorm` | Hailstorm | Pistole | Mini-Rotpunkt | 17 | 1100 | 25 |
| `ln_hellfire` | Hellfire RL | Werfer | Prisma 2× | 150 | 30 | 1 |
| `ml_talon` | Talon | Nahkampf | – | 55 | 100 | – |

Die Werte sind Startwerte zum Balancen.

## Die 10 Visiere

| ID | Name | Zoom | ADS-FOV | Passt auf |
|---|---|---|---|---|
| `sight_mini_dot` | Mini-Rotpunkt | 1× | 58 | Pistolen + Gewehre |
| `sight_red_dot` | Rotpunkt | 1× | 55 | Gewehre |
| `sight_reflex_open` | Reflexvisier | 1× | 55 | Gewehre |
| `sight_holo` | Holo-Visier | 1× | 55 | Gewehre |
| `sight_prism_2x` | Prisma 2× | 2× | 35 | Gewehre |
| `sight_combat_3x` | Kampfvisier 3× | 3× | 25 | Gewehre |
| `sight_hybrid_4x` | Hybrid 4× | 4× | 20 | Gewehre |
| `sight_thermal_4x` | Wärmebild 4× | 4× | 20 | Gewehre |
| `sight_sniper_8x` | Sniper 8× | 8× | 9 | Gewehre |
| `sight_sniper_12x` | Sniper 12× | 12× | 6 | Gewehre |

ADS-FOV ist das Kamera-Sichtfeld beim Zielen (normales FOV: 70).

## 1. Einrichten

API-Schlüssel als Umgebungsvariablen setzen, **nie ins Repo schreiben**:

| Variable | Woher |
|---|---|
| `WAVESPEED_API_KEY` | wavespeed.ai → API Keys |
| `MESHY_API_KEY` | meshy.ai → API |

Lokal auf dem PC geht auch eine Datei `.env` im Repo-Ordner (ist in `.gitignore`):
```
WAVESPEED_API_KEY=...
MESHY_API_KEY=...
```

**In einer Claude-Cloud-Sitzung** zusätzlich unter *Network access → Allowed domains* eintragen:
`api.wavespeed.ai`, `api.meshy.ai`, `assets.meshy.ai`. Falls ein Download trotzdem
blockiert wird, die Domain aus der Fehlermeldung ergänzen.
Anleitung: https://code.claude.com/docs/en/cloud-environments#network-access

## 2. Erzeugen

```bash
# Zeigt Prompts und Einstellungen, kostet nichts
python3 tools/generate_assets.py --dry-run --test

# Test: Vanguard, Rook 9, Rotpunkt
python3 tools/generate_assets.py images --test   # nur Bilder -> concept.png prüfen
python3 tools/generate_assets.py models --test   # dann 3D-Modelle

# Danach alles
python3 tools/generate_assets.py images
python3 tools/generate_assets.py models
```

| Option | Wirkung |
|---|---|
| `images` / `models` / `all` | Nur Bilder, nur 3D oder beides |
| `--test` | Nur die 3 Testmodelle (`test_batch` in `weapons.json`) |
| `--only ID ...` | Nur bestimmte Waffen/Visiere |
| `--kind weapon` / `--kind sight` | Nur Waffen oder nur Visiere |
| `--redo` | Neu ab Bild (z. B. wenn das Bild nicht gefällt) |
| `--redo-model` | Bild behalten, nur das 3D-Modell neu |
| `--formats glb fbx` | Zusätzliche Formate laden (Standard: GLB) |

Fehlgeschlagene Schritte werden beim nächsten Start automatisch erneut versucht.

### Einstellungen in `weapons.json`

- **`wavespeed.model`**: Bildmodell. Standard ist `google/nano-banana/text-to-image`.
- **`meshy.params`**: Meshy-Modus. Standard ist Smart Topology (`model_type: smart-topology`,
  `ai_model: meshy-t2.5`), der günstige Spielemodus mit einstellbarer Polygonzahl.
- **Alternative Low Poly:** `meshy.params_alternative_lowpoly`. Dafür `params` ersetzen und
  `use_polycount` auf `false` setzen, denn Low Poly ignoriert die Polygonzahl.
- **`meshy.default_polycount`**: 4000. Einzelne Waffen haben eigene Werte, z. B. Pistolen 2500
  und Sniper 5000.

### Kosten (laut Meshy, zum Zeitpunkt der Erstellung)

Smart Topology ca. 5 Credits plus Textur ca. 10 Credits, also etwa 15 Credits pro Modell.
40 Modelle kosten damit rund **600 Meshy-Credits**, dazu kommen Neuversuche. WaveSpeed
rechnet pro Bild ab; den Preis zeigt die Modellseite auf wavespeed.ai.

## 3. Import in Roblox Studio

Diese Schritte kann ein lokales Claude mit Roblox-Studio-MCP übernehmen.

1. **Import:** *Datei → 3D importieren* → `<id>.glb`
2. **Ausrichten:** Lauf/Front zeigt nach **-Z** (`LookVector`), Oberseite nach **+Y**.
3. **Skalieren:** Die längste Seite auf `target_length_studs` aus `meta.json` bringen.

### Waffe

`ReplicatedStorage/Weapons/<klasse>/<id>`:
```
<Name> (Tool)        Attributes: Damage, RPM, MagSize, FireMode, Range, Pellets, DefaultSight
└── Handle (MeshPart)
    ├── SightMount (Attachment)  Oben auf der Schiene, wo Visiere einrasten
    ├── IronAim    (Attachment)  Zielpunkt über Kimme & Korn (wenn kein Visier drauf ist)
    ├── Muzzle     (Attachment)  Laufende
    ├── RightGrip  (Attachment)  Pistolengriff
    └── LeftGrip   (Attachment)  Handschutz / Vordergriff
```

### Visier

`ReplicatedStorage/Sights/<id>`:
```
<Name> (Model)       Attributes: Zoom, AdsFov, Fits ("rail" / "slide,rail")
└── Body (MeshPart)
    ├── Mount    (Attachment)  Unterseite der Montage; wird auf SightMount der Waffe gesetzt
    └── AimPoint (Attachment)  Mitte der Linse; hier liegt die Kamera beim Zielen
```

### Visier anbringen (Spiel-Code)

1. Visier klonen und den `Mount` des Visiers per `WeldConstraint` oder `Motor6D` exakt auf den
   `SightMount` der Waffe setzen.
2. Beim Zielen die Kamera auf den `AimPoint` des Visiers legen. Ohne Visier gilt der
   `IronAim` der Waffe.
3. Das Sichtfeld auf `AdsFov` des Visiers stellen.
4. Bei 4× und mehr ein Scope-Overlay (`ScreenGui` mit Fadenkreuz) einblenden und das
   Waffenmodell ausblenden.

## Hinweise

- Meshy erzeugt ein Modell aus einem Stück. Bewegliche Teile (Magazin, Verschluss) sind
  nicht getrennt.
- Visiere müssen in Studio einmal auf eine einheitliche Größe gebracht werden (`length_studs`).
- Hochgeladene Meshes werden von Roblox moderiert und sind erst danach nutzbar.
- Später möglich: Schalldämpfer, Griffe und Magazine nach dem gleichen Prinzip.
