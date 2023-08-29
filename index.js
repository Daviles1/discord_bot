const { Client, Intents, MessageEmbed } = require('discord.js')
const { MongoClient } = require('mongodb');
const puppeteer = require('puppeteer');

require('dotenv').config()

const fs = require('fs/promises'); // Module pour gérer les fichiers (disponible dans les versions récentes de Node.js)
const { formatWithOptions } = require('util');

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

const checkInterval = 20000; // Intervalle en millisecondes (par exemple, 1 minute)

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  performCheck();
  loadServerInfo();
});

const serverInfo = new Map(); // Serveur ID -> Informations

const mongoUrl = 'mongodb+srv://David:'+process.env.PASSWORD+'@clusterdiscord.uqld2dy.mongodb.net/?retryWrites=true&w=majority';

const browserPromise = puppeteer.launch({
    executablePath: '/app/.apt/usr/bin/google-chrome',
    headless: "new",
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-cache',
    ],
    'ignoreHTTPSErrors': true
});

let browserInstance = null;
let page = null;

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
        await page.goto(url, { waitUntil: 'networkidle0' });
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
                    console.log("Aucun changement détecté pour ", info.userMention);
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
        await page.reload({ waitUntil: 'networkidle0' });
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

    console.log("Loading MongoDB");
    const oldMatchInfo = await loadMatchInfo();

    console.log("________________");
    console.log("________________");
    console.log("________________");
    console.log("________________");
    console.log('Anciennes informations des matchs:', oldMatchInfo);
    console.log('Nouvelles informations des matchs:', matchInfo);
    
    // Comparer les nouvelles et anciennes informations pour détecter les changements
    const changes = matchInfo.filter(newMatch => {
        const oldMatch = oldMatchInfo.find(oldMatch => JSON.stringify(oldMatch.teams) === JSON.stringify(newMatch.teams));
        return oldMatch && oldMatch.availability === 'Non disponible' && newMatch.availability === 'Voir les offres';
    });

    
    await saveMatchInfo(matchInfo);

    return changes;

    } catch (error) {
        console.error("Une erreur s'est produite dans findChanges(): ", error);
        await browserInstance.close();
    }
}

function formatPhaseName(phaseName) {
    // Supprimer les espaces et convertir en minuscules
    formattedName = phaseName.toLowerCase();

    formattedName = formattedName.replace(/ /g, '_');

    // Remove spaces around numbers
    formattedName = formattedName.replace(/_(\d)/g, '$1').replace(/-/g, '_').replace(/é/g, 'e').replace(/[^a-zA-Z0-9_]/g, '');

    // Supprimer les caractères non alphanumériques
    return formattedName;
}

async function sendChangeMessages(channel, userMention, changes) {

    // Envoi des changements dans le salon Discord s'il y en a
    if (changes.length > 0) {
        changes.forEach((change) => {
            const changesMessageName = (() => {
                const teams = change.teams.join('_').toLowerCase();
                return `/${teams}`;
            })
    
            const changesMessageLink = (() => {
                const teams = change.teams.join('_').toLowerCase(); // Génère "equipe1_equipe2"
                const teamsFormatted = formatPhaseName(teams)
                const name = formatPhaseName(change.nameMatch);
                let reventeLink = '';
    
                if (teams.includes('vainqueur')) {
                    // Gérer les liens pour les phases finales (quart de finale, demi-finale, finale)
                    reventeLink = `/revente_${name}`;
                } else if (teams.includes('finaliste')) {
                    reventeLink = `/revente_${name}`
                } else {
                    // Gérer les liens pour les matchs de poule
                    reventeLink = `/revente_${teamsFormatted}`;
                }
                return "https://tickets.rugbyworldcup.com/fr" + reventeLink;
            })
    
            console.log(changesMessageName);
    
            const embed = new MessageEmbed()
            .setColor(0x00FF00)
            .setTitle('Nouveau billet')
            .setURL(changesMessageLink())
            .setDescription("Un billet a été mis en vente à l'instant !")
            .addFields(
                { name: 'Equipes', value: `**${changesMessageName()}**` },
            )
            .setTimestamp()
    
            channel.send(`${userMention} Voici les changements détectés :`)
            channel.send({ embeds: [embed] });
            console.log("Messages envoyés.")
        })
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
async function saveMatchInfo(matchInfo) {
    const client = new MongoClient(mongoUrl, { useUnifiedTopology: true });

    try {
        await client.connect();

        const database = client.db('ClusterDiscord'); // Remplacez 'mydb' par le nom de votre base de données
        const collection = database.collection('match_info');

        // Supprimez les anciennes données
        await collection.deleteMany();

        // Insérez les nouvelles données
        await collection.insertMany(matchInfo);

        console.log('Match info saved to MongoDB.');
    } catch (error) {
        console.error('Error saving match info to MongoDB:', error);
    } finally {
        await client.close();
    }
}

async function loadMatchInfo() {
    const client = new MongoClient(mongoUrl, { useUnifiedTopology: true });

    try {
        await client.connect();

        const database = client.db('ClusterDiscord'); // Remplacez 'mydb' par le nom de votre base de données
        const collection = database.collection('match_info');

        const matchInfo = await collection.find().toArray();
        return matchInfo;
    } catch (error) {
        console.error('Error loading match info from MongoDB:', error);
        return [];
    } finally {
        await client.close();
    }
}

client.login(process.env.TOKEN_ID);