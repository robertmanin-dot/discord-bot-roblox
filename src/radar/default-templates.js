// Standard-Nachrichtenvorlagen (werden beim Start in die Datenbank übernommen und sind im Dashboard bearbeitbar).
// Format: { key: 'first.email.de.A', step, channel, language, variant, subject?, body }
//
// Platzhalter: {name} {video} {game} {pitch} {date} {time} {link} {discord} {sender} {studio} {privacy} {reward} {platform}
// Bedingte Teile: [[Text mit {video}||Ersatztext]] – erster Teil, wenn alle Platzhalter darin gefüllt sind, sonst der Ersatz.
//
// Hinweise:
// - Variante B testet einen anderen Einstieg/Betreff und – wenn verfügbar – den direkten Discord-Link statt der Infoseite.
// - Für es/pt/fr/pl/tr sind Spielbeschreibung und Code-Belohnung direkt in der jeweiligen Sprache geschrieben,
//   weil es in den Einstellungen nur einen deutschen und englischen Pitch gibt (sonst stünde Englisch mitten im Text).
//   Wenn sich das Spielprinzip ändert: diese Vorlagen im Dashboard anpassen.
// - Bewusst nie enthalten: Geld, Robux, Gewinnspiele, künstliche Knappheit.

const t = (step, channel, language, variant, body, subject) => ({
  key: `${step}.${channel}.${language}.${variant}`,
  step,
  channel,
  language,
  variant,
  ...(subject ? { subject } : {}),
  body: body.trim(),
});

