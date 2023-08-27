const { Client, Intents, MessageEmbed } = require('discord.js')
const puppeteer = require('puppeteer');

require('dotenv').config()

const fs = require('fs/promises'); // Module pour gérer les fichiers (disponible dans les versions récentes de Node.js)

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

const checkInterval = 10000; // Intervalle en millisecondes (par exemple, 1 minute)

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  performCheck();
  loadServerInfo();
});

const prefix = '!'; // Préfixe des commandes

const serverInfo = new Map(); // Serveur ID -> Informations

const browserPromise = puppeteer.launch({
    executablePath: '/app/.apt/usr/bin/google-chrome',
    headless: "new",
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
    ],
    'ignoreHTTPSErrors': true
});

let browserInstance = null;
let page = null;

client.on('messageCreate', async message => {
    if (message.author.bot) return; // Ignorer les messages des bots
    if (!message.content.startsWith(prefix)) return; // Ignorer les messages sans préfixe

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'start') {
        if (serverInfo.has(message.guild.id)) {
            return message.reply("L'accès à la recherche est déjà active.") && console.log("L'accès à la recherche est déjà active.");
        }

        serverInfo.set(message.guild.id, {
            activeCheck: true,
            channelId: message.channel.id,
            userMention: `<@${message.author.id}>`,
        });

        saveServerInfoToFile();

        console.log('Accès à la recherche activé.');
        message.reply('Accès à la recherche activé.');
    } else if (command === 'stop') {
        if (!serverInfo.has(message.guild.id)) {
            return message.reply('Aucune recherche active à arrêter.') && console.log('Aucune recherche active à arrêter.');
        }

        serverInfo.delete(message.guild.id);

        saveServerInfoToFile();

        message.reply('Accès à la recherche désactivée.');
        console.log('Accès à la recherche désactivée.');
    }
});

async function performCheck() {
    if (!browserInstance || !browserInstance.isConnected()) {
        console.log("Création de l'instance du browser en cours.");
        browserInstance = await browserPromise;
        console.log("Fait.");
    }
    if (!page || page.isClosed()) {
        console.log("Création de l'instance de la page.");
        const url = 'https://tickets.rugbyworldcup.com/fr';
        page = await browserInstance.newPage();
        await page.goto(url, { waitUntil: 'networkidle2' });
        console.log("Fait.");
    }

    try {
        console.log("Lancement de la recherche.");

        const changes = await findChanges(browserInstance, page);

        serverInfo.forEach(async (info) => {
            if (info.activeCheck) {
                const channel = await client.channels.fetch(info.channelId);

                if (changes.length > 0) {
                    console.log("Envoi des messages à chaque utilisateur Discord.");
                    await sendChangeMessages(channel, info.userMention, changes);
                }
                else {
                    console.log("Aucun changement détecté.");
                }
            }
        });
    } catch (error) {
        console.error("Une erreur s'est produite dans performCheck()", error);
    }
  
    // Planifier la prochaine vérification après un délai
    setTimeout(performCheck, checkInterval);
}

