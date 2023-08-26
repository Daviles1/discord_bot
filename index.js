const { Client, Intents, MessageEmbed } = require('discord.js')
const puppeteer = require('puppeteer');

require('dotenv').config()

const fs = require('fs/promises'); // Module pour gérer les fichiers (disponible dans les versions récentes de Node.js)

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

let activeCheck = false;
let channelId = null;
let userMention = null;

const checkInterval = 10000; // Intervalle en millisecondes (par exemple, 1 minute)

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Lancer la surveillance des changements
//   performCheck();
});

const prefix = '!'; // Préfixe des commandes

client.on('messageCreate', async message => {
    if (message.author.bot) return; // Ignorer les messages des bots
    if (!message.content.startsWith(prefix)) return; // Ignorer les messages sans préfixe

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'start') {
        if (activeCheck) {
            return message.reply('La recherche est déjà active.');
        }

        // Get channel ID and user mention
        channelId = message.channel.id;
        userMention = `<@${message.author.id}>`;

        activeCheck = true;
        message.reply('Recherche de billets commencée.');
        performCheck();
    } else if (command === 'stop') {
        if (!activeCheck) {
            return message.reply('Aucune recherche active à arrêter.');
        }

        activeCheck = false;
        channelId = null;
        userMention = null;
        message.reply('Recherche de billets arrêtée.');
    }
});

async function performCheck() {
    if (!activeCheck || !channelId) {
        return;
    }
    await checkChanges();
  
    // Planifier la prochaine vérification après un délai
    setTimeout(performCheck, checkInterval);
  }

function formatPhaseName(phaseName) {
    // Supprimer les espaces et convertir en minuscules
    const formattedName = phaseName.replace(/\s+/g, '_').toLowerCase();

    // Supprimer les caractères non alphanumériques
    return formattedName.replace(/[^a-zA-Z0-9_]/g, '');
}

async function checkChanges() {
    
    const getBrowser = () => puppeteer.launch({
        headless: "new",
        args: ["--disable-setuid-sandbox"],
	    'ignoreHTTPSErrors': true
    });

    const browser = await getBrowser();
    const page = await browser.newPage();
  
    const url = 'https://tickets.rugbyworldcup.com/fr';
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  
    // Attendre un certain temps pour que le contenu soit chargé (vous pouvez ajuster le temps)
    await new Promise(resolve => setTimeout(resolve, 5000));
  
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

    // Envoi des changements dans le salon Discord s'il y en a
    if (changes.length > 0) {
        const changesMessage = changes.map(match => {
            const teams = match.teams.join('_').toLowerCase();
            return `/${teams}`;
        }).join('\n');

        const changesMessageLink = changes.map(match => {
            const teams = match.teams.join('_').toLowerCase(); // Génère "equipe1_equipe2"
            const name = formatPhaseName(match.nameMatch);
            let reventeLink = '';
    
            if (teams.includes('vainqueur')) {
                // Gérer les liens pour les phases finales (quart de finale, demi-finale, finale)
                reventeLink = `/revente_${name}`;
            } else {
                // Gérer les liens pour les matchs de poule
                reventeLink = `/revente_${teams}`;
            }
            return "https://tickets.rugbyworldcup.com" + reventeLink;
        }).join('\n');

        const channel = await client.channels.fetch(channelId);

        const embed = new MessageEmbed()
	    .setColor(0x00FF00)
	    .setTitle('Nouveau billet')
	    .setURL(changesMessageLink)
	    .setDescription("Un billet a été mis en vente à l'instant !")
	    .addFields(
		    { name: 'Equipes', value: changesMessage },
	    )
	    .setTimestamp()

        channel.send(`${userMention} Voici les changements détectés :`)
        channel.send({ embeds: [embed] });
    }

    if (!browser.isConnected()) {
        await browser.close();
    }
  } catch (error) {
    console.error("Une erreur s'est produite", error);
    if (!browser.isConnected()) {
        await browser.close();
    }
  }
}

client.login(process.env.TOKEN_ID);