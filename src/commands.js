/**
 * Alle Slash-Befehle. Admin-Befehle sind standardmäßig nur für Leute mit „Server verwalten“ sichtbar.
 * Unter Servereinstellungen → Integrationen → Bot kann man sie zusätzlich für eine Team-Rolle freigeben.
 */
const { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const textChannelTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Bot einrichten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('einstellungen')
        .setDescription('Kanäle und Rollen festlegen (ohne Optionen: aktuelle Einstellungen anzeigen)')
        .addRoleOption((o) => o.setName('tester-rolle').setDescription('Rolle, die angenommene Tester bekommen'))
        .addChannelOption((o) =>
          o
            .setName('bewerbungen-kanal')
            .setDescription('Privater Team-Kanal für Bewerbungen und Giveaway-Gewinner')
            .addChannelTypes(...textChannelTypes),
        )
        .addChannelOption((o) =>
          o
            .setName('ankuendigungen-kanal')
            .setDescription('Kanal für Playtests und Giveaways')
            .addChannelTypes(...textChannelTypes),
        )
        .addChannelOption((o) =>
          o
            .setName('bug-kanal')
            .setDescription('Forum- oder Textkanal für Bug-Reports')
            .addChannelTypes(ChannelType.GuildForum, ...textChannelTypes),
        )
        .addRoleOption((o) => o.setName('team-rolle').setDescription('Rolle, die Bewerbungen und Bugs bearbeiten darf')),
    )
    .addSubcommand((sub) =>
      sub.setName('bewerbungs-panel').setDescription('Postet die Regeln mit dem „Bewerben“-Button in diesem Kanal'),
    ),

  new SlashCommandBuilder()
    .setName('tester')
    .setDescription('Tester verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('hinzufuegen')
        .setDescription('Jemanden direkt als Tester aufnehmen (ohne Bewerbung)')
        .addUserOption((o) => o.setName('nutzer').setDescription('Discord-Nutzer').setRequired(true))
        .addStringOption((o) =>
          o.setName('roblox').setDescription('Roblox-Benutzername').setRequired(true).setMinLength(3).setMaxLength(20),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('entfernen')
        .setDescription('Tester-Status und Rolle entziehen')
        .addUserOption((o) => o.setName('nutzer').setDescription('Discord-Nutzer').setRequired(true))
        .addStringOption((o) => o.setName('grund').setDescription('Wird der Person per Nachricht geschickt').setMaxLength(300)),
    )
    .addSubcommand((sub) => sub.setName('anzahl').setDescription('Wie viele Tester gibt es?')),

  new SlashCommandBuilder()
    .setName('playtest')
    .setDescription('Playtests planen und auswerten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('erstellen')
        .setDescription('Neuen Playtest ankündigen')
        .addStringOption((o) => o.setName('titel').setDescription('z. B. „Neuer Arena-Modus“').setRequired(true).setMaxLength(80))
        .addStringOption((o) => o.setName('start').setDescription('Datum und Uhrzeit, z. B. 24.10.2026 18:00').setRequired(true))
        .addIntegerOption((o) => o.setName('dauer').setDescription('Dauer in Minuten (Standard 60)').setMinValue(10).setMaxValue(720))
        .addIntegerOption((o) =>
          o
            .setName('mindestzeit')
            .setDescription('Ab wie vielen Minuten Spielzeit zählt man als dabei? (Standard 15)')
            .setMinValue(1)
            .setMaxValue(720),
        )
        .addStringOption((o) => o.setName('beschreibung').setDescription('Was wird getestet?').setMaxLength(1000)),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Geplante Playtests anzeigen'))
    .addSubcommand((sub) =>
      sub
        .setName('auswertung')
        .setDescription('Wer war wie lange beim Playtest?')
        .addIntegerOption((o) => o.setName('id').setDescription('Playtest').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('absagen')
        .setDescription('Playtest absagen')
        .addIntegerOption((o) => o.setName('id').setDescription('Playtest').setRequired(true).setAutocomplete(true)),
    ),

  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaways für Tester')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('verlosung')
        .setDescription('Verlosung mit Teilnahme-Button')
        .addStringOption((o) => o.setName('preis').setDescription('z. B. „Discord-Deko“').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('dauer').setDescription('z. B. 12h, 3d, 1d 12h').setRequired(true))
        .addIntegerOption((o) => o.setName('gewinner').setDescription('Anzahl Gewinner (Standard 1)').setMinValue(1).setMaxValue(20))
        .addIntegerOption((o) =>
          o.setName('playtest').setDescription('Nur wer bei diesem Playtest gespielt hat').setAutocomplete(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('mindestzeit')
            .setDescription('Minuten, die man beim Playtest gespielt haben muss (Standard: wie beim Playtest)')
            .setMinValue(1)
            .setMaxValue(720),
        )
        .addBooleanOption((o) =>
          o.setName('gewichtet').setDescription('Extra-Lose für Playtest-Teilnahmen und Bug-Reports'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('rangliste')
        .setDescription('Die besten Tester im Zeitraum gewinnen (z. B. Platz 1–3 nach 5 Tagen)')
        .addStringOption((o) => o.setName('preis').setDescription('z. B. „Discord-Deko“').setRequired(true).setMaxLength(100))
        .addIntegerOption((o) => o.setName('tage').setDescription('Wie lange läuft es?').setRequired(true).setMinValue(1).setMaxValue(60))
        .addStringOption((o) =>
          o.setName('wert').setDescription('Wonach wird sortiert? (Standard: Spielzeit)').setAutocomplete(true),
        )
        .addIntegerOption((o) => o.setName('plaetze').setDescription('Wie viele Plätze gewinnen? (Standard 3)').setMinValue(1).setMaxValue(10)),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Laufende Giveaways anzeigen'))
    .addSubcommand((sub) =>
      sub
        .setName('beenden')
        .setDescription('Giveaway sofort beenden und auslosen')
        .addIntegerOption((o) => o.setName('id').setDescription('Giveaway').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('neu-auslosen')
        .setDescription('Einen weiteren Gewinner ziehen (z. B. wenn sich jemand nicht meldet)')
        .addIntegerOption((o) => o.setName('id').setDescription('Giveaway').setRequired(true).setAutocomplete(true)),
    ),

  new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Tester-Profil mit Spielzeit und Werten anzeigen')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('nutzer').setDescription('Discord-Nutzer (Standard: du)'))
    .addStringOption((o) => o.setName('roblox').setDescription('Oder Roblox-Benutzername')),

  new SlashCommandBuilder()
    .setName('rangliste')
    .setDescription('Bestenliste der Tester')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('wert').setDescription('Wonach sortieren? (Standard: Spielzeit)').setAutocomplete(true))
    .addIntegerOption((o) =>
      o.setName('tage').setDescription('Zeitraum in Tagen (Standard 7, 0 = gesamt)').setMinValue(0).setMaxValue(365),
    ),

  new SlashCommandBuilder().setName('bug').setDescription('Einen Bug melden').setContexts(InteractionContextType.Guild),
];

module.exports = { commands };