async function findChanges(browserInstance, page) {
    try {
        console.log("Reloading...");
        await page.reload({ waitUntil: 'networkidle2' });
        console.log("Page chargée avec succès.");
    } catch (error) {
        console.error("Impossible de reloading : ", error)
    }
  
    // Attendre un certain temps pour que le contenu soit chargé (vous pouvez ajuster le temps)
    await new Promise(resolve => setTimeout(resolve, 8000));
  
    try {

    const matchInfo = await page.evaluate(() => {
        const matchElements = document.querySelectorAll('.match-label'); // Sélectionnez les éléments de match
        const availabilityElements = document.querySelectorAll('.actions-wrapper .noloader'); 
        const nameMatches = document.querySelectorAll('.d-lg-none.match-info-mobile .competition-additional')

        const matchInfo = [];
    
        for (i=0; i<matchElements.length; i++) {
            const teamElements = matchElements[i].querySelectorAll('.team'); // Sélectionnez les éléments d'équipe
            const teams = Array.from(teamElements).map(team => team.textContent.trim());   
            // Vérifiez la classe pour déterminer l'accessibilité
            const isAvailable = availabilityElements[i].classList.contains('js-show-offers');
            const availability = isAvailable ? 'Voir les offres' : 'Non disponible';
            const nameMatch = nameMatches[i].textContent.trim();
            matchInfo.push({ teams, availability, nameMatch });
        }
    
        return matchInfo;
    });
    
    // Charger les anciennes informations depuis le fichier JSON (s'il existe)
    let oldMatchInfo = [];
    try {
        const oldMatchInfoJson = await fs.readFile('old_match_info.json', 'utf-8');
        oldMatchInfo = JSON.parse(oldMatchInfoJson);
    } catch (error) {
        // Le fichier n'existe pas ou ne peut pas être lu
    }
    
    // Comparer les nouvelles et anciennes informations pour détecter les changements
    const changes = matchInfo.filter(newMatch => {
        const oldMatch = oldMatchInfo.find(oldMatch => JSON.stringify(oldMatch.teams) === JSON.stringify(newMatch.teams));
        return oldMatch && oldMatch.availability === 'Non disponible' && newMatch.availability === 'Voir les offres';
    });

    
    // Stocker les nouvelles informations pour les futures comparaisons
    await fs.writeFile('old_match_info.json', JSON.stringify(matchInfo, null, 2));

    // Maintenant vous pouvez utiliser $ pour manipuler le HTML
    console.log("Informations des matchs:", matchInfo);
    console.log("________________");
    console.log("________________");
    console.log("________________");
    console.log("________________");

    return changes;

    } catch (error) {
        await browserInstance.close();
        console.error("Une erreur s'est produite dans findChanges(): ", error);
    }
}

function formatPhaseName(phaseName) {
    // Supprimer les espaces et convertir en minuscules
    let formattedName = phaseName.replace(/\s+/g, '_').toLowerCase();

    formattedName.replace(/é/g, 'e');

    // Supprimer les caractères non alphanumériques
    return formattedName.replace(/[^a-zA-Z0-9_]/g, '');
}

async function sendChangeMessages(channel, userMention, changes) {

    // Envoi des changements dans le salon Discord s'il y en a
    if (changes.length > 0) {
        const changesMessageName = changes.map(match => {
            const teams = match.teams.join('_').toLowerCase();
            return `/${teams}`;
        }).join('\n');

        const changesMessageLink = changes.map(match => {
            const teams = match.teams.join('_').toLowerCase(); // Génère "equipe1_equipe2"
            const teamsFormatted = formatPhaseName(teams)
            const name = formatPhaseName(match.nameMatch);
            let reventeLink = '';

            if (teams.includes('vainqueur' || 'finaliste')) {
                // Gérer les liens pour les phases finales (quart de finale, demi-finale, finale)
                reventeLink = `/revente_${name}`;
            } else {
                // Gérer les liens pour les matchs de poule
                reventeLink = `/revente_${teamsFormatted}`;
            }
            return "https://tickets.rugbyworldcup.com" + reventeLink;
        }).join('\n');

        console.log(changesMessageName);

        const embed = new MessageEmbed()
        .setColor(0x00FF00)
        .setTitle('Nouveau billet')
        .setURL(changesMessageLink)
        .setDescription("Un billet a été mis en vente à l'instant !")
        .addFields(
            { name: 'Equipes', value: `**${changesMessageName}**` },
        )
        .setTimestamp()

        channel.send(`${userMention} Voici les changements détectés :`)
        channel.send({ embeds: [embed] });
        console.log("Messages envoyés.")
    }
}

// Au démarrage du bot, charger les données depuis le fichier JSON
async function loadServerInfo() {
    try {
        const jsonData = await fs.readFile('server_info.json', 'utf-8');
        const parsedData = JSON.parse(jsonData);

        for (const [serverId, info] of Object.entries(parsedData)) {
            serverInfo.set(serverId, info);
        }

        console.log('Données chargées depuis le fichier JSON.');
    } catch (error) {
        console.error('Erreur lors du chargement des données depuis le fichier JSON :', error);
    }
}
// Après chaque modification de serverInfo, sauvegarder dans le fichier JSON
async function saveServerInfoToFile() {
    const dataToSave = {};

    serverInfo.forEach((info, serverId) => {
        dataToSave[serverId] = info;
    });

    try {
        await fs.writeFile('server_info.json', JSON.stringify(dataToSave, null, 2), 'utf-8');
        console.log('Données sauvegardées dans le fichier JSON.');
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des données dans le fichier JSON :', error);
    }
}

client.login(process.env.TOKEN_ID);