export const DEFAULT_TEMPLATES = [
  // ===================================================================== Deutsch
  t('first', 'email', 'de', 'A', `
Hey {name},

ich bin {sender} von {studio}. [[Ich bin über dein Video „{video}“ auf dich gestoßen – genau so ein Kanal passt zu unserem Spiel.||Ich bin über deinen Kanal auf dich gestoßen – genau so ein Kanal passt zu unserem Spiel.]]

Wir bringen das Roblox-Spiel {game} raus.[[ {pitch}||]] Launch ist am {date} um {time}.

Dafür stelle ich ein kleines Team aus Founding Creatorn zusammen:
• Du spielst vor allen anderen (eigene Creator-Playtests)
• Du bekommst einen eigenen Creator-Code – deine Zuschauer erhalten damit {reward}
• Dein Name kommt auf die Creator-Wall im Spiel

Alle Infos: {link}

Hast du Lust, dabei zu sein? Ein kurzes „Ja“ reicht, dann schicke ich dir den Rest.

Viele Grüße
{sender}
{studio}

[[Deine Kontaktdaten habe ich aus deinem öffentlichen {platform}-Profil.||Deine Kontaktdaten habe ich aus deinem öffentlichen Profil.]] Kein Interesse? Antworte einfach mit „Nein“ – dann melde ich mich nicht mehr und lösche deinen Eintrag. Datenschutz: {privacy}
`, 'Kooperationsanfrage: Founding Creator für {game}'),

  t('first', 'email', 'de', 'B', `
Hi {name},

[[dein Video „{video}“ hat mir richtig gut gefallen.||ich schaue mir gerade Roblox-Kanäle an, und deiner ist mir im Kopf geblieben.]] Ich bin {sender} von {studio}, und am {date} um {time} launchen wir unser Roblox-Spiel {game}.[[ {pitch}||]]

Ich lade ein paar Creator ein, das Spiel vor allen anderen zu spielen – als Founding Creator. Das heißt für dich:
• früher Zugang und Content, den noch niemand hat
• ein eigener Creator-Code: deine Zuschauer bekommen damit {reward}
• dein Name auf der Creator-Wall im Spiel

[[Wenn du magst, komm direkt in unseren Creator-Discord: {discord}||Hier steht alles auf einen Blick: {link}]]

Wärst du dabei?

Liebe Grüße
{sender} · {studio}

[[Deinen Kontakt habe ich aus deinem öffentlichen {platform}-Profil.||Deinen Kontakt habe ich aus deinem öffentlichen Profil.]] Wenn du keine weiteren Nachrichten möchtest, schreib kurz „Nein“ – dann lösche ich deinen Eintrag. Datenschutz: {privacy}
`, 'Vor allen anderen spielen: {game} (neues Roblox-Spiel)'),

  t('first', 'dm', 'de', 'A', `
Hey {name}! 👋 [[Hab dein Video „{video}“ gesehen – richtig stark.||Bin über deinen Kanal gestolpert – richtig stark.]] Ich bin {sender} von {studio}, und am {date} um {time} launchen wir das Roblox-Spiel {game}.[[ {pitch}||]] Dafür suche ich Founding Creator: früher Zugang, eigener Creator-Code ({reward} für deine Zuschauer) und dein Name auf der Creator-Wall im Spiel. Hast du Lust? Infos: {link}
[[Kontakt aus deinem öffentlichen {platform}-Profil.||Kontakt aus deinem öffentlichen Profil.]] Kein Interesse? Schreib „Nein“, dann melde ich mich nicht mehr. Datenschutz: {privacy}
`),

  t('first', 'dm', 'de', 'B', `
Hi {name}! [[Dein Video „{video}“ hat mich direkt abgeholt.||Dein Content hat mich direkt abgeholt.]] Kurz zu mir: {sender}, {studio}. Am {date} um {time} kommt unser Roblox-Spiel {game} raus.[[ {pitch}||]] Ich lade ein paar Creator ein, es vorher zu spielen – als Founding Creator mit eigenem Code ({reward} für deine Community) und Platz auf der Creator-Wall. Wärst du dabei? [[Unser Creator-Discord: {discord}||Alles Weitere: {link}]]
[[Deinen Kontakt hab ich aus deinem öffentlichen {platform}-Profil.||Deinen Kontakt hab ich aus deinem öffentlichen Profil.]] Lieber nicht? Ein „Nein“ reicht, dann schreibe ich nicht mehr. Datenschutz: {privacy}
`),

  t('first', 'discord', 'de', 'A', `
Hallo zusammen! 👋 Ich bin {sender} von {studio} und hätte eine Kooperationsanfrage an {name}.
[[Ich bin über das Video „{video}“ auf {name} gestoßen und finde, das passt richtig gut zu unserem Spiel.||Ich finde, {name} passt richtig gut zu unserem Spiel.]] Am {date} um {time} launchen wir das Roblox-Spiel {game}.[[ {pitch}||]]
Ich würde {name} gern als Founding Creator dabeihaben: früher Zugang, ein eigener Creator-Code ({reward} für die Community) und ein Platz auf der Creator-Wall im Spiel.
Hätte {name} Lust? Alle Infos: {link}
Euren Server habe ich über das öffentliche Profil gefunden. Kein Interesse? Eine kurze Rückmeldung reicht, dann frage ich nicht nochmal. Datenschutz: {privacy}
`),

  t('first', 'discord', 'de', 'B', `
Hey! Kurze Kooperationsanfrage an {name} 🙂 Ich bin {sender} ({studio}). Unser Roblox-Spiel {game} startet am {date} um {time}.[[ {pitch}||]]
[[Das Video „{video}“ hat mich überzeugt, dass {name} perfekt passen würde.||Ich glaube, {name} würde perfekt passen.]] Als Founding Creator gäbe es: früher Zugang, einen eigenen Creator-Code ({reward} für die Zuschauer) und einen Platz auf der Creator-Wall.
Wäre das was? [[Direkt in unseren Creator-Discord: {discord}||Infos: {link}]]
Gefunden habe ich euch über das öffentliche Profil. Lieber nicht? Kurz Bescheid sagen, dann melde ich mich nicht mehr. Datenschutz: {privacy}
`),

  t('followup', 'email', 'de', 'A', `
Hey {name},

ich wollte kurz nachfragen, ob meine Nachricht zu {game} angekommen ist. Launch ist am {date} um {time} – und wenn du Lust hast, bist du als Founding Creator herzlich willkommen: früher Zugang, eigener Creator-Code und dein Name auf der Creator-Wall.

Alle Infos: {link}

Das ist meine letzte Nachricht dazu. Wenn es gerade nicht passt, ist das völlig okay.

Viele Grüße
{sender}
{studio}

Keine weiteren Nachrichten? Antworte kurz mit „Nein“, dann lösche ich deinen Eintrag. Datenschutz: {privacy}
`, 'Kurze Nachfrage zu {game}'),

  t('followup', 'email', 'de', 'B', `
Hi {name},

ein letztes kurzes Hallo von mir: Am {date} um {time} startet {game}, und mein Angebot steht noch – früher Zugang, ein eigener Creator-Code mit {reward} für deine Zuschauer und dein Name auf der Creator-Wall.

[[Wenn du magst, komm direkt in unseren Creator-Discord: {discord}||Alle Infos findest du hier: {link}]]

Danach melde ich mich nicht mehr – versprochen. Viel Erfolg mit deinem Kanal!

Liebe Grüße
{sender} · {studio}

Kein Interesse? Ein kurzes „Nein“ reicht, dann lösche ich deinen Eintrag. Datenschutz: {privacy}
`, 'Letzte Nachricht von mir: {game} & Founding Creator'),

  // ===================================================================== English
  t('first', 'email', 'en', 'A', `
Hi {name},

I'm {sender} from {studio}. [[I came across your video "{video}" and your channel is a great fit for our game.||I came across your channel and it's a great fit for our game.]]

We're launching our Roblox game {game} on {date} at {time}.[[ {pitch}||]]

For the launch I'm putting together a small team of Founding Creators:
• You play before everyone else (creator-only playtests)
• You get your own creator code – your viewers get {reward}
• Your name goes on the Creator Wall in the game

All the details: {link}

Would you like to join? A quick "yes" is enough and I'll send you the rest.

Best,
{sender}
{studio}

[[I found your contact details on your public {platform} profile.||I found your contact details on your public profile.]] Not interested? Just reply "no" – I won't contact you again and I'll delete your details. Privacy policy: {privacy}
`, 'Collaboration request: Founding Creator for {game}'),

  t('first', 'email', 'en', 'B', `
Hey {name},

[[Really enjoyed your video "{video}".||I've been checking out Roblox channels and yours stood out.]] I'm {sender} from {studio}, and on {date} at {time} we're launching our Roblox game {game}.[[ {pitch}||]]

I'm inviting a few creators to play it before anyone else – as Founding Creators. For you that means:
• early access and content nobody else has yet
• your own creator code: your viewers get {reward}
• your name on the Creator Wall in the game

[[If you like, jump straight into our creator Discord: {discord}||Everything at a glance: {link}]]

Would you be up for it?

Cheers,
{sender} · {studio}

[[I found your contact on your public {platform} profile.||I found your contact on your public profile.]] If you'd rather not hear from me again, just reply "no" and I'll delete your details. Privacy policy: {privacy}
`, 'Play {game} before everyone else (new Roblox game)'),

  t('first', 'dm', 'en', 'A', `
Hey {name}! 👋 [[Just watched your video "{video}" – loved it.||Just came across your channel – love it.]] I'm {sender} from {studio}, and we're launching our Roblox game {game} on {date} at {time}.[[ {pitch}||]] I'm looking for Founding Creators who get in early: your own creator code ({reward} for your viewers) and your name on the in-game Creator Wall. Interested? Info: {link}
[[Contact found on your public {platform} profile.||Contact found on your public profile.]] Not interested? Reply "no" and I won't message you again. Privacy: {privacy}
`),

  t('first', 'dm', 'en', 'B', `
Hi {name}! [[Your video "{video}" got me hooked.||Your content got me hooked.]] Quick intro: {sender}, {studio}. Our Roblox game {game} comes out on {date} at {time}.[[ {pitch}||]] I'm inviting a few creators to play it early as Founding Creators – with your own code ({reward} for your community) and a spot on the Creator Wall. Would you be in? [[Our creator Discord: {discord}||More info: {link}]]
[[Got your contact from your public {platform} profile.||Got your contact from your public profile.]] Rather not? A quick "no" and I'll stop messaging. Privacy: {privacy}
`),

  t('first', 'discord', 'en', 'A', `
Hi everyone! 👋 I'm {sender} from {studio} and I have a collaboration request for {name}.
[[I found {name} through the video "{video}" and think it's a great fit for our game.||I think {name} would be a great fit for our game.]] We're launching our Roblox game {game} on {date} at {time}.[[ {pitch}||]]
I'd love to have {name} as a Founding Creator: early access, a personal creator code ({reward} for the community) and a spot on the in-game Creator Wall.
Would {name} be interested? All the details: {link}
I found your server via the public profile. Not interested? A quick reply is enough and I won't ask again. Privacy: {privacy}
`),

  t('first', 'discord', 'en', 'B', `
Hey! Quick collaboration request for {name} 🙂 I'm {sender} ({studio}). Our Roblox game {game} launches on {date} at {time}.[[ {pitch}||]]
[[The video "{video}" convinced me that {name} would be a perfect fit.||I think {name} would be a perfect fit.]] As a Founding Creator there'd be early access, a personal creator code ({reward} for viewers) and a spot on the Creator Wall.
Sound good? [[Straight to our creator Discord: {discord}||Info: {link}]]
Found you via the public profile. Rather not? Just let me know and I won't reach out again. Privacy: {privacy}
`),

  t('followup', 'email', 'en', 'A', `
Hi {name},

Just checking whether my message about {game} reached you. We launch on {date} at {time} – and if you're up for it, you're very welcome to join as a Founding Creator: early access, your own creator code and your name on the Creator Wall.

All the details: {link}

This is my last message about it. If now isn't a good time, that's totally fine.

Best,
{sender}
{studio}

Don't want any more messages? Reply "no" and I'll delete your details. Privacy policy: {privacy}
`, 'Quick follow-up about {game}'),

  t('followup', 'email', 'en', 'B', `
Hey {name},

One last quick hello from me: {game} launches on {date} at {time}, and my offer still stands – early access, your own creator code with {reward} for your viewers, and your name on the Creator Wall.

[[If you like, jump straight into our creator Discord: {discord}||You'll find all the details here: {link}]]

After this I won't message you again – promise. Good luck with your channel!

Cheers,
{sender} · {studio}

Not interested? A quick "no" is enough and I'll delete your details. Privacy policy: {privacy}
`, 'Last message from me: {game} & Founding Creator'),

  // ===================================================================== Español
  t('first', 'email', 'es', 'A', `
¡Hola, {name}!

Soy {sender}, de {studio}. [[Vi tu video “{video}” y tu canal encaja perfecto con nuestro juego.||Encontré tu canal y encaja perfecto con nuestro juego.]]

El {date} a las {time} lanzamos {game}, un juego nuevo de Roblox: un shooter por equipos en el que se pelea por los bloques del centro del mapa, y gana el primer equipo que termina su torre.

Para el lanzamiento estoy formando un pequeño equipo de Founding Creators:
• Juegas antes que nadie (pruebas exclusivas para creadores)
• Tienes tu propio código de creador: tus espectadores reciben un ítem exclusivo que no se puede comprar
• Tu nombre aparece en el Muro de Creadores dentro del juego

Toda la información: {link}

¿Te gustaría participar? Con un “sí” basta y te mando el resto.

Saludos,
{sender}
{studio}

[[Encontré tus datos de contacto en tu perfil público de {platform}.||Encontré tus datos de contacto en tu perfil público.]] ¿No te interesa? Responde “no” y no te volveré a escribir; además, borraré tus datos. Privacidad: {privacy}
`, 'Propuesta de colaboración: Founding Creator para {game}'),

  t('first', 'dm', 'es', 'A', `
¡Hola, {name}! 👋 [[Vi tu video “{video}” y me encantó.||Encontré tu canal y me encantó.]] Soy {sender}, de {studio}. El {date} a las {time} lanzamos {game}, un shooter por equipos en Roblox: se pelea por los bloques del centro y gana el primer equipo que termina su torre. Busco Founding Creators que jueguen antes que nadie: código de creador propio (tus espectadores reciben un ítem exclusivo que no se puede comprar) y tu nombre en el Muro de Creadores del juego. ¿Te animas? Info: {link}
[[Tu contacto viene de tu perfil público de {platform}.||Tu contacto viene de tu perfil público.]] ¿No te interesa? Responde “no” y no te escribo más. Privacidad: {privacy}
`),

  t('first', 'discord', 'es', 'A', `
¡Hola a todos! 👋 Soy {sender}, de {studio}, y tengo una propuesta de colaboración para {name}.
[[Conocí a {name} por el video “{video}” y creo que encaja perfecto con nuestro juego.||Creo que {name} encaja perfecto con nuestro juego.]] El {date} a las {time} lanzamos {game}, un shooter por equipos en Roblox en el que gana el primer equipo que termina su torre.
Me encantaría tener a {name} como Founding Creator: acceso anticipado, código de creador propio (un ítem exclusivo para la comunidad) y un lugar en el Muro de Creadores del juego.
¿Le interesaría? Toda la info: {link}
Encontré este servidor en el perfil público. ¿No hay interés? Con una respuesta corta basta y no vuelvo a preguntar. Privacidad: {privacy}
`),

  t('followup', 'email', 'es', 'A', `
¡Hola, {name}!

Solo quería saber si te llegó mi mensaje sobre {game}. El lanzamiento es el {date} a las {time}, y la invitación sigue en pie: acceso anticipado como Founding Creator, tu propio código de creador y tu nombre en el Muro de Creadores.

Toda la información: {link}

Este es mi último mensaje sobre el tema. Si ahora no es buen momento, no pasa nada.

Saludos,
{sender}
{studio}

¿No quieres recibir más mensajes? Responde “no” y borraré tus datos. Privacidad: {privacy}
`, 'Pequeño recordatorio sobre {game}'),

  // ===================================================================== Português (Brasil)
  t('first', 'email', 'pt', 'A', `
Oi, {name}!

Eu sou {sender}, do estúdio {studio}. [[Vi seu vídeo “{video}” e achei que seu canal tem tudo a ver com o nosso jogo.||Conheci seu canal e achei que ele tem tudo a ver com o nosso jogo.]]

Vamos lançar {game}, um jogo novo no Roblox: um shooter em equipe em que vocês disputam os blocos do meio do mapa – e vence quem terminar a torre primeiro. O lançamento é {date}, às {time}.

Para o lançamento, estou montando um pequeno time de Founding Creators:
• Você joga antes de todo mundo (playtests exclusivos para criadores)
• Você ganha seu próprio código de criador: seus espectadores recebem um item exclusivo que não dá para comprar
• Seu nome entra no Mural dos Criadores dentro do jogo

Todas as informações: {link}

Topa participar? Um “sim” já basta, aí eu te mando o resto.

Abraços,
{sender}
{studio}

[[Encontrei seu contato no seu perfil público do {platform}.||Encontrei seu contato no seu perfil público.]] Não tem interesse? É só responder “não” que eu não entro mais em contato e apago seus dados. Privacidade: {privacy}
`, 'Proposta de parceria: Founding Creator de {game}'),

  t('first', 'dm', 'pt', 'A', `
Oi, {name}! 👋 [[Vi seu vídeo “{video}” e curti demais.||Conheci seu canal e curti demais.]] Sou {sender}, do estúdio {studio}. Vamos lançar {game} no Roblox – um shooter em equipe em que vence quem termina a torre primeiro. Lançamento: {date}, às {time}. Estou chamando Founding Creators para jogar antes de todo mundo: código de criador próprio (seus espectadores ganham um item exclusivo que não dá para comprar) e seu nome no Mural dos Criadores. Topa? Infos: {link}
[[Contato encontrado no seu perfil público do {platform}.||Contato encontrado no seu perfil público.]] Sem interesse? Responda “não” e eu paro de mandar mensagem. Privacidade: {privacy}
`),

  t('first', 'discord', 'pt', 'A', `
Oi, pessoal! 👋 Sou {sender}, do estúdio {studio}, e tenho uma proposta de parceria para {name}.
[[Conheci {name} pelo vídeo “{video}” e acho que tem tudo a ver com o nosso jogo.||Acho que {name} tem tudo a ver com o nosso jogo.]] Vamos lançar {game} no Roblox ({date}, às {time}) – um shooter em equipe em que vence quem termina a torre primeiro.
Adoraria ter {name} como Founding Creator: acesso antecipado, código de criador próprio (um item exclusivo para a comunidade) e um lugar no Mural dos Criadores do jogo.
Rola interesse? Todas as infos: {link}
Achei este servidor pelo perfil público. Se não tiver interesse, é só avisar que eu não pergunto de novo. Privacidade: {privacy}
`),

  t('followup', 'email', 'pt', 'A', `
Oi, {name}!

Só queria saber se minha mensagem sobre {game} chegou. O lançamento é {date}, às {time}, e o convite continua de pé: acesso antecipado como Founding Creator, seu próprio código de criador e seu nome no Mural dos Criadores.

Todas as informações: {link}

Essa é minha última mensagem sobre o assunto. Se agora não for um bom momento, tudo bem!

Abraços,
{sender}
{studio}

Não quer mais receber mensagens? Responda “não” e eu apago seus dados. Privacidade: {privacy}
`, 'Só passando para lembrar: {game}'),

  // ===================================================================== Français
  t('first', 'email', 'fr', 'A', `
Salut {name},

Je suis {sender}, de {studio}. [[J'ai vu ta vidéo « {video} » et ta chaîne colle parfaitement à notre jeu.||J'ai découvert ta chaîne et elle colle parfaitement à notre jeu.]]

Le {date} à {time}, nous lançons {game}, un nouveau jeu Roblox : un shooter en équipe où l'on se bat pour les blocs au centre de la carte – la première équipe qui termine sa tour gagne.

Pour le lancement, je réunis une petite équipe de Founding Creators :
• tu joues avant tout le monde (sessions de test réservées aux créateurs)
• tu reçois ton propre code créateur : tes viewers obtiennent un objet exclusif qu'on ne peut pas acheter
• ton nom apparaît sur le mur des créateurs dans le jeu

Toutes les infos : {link}

Ça te dit d'en faire partie ? Un simple « oui » suffit, je t'envoie le reste.

À bientôt,
{sender}
{studio}

[[J'ai trouvé tes coordonnées sur ton profil {platform} public.||J'ai trouvé tes coordonnées sur ton profil public.]] Ça ne t'intéresse pas ? Réponds simplement « non » : je ne te recontacterai plus et je supprimerai tes données. Confidentialité : {privacy}
`, 'Proposition de collaboration : Founding Creator pour {game}'),

  t('first', 'dm', 'fr', 'A', `
Salut {name} ! 👋 [[J'ai vu ta vidéo « {video} », j'ai adoré.||J'ai découvert ta chaîne, j'adore.]] Je suis {sender}, de {studio}. Le {date} à {time}, on lance {game} sur Roblox : un shooter en équipe où la première équipe qui termine sa tour gagne. Je cherche des Founding Creators qui jouent avant tout le monde : ton propre code créateur (tes viewers reçoivent un objet exclusif qu'on ne peut pas acheter) et ton nom sur le mur des créateurs du jeu. Ça te tente ? Infos : {link}
[[Contact trouvé sur ton profil {platform} public.||Contact trouvé sur ton profil public.]] Ça ne t'intéresse pas ? Réponds « non » et je ne t'écrirai plus. Confidentialité : {privacy}
`),

  t('first', 'discord', 'fr', 'A', `
Salut tout le monde ! 👋 Je suis {sender}, de {studio}, et j'ai une proposition de collaboration pour {name}.
[[J'ai découvert {name} grâce à la vidéo « {video} » et je trouve que ça colle parfaitement à notre jeu.||Je trouve que {name} colle parfaitement à notre jeu.]] Le {date} à {time}, on lance {game} sur Roblox – un shooter en équipe où la première équipe qui termine sa tour gagne.
J'aimerais beaucoup avoir {name} comme Founding Creator : accès anticipé, code créateur personnel (un objet exclusif pour la communauté) et une place sur le mur des créateurs du jeu.
Ça pourrait intéresser {name} ? Toutes les infos : {link}
J'ai trouvé ce serveur via le profil public. Pas d'intérêt ? Une petite réponse suffit et je ne redemanderai pas. Confidentialité : {privacy}
`),

  t('followup', 'email', 'fr', 'A', `
Salut {name},

Je voulais juste savoir si mon message au sujet de {game} t'était bien parvenu. Le lancement a lieu le {date} à {time}, et l'invitation tient toujours : accès anticipé en tant que Founding Creator, ton propre code créateur et ton nom sur le mur des créateurs.

Toutes les infos : {link}

C'est mon dernier message à ce sujet. Si ce n'est pas le bon moment, aucun souci.

À bientôt,
{sender}
{studio}

Tu ne veux plus recevoir de messages ? Réponds « non » et je supprimerai tes données. Confidentialité : {privacy}
`, 'Petite relance au sujet de {game}'),

  // ===================================================================== Polski
  t('first', 'email', 'pl', 'A', `
Cześć {name}!

Jestem {sender} ze studia {studio}. [[Twój film „{video}” bardzo mi się spodobał – Twój kanał świetnie pasuje do naszej gry.||Twój kanał świetnie pasuje do naszej gry.]]

Wydajemy nową grę na Roblox: {game}. To drużynowa strzelanka, w której walczycie o bloki na środku mapy – wygrywa drużyna, która pierwsza zbuduje swoją wieżę. Premiera: {date}, godz. {time}.

Na premierę zbieram małą ekipę Founding Creatorów:
• grasz przed wszystkimi (testy tylko dla twórców)
• dostajesz własny kod twórcy – Twoi widzowie otrzymają z nim ekskluzywny przedmiot, którego nie da się kupić
• Twój nick trafi na ścianę twórców w grze

Wszystkie informacje: {link}

Masz ochotę dołączyć? Wystarczy krótkie „tak”, a wyślę Ci resztę.

Pozdrawiam
{sender}
{studio}

[[Twoje dane kontaktowe pochodzą z Twojego publicznego profilu {platform}.||Twoje dane kontaktowe pochodzą z Twojego publicznego profilu.]] Nie masz ochoty? Odpisz po prostu „nie”, a nie będę się więcej odzywać i usunę Twoje dane. Prywatność: {privacy}
`, 'Propozycja współpracy – Founding Creator ({game})'),

  t('first', 'dm', 'pl', 'A', `
Cześć {name}! 👋 [[Twój film „{video}” bardzo mi się spodobał.||Twój kanał bardzo mi się spodobał.]] Jestem {sender} ze studia {studio}. Wydajemy na Roblox grę {game} – drużynową strzelankę, w której wygrywa drużyna, która pierwsza zbuduje wieżę. Premiera: {date}, godz. {time}. Szukam Founding Creatorów, którzy zagrają przed wszystkimi: własny kod twórcy (Twoi widzowie dostaną ekskluzywny przedmiot, którego nie da się kupić) i Twój nick na ścianie twórców w grze. Wchodzisz w to? Info: {link}
[[Kontakt pochodzi z Twojego publicznego profilu {platform}.||Kontakt pochodzi z Twojego publicznego profilu.]] Nie masz ochoty? Odpisz „nie”, a nie będę więcej pisać. Prywatność: {privacy}
`),

  t('first', 'discord', 'pl', 'A', `
Cześć wszystkim! 👋 Jestem {sender} ze studia {studio} i mam propozycję współpracy dla {name}.
[[Film „{video}” przekonał mnie, że {name} świetnie pasuje do naszej gry.||Myślę, że {name} świetnie pasuje do naszej gry.]] Wydajemy na Roblox grę {game} – drużynową strzelankę, w której wygrywa drużyna, która pierwsza zbuduje wieżę. Premiera: {date}, godz. {time}.
Chętnie zaprosimy {name} do grona Founding Creatorów: wcześniejszy dostęp, własny kod twórcy (ekskluzywny przedmiot dla społeczności) i miejsce na ścianie twórców w grze.
Czy to coś dla {name}? Wszystkie informacje: {link}
Link do serwera pochodzi z publicznego profilu. Brak zainteresowania? Wystarczy krótka odpowiedź, a nie będę więcej pytać. Prywatność: {privacy}
`),

  t('followup', 'email', 'pl', 'A', `
Cześć {name}!

Piszę tylko, żeby zapytać, czy dotarła do Ciebie moja wiadomość o {game}. Premiera: {date}, godz. {time} – a zaproszenie jest wciąż aktualne: wcześniejszy dostęp jako Founding Creator, własny kod twórcy i Twój nick na ścianie twórców.

Wszystkie informacje: {link}

To moja ostatnia wiadomość w tej sprawie. Jeśli teraz nie masz czasu, nic nie szkodzi.

Pozdrawiam
{sender}
{studio}

Nie chcesz więcej wiadomości? Odpisz „nie”, a usunę Twoje dane. Prywatność: {privacy}
`, 'Krótkie przypomnienie – {game}'),

  // ===================================================================== Türkçe
  t('first', 'email', 'tr', 'A', `
Selam {name},

Ben {sender}, {studio} ekibinden. [[“{video}” videonu izledim; kanalın oyunumuza çok uygun.||Kanalına denk geldim; oyunumuza çok uygun.]]

Yeni Roblox oyunumuz {game} çıkıyor: takımların haritanın ortasındaki bloklar için savaştığı bir nişancı oyunu – kulesini ilk bitiren takım kazanıyor. Çıkış: {date}, saat {time}.

Çıkış için küçük bir Founding Creator ekibi kuruyorum:
• Oyunu herkesten önce oynarsın (sadece içerik üreticilerine özel testler)
• Sana özel bir creator kodu alırsın: izleyicilerin bu kodla satın alınamayan özel bir eşya kazanır
• Adın oyundaki Creator Duvarı'nda yer alır

Tüm bilgiler: {link}

Aramızda olmak ister misin? Kısa bir “evet” yeterli, gerisini ben gönderirim.

Selamlar,
{sender}
{studio}

[[İletişim bilgilerini herkese açık {platform} profilinden aldım.||İletişim bilgilerini herkese açık profilinden aldım.]] İlgilenmiyor musun? “Hayır” yazman yeterli; sana bir daha yazmam ve bilgilerini silerim. Gizlilik: {privacy}
`, 'İş birliği teklifi: {game} için Founding Creator'),

  t('first', 'dm', 'tr', 'A', `
Selam {name}! 👋 [[“{video}” videonu izledim, çok iyiydi.||Kanalına denk geldim, çok iyi.]] Ben {sender}, {studio} ekibinden. Yeni Roblox oyunumuz {game} çıkıyor – kulesini ilk bitiren takımın kazandığı bir takım nişancı oyunu. Çıkış: {date}, saat {time}. Oyunu herkesten önce oynayacak Founding Creator'lar arıyorum: sana özel creator kodu (izleyicilerin satın alınamayan özel bir eşya kazanır) ve oyundaki Creator Duvarı'nda adın. Var mısın? Bilgi: {link}
[[İletişim bilgin herkese açık {platform} profilinden.||İletişim bilgin herkese açık profilinden.]] İlgilenmiyorsan “hayır” yaz, bir daha yazmam. Gizlilik: {privacy}
`),

  t('first', 'discord', 'tr', 'A', `
Herkese selam! 👋 Ben {sender}, {studio} ekibinden; {name} için bir iş birliği teklifim var.
[[{name} kanalını “{video}” videosu sayesinde keşfettim ve oyunumuza çok uygun olduğunu düşünüyorum.||{name} kanalının oyunumuza çok uygun olduğunu düşünüyorum.]] Yeni Roblox oyunumuz {game} çıkıyor – kulesini ilk bitiren takımın kazandığı bir takım nişancı oyunu. Çıkış: {date}, saat {time}.
{name} Founding Creator olarak aramızda olsun isteriz: erken erişim, kişisel creator kodu (topluluk için özel bir eşya) ve oyundaki Creator Duvarı'nda bir yer.
İlgilenir mi? Tüm bilgiler: {link}
Bu sunucuyu herkese açık profilden buldum. İlgi yoksa kısa bir cevap yeterli, tekrar sormam. Gizlilik: {privacy}
`),

  t('followup', 'email', 'tr', 'A', `
Selam {name},

{game} hakkındaki mesajımın sana ulaşıp ulaşmadığını sormak istedim. Çıkış {date}, saat {time} ve davetim hâlâ geçerli: Founding Creator olarak erken erişim, sana özel creator kodu ve Creator Duvarı'nda adın.

Tüm bilgiler: {link}

Bu konudaki son mesajım bu. Şu an uygun değilse hiç sorun değil.

Selamlar,
{sender}
{studio}

Başka mesaj almak istemiyor musun? “Hayır” yazman yeterli, bilgilerini silerim. Gizlilik: {privacy}
`, 'Kısa bir hatırlatma: {game}'),
];
