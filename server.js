require("dotenv").config();
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const mysql = require("mysql2");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser"); // Ajout de cette ligne

const lastSeenMessageIds = new Map(); // username -> messageId

// Ajouter ces dépendances au début du fichier server.js, après les autres require
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/*
// Configuration de la base de données
const dbConfig = {
  host: process.env.MYSQLHOST || "localhost",
  user: process.env.MYSQLUSER || "root",
  password: process.env.MYSQLPASSWORD || "",
  database: process.env.MYSQLDATABASE || "faritanyX",
    port: process.env.MYSQLPORT || 3306,
  charset: "utf8mb4"  // Ajout de cette ligne pour supporter les emojis

};
*/
const dbConfig = {
    host: "localhost",
    user: "root",
    password: "",
    database: "faritanyX",
    port: 3306,
    charset: "utf8mb4"  // Ajout de cette ligne pour supporter les emojis
  };

// Configuration de Multer pour le stockage temporaire des fichiers
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Limite de 5MB
  },
  fileFilter: function (req, file, cb) {
    // Accepter uniquement les images
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Seuls les fichiers image sont autorisés'), false);
    }
    cb(null, true);
  }
});

// Déplacer la fonction queryAsync hors du gestionnaire de socket.io pour qu'elle soit globale
// Ajoutez ce code juste après la section de configuration de la base de données

// Fonction pour vérifier/rétablir la connexion avant chaque requête
function ensureConnection() {
  return new Promise((resolve, reject) => {
    if (db.state === "disconnected") {
      db.connect(function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

// Fonction queryAsync globale pour exécuter des requêtes SQL de manière asynchrone
function queryAsync(sql, values) {
  return ensureConnection().then(() => {
    return new Promise((resolve, reject) => {
      db.query(sql, values, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  });
}

// Fonction pour sauvegarder les données de replay d'un match
async function saveMatchData(gameId, matchData) {
  try {
    // Vérifier si les données existent déjà
    const existingData = await queryAsync(
      "SELECT 1 FROM match_data WHERE game_id = ?",
      [gameId]
    );
    
    if (existingData.length > 0) {
      // Mettre à jour les données existantes
      await queryAsync(
        "UPDATE match_data SET match_data = ? WHERE game_id = ?",
        [JSON.stringify(matchData), gameId]
      );
    } else {
      // Insérer de nouvelles données
      await queryAsync(
        "INSERT INTO match_data (game_id, match_data) VALUES (?, ?)",
        [gameId, JSON.stringify(matchData)]
      );
    }
    
    return true;
  } catch (error) {
    console.error("Erreur lors de l'enregistrement des données de match:", error);
    return false;
  }
}

// Maintenant, vous pouvez supprimer ces mêmes fonctions du gestionnaire de socket.io
// (les fonctions ensureConnection et queryAsync que vous avez définies dans le gestionnaire de socket)

// Créer la connexion à la base de données
const db = mysql.createConnection(dbConfig);
// Créer le store de session
const sessionStore = new MySQLStore(dbConfig);

// Configuration de la session
const sessionMiddleware = session({
  secret: "secret",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: false, // Mettre à true si vous utilisez HTTPS
    maxAge: 24 * 60 * 60 * 1000, // 24 heures
  },
});

// Constantes pour le calcul ELO
const ELO_K_FACTOR = 32;

// Configuration du port
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static("public"));
app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Connexion à la base de données
db.connect((err) => {
  if (err) {
    console.error("Erreur de connexion à la base de données :", err);
    return;
  }
  console.log("Connecté avec succès à la base de données");

  // Créer la table users
const createUsersTable = `
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  score INT DEFAULT 0,
  games_played INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active TIMESTAMP NULL DEFAULT NULL
);
`;

// Créer la table games_history
const createGamesHistoryTable = `
CREATE TABLE IF NOT EXISTS games_history (
  id INT(11) NOT NULL AUTO_INCREMENT,
  game_id VARCHAR(191) NOT NULL,
  player_username VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  opponent_username VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  result FLOAT NOT NULL,
  player_elo_before INT NOT NULL,
  player_elo_after INT NOT NULL,
  end_reason VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_player (player_username),
  INDEX idx_opponent (opponent_username),
  INDEX idx_game (game_id)
);
`;

// Dans votre section de création de tables de la base de données (server.js)
const createGlobalChatTable = `
CREATE TABLE IF NOT EXISTS global_chat (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  message VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_username_chat (username)
);
`;

// Créer la table pour l'historique des transferts de titres
const createAchievementTransfersTable = `
CREATE TABLE IF NOT EXISTS achievement_transfers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  achievement_code VARCHAR(50) NOT NULL,
  from_username VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  to_username VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  game_id VARCHAR(191) NOT NULL,
  transferred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_from_username (from_username),
  INDEX idx_to_username (to_username)
);
`;



// Créer la table profile_photos
const createProfilePhotosTable = `
CREATE TABLE IF NOT EXISTS profile_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL UNIQUE,
  photo_data LONGBLOB,
  photo_type VARCHAR(50),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

  db.query(createAchievementTransfersTable, (err) => {
    if (err)
      console.error(
        "Erreur lors de la création de la table achievement_transfers:",
        err
      );
    else console.log("Table achievement_transfers créée avec succès.");
  });

  db.query(createGlobalChatTable, (err) => {
    if (err)
      console.error("Erreur lors de la création de la table global_chat:", err);
    else console.log("Table global_chat créée avec succès.");
  });

  db.query(createUsersTable, (err) => {
    if (err) {
      console.error("Erreur lors de la création de la table:", err);
      return;
    }
    console.log("Table users vérifiée/créée");
  });

  db.query(
    "ALTER TABLE users ADD COLUMN last_name_change TIMESTAMP NULL",
    (err) => {
      if (err && err.code !== "ER_DUP_FIELDNAME") {
        console.error("Erreur lors de l'ajout du champ last_name_change:", err);
      } else {
        console.log("Champ last_name_change vérifié/ajouté à la table users");
      }
    }
  );
  db.query(createProfilePhotosTable, (err) => {
    if (err) {
      console.error("Erreur lors de la création de la table profile_photos:", err);
      return;
    }
    console.log("Table profile_photos vérifiée/créée");
  });

  db.query(createGamesHistoryTable, (err) => {
    if (err)
      console.error(
        "Erreur lors de la création de la table games_history:",
        err
      );
    else console.log("Table games_history créée avec succès.");
  });
});

// Ajoutez cette requête SQL dans votre section de connexion à la base de données
db.query(
  "ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  (err) => {
    if (err && err.code !== "ER_DUP_FIELDNAME") {
      console.error("Erreur lors de l'ajout du champ created_at:", err);
    } else {
      console.log("Champ created_at vérifié/ajouté à la table users");
    }
  }
);

// Gestion des erreurs de connexion
db.on("error", (err) => {
  console.error("Erreur de base de données :", err);
  if (err.code === "PROTOCOL_CONNECTION_LOST") {
    console.log("Tentative de reconnexion à la base de données...");
  }
});

// 1. Créer la table achievements dans votre base de données
// Ajoutez ce code avec vos autres créations de tables
// Créer la table achievements
const createAchievementsTable = `
CREATE TABLE IF NOT EXISTS achievements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  achievement_code VARCHAR(50) NOT NULL,
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_achievement (username, achievement_code)
);
`;


db.query(createAchievementsTable, (err) => {
  if (err)
    console.error("Erreur lors de la création de la table achievements:", err);
  else console.log("Table achievements créée avec succès.");
});

const createAdminMessagesTable = `
CREATE TABLE IF NOT EXISTS admin_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_timestamp (timestamp)
);
`;

db.query(createAdminMessagesTable, (err) => {
  if (err) console.error("Erreur lors de la création de la table admin_messages:", err);
  else console.log("Table admin_messages créée avec succès.");
});

// Ajoutez cette table dans votre section de création de tables dans server.js
const createMatchDataTable = `
CREATE TABLE IF NOT EXISTS match_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_id VARCHAR(191) NOT NULL UNIQUE,
  match_data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_game_id (game_id)
);
`;

// Et exécutez-la avec les autres créations de tables
db.query(createMatchDataTable, (err) => {
  if (err) {
    console.error("Erreur lors de la création de la table match_data:", err);
  } else {
    console.log("Table match_data créée avec succès.");
  }
});

// 2. Définir les types de distinctions et leurs critères
const ACHIEVEMENTS = {
  // Progression et rangs (avec limites)
  konungr: {
    icon: "🏆",
    title: "Konungr - Atteint ELO 1800",
    check: async (username) => {
      try {
        // Vérifier l'ELO
        const hasElo = await hasMinimumElo(username, 1800);
        if (!hasElo) return false;
        
        // Vérifier que le joueur est actuellement Jarl
        const isJarl = await queryAsync(
          "SELECT 1 FROM achievements WHERE username = ? AND achievement_code = 'jarl'",
          [username]
        );
        if (isJarl.length === 0) return false;
        
        // Vérifier les autres prérequis
        const userAchievements = await getUserAchievements(username);
        const achievementsSet = new Set(userAchievements);
        
        const requiredAchievements = ['hersir', 'drengr', 'skald', 'ulfhednar', 'hirdman'];
        for (const req of requiredAchievements) {
          if (!achievementsSet.has(req)) return false;
        }
        
        return true;
      } catch (error) {
        console.error(`Erreur lors de la vérification pour Konungr:`, error);
        return false;
      }
    },
    maxHolders: 1, // Un seul Konungr possible
    benefits: [
      "Aura dorée animée autour de l'avatar",
      "Badge exclusif 'Konungr' à côté du nom",
      "Notification à tous les joueurs lors de la connexion",
      "Capacité de nommer une saison de jeu",
      "Message global quotidien",
      "Fond d'écran de profil personnalisable"
    ]
  },
  
  jarl: {
    icon: "👑",
    title: "Jarl - Atteint ELO 1400",
    check: async (username) => {
      try {
        // Vérifier l'ELO minimum
        const hasElo = await hasMinimumElo(username, 1400);
        if (!hasElo) return false;
        
        // Vérifier les prérequis (Drengr et Skald)
        const userAchievements = await getUserAchievements(username);
        const achievementsSet = new Set(userAchievements);
        
        if (!achievementsSet.has('drengr') || !achievementsSet.has('skald')) {
          return false;
        }
        
        return true;
      } catch (error) {
        console.error(`Erreur lors de la vérification pour Jarl:`, error);
        return false;
      }
    },
    maxHolders: 4, // Seulement 4 Jarls possibles
    benefits: [
      "Aura argentée autour de l'avatar",
      "Badge spécial 'Jarl' visible partout",
      "Titre personnalisé sous le nom",
      "Options exclusives de couleurs pour le nom",
      "Ensemble d'émojis spéciaux utilisables dans le chat"
    ]
  },
  
  berserker: {
    icon: "🪓",
    title: "Berserker - 10 victoires consécutives",
    check: async (username) => {
      try {
        // Vérifier les victoires consécutives
        const hasWins = await hasConsecutiveWins(username, 10);
        if (!hasWins) return false;
        
        // Vérifier que le joueur a Thegn
        const userAchievements = await getUserAchievements(username);
        return userAchievements.includes('thegn');
      } catch (error) {
        console.error(`Erreur lors de la vérification pour Berserker:`, error);
        return false;
      }
    },
    maxHolders: 10, // 10 Berserkers possibles
    benefits: [
      "Animation spéciale lors de l'entrée dans une salle",
      "Badge de rage à côté du nom",
      "Cadre spécial autour de l'avatar",
      "Citation personnalisée sur le profil",
      "Sons uniques pour les messages dans le chat"
    ]
  },
  
  einherjar: {
    icon: "⚔️",
    title: "Einherjar - 5 victoires consécutives",
    check: (username) => hasConsecutiveWins(username, 5),
    maxHolders: 20, // 20 Einherjars possibles
    benefits: [
      "Badge d'honneur à côté du nom",
      "Animation subtile lors de l'entrée en partie",
      "Signature visuelle sur le profil",
      "Position prioritaire dans la liste des joueurs en ligne"
    ]
  },

  // Exploits de combat (pas de limites)
  skald: {
    icon: "📜",
    title: "Skald - 50 parties jouées",
    check: (username) => hasPlayedGames(username, 50)
  },
  
  thegn: {
    icon: "🛡️",
    title: "Thegn - 5 victoires contre joueurs ELO 1300+",
    check: (username) => hasWinsAgainstHighElo(username, 1300, 5)
  },
  
  drengr: {
    icon: "⚡",
    title: "Drengr - Victoire contre joueur ELO 1600+",
    check: (username) => hasWinsAgainstHighElo(username, 1600, 1)
  },
  
  hersir: {
    icon: "🪶",
    title: "Hersir - Victoire contre 10 joueurs différents",
    check: (username) => hasWinsAgainstDifferentPlayers(username, 10)
  },

  // Conquêtes (pas de limites)
  ulfhednar: {
    icon: "🐺",
    title: "Ulfhednar - 3 victoires en moins de 24h",
    check: (username) => hasWinsInTimeframe(username, 3, 24)
  },
  
  hirdman: {
    icon: "🏹",
    title: "Hirdman - 3 victoires par mise à terre",
    check: (username) => hasVictoriesByReason(username, "miseATerre", 3)
  }
};

// Fonction pour obtenir les statistiques d'un joueur (ELO, taux de victoire, etc.)
async function getPlayerStats(username) {
  try {
    // Récupérer les informations de base du joueur
    const userInfo = await queryAsync(
      "SELECT score, games_played FROM users WHERE username = ?",
      [username]
    );
    
    if (userInfo.length === 0) {
      return { elo: 0, winRate: 0, gamesPlayed: 0 };
    }
    
    const playerElo = userInfo[0].score;
    const gamesPlayed = userInfo[0].games_played;
    
    // Calculer le taux de victoire
    if (gamesPlayed === 0) {
      return { elo: playerElo, winRate: 0, gamesPlayed: 0 };
    }
    
    const matchHistory = await queryAsync(
      "SELECT result FROM games_history WHERE player_username = ? ORDER BY created_at DESC LIMIT 100",
      [username]
    );
    
    let wins = 0;
    if (matchHistory.length > 0) {
      wins = matchHistory.filter(match => match.result === 1).length;
    }
    
    const winRate = Math.round((wins / gamesPlayed) * 100);
    
    // Vérifier si le joueur a une photo
    const hasPhoto = await checkUserHasPhoto(username);
    
    return {
      elo: playerElo,
      winRate: winRate,
      gamesPlayed: gamesPlayed,
      hasPhoto: hasPhoto
    };
  } catch (error) {
    console.error(`Erreur lors de la récupération des statistiques pour ${username}:`, error);
    return { elo: 0, winRate: 0, gamesPlayed: 0, hasPhoto: false };
  }
}


// Fonction pour vérifier combien de joueurs ont déjà un titre spécifique
async function countAchievementHolders(achievementCode) {
  try {
    const results = await queryAsync(
      "SELECT COUNT(DISTINCT username) AS holder_count FROM achievements WHERE achievement_code = ?",
      [achievementCode]
    );
    return results[0].holder_count;
  } catch (error) {
    console.error(
      `Erreur lors du comptage des détenteurs de ${achievementCode}:`,
      error
    );
    return Infinity; // En cas d'erreur, on retourne une valeur qui empêchera l'attribution
  }
}

// Ajouter cette fonction utilitaire dans server.js
async function checkUserHasPhoto(username) {
  try {
    const results = await queryAsync(
      "SELECT 1 FROM profile_photos WHERE username = ?",
      [username]
    );
    return results.length > 0;
  } catch (error) {
    console.error("Erreur lors de la vérification de photo:", error);
    return false;
  }
}

// Fonction améliorée pour vérifier si un joueur peut défier le détenteur actuel d'un titre
async function canChallengeForTitle(username, achievementCode) {
  try {
    // Vérifier si le joueur remplit les critères de base pour le titre
    const achievement = ACHIEVEMENTS[achievementCode];
    const isEligible = await achievement.check(username);
    
    if (!isEligible) return false;
    
    // Vérifier si le joueur n'a pas déjà ce titre
    const hasTitle = await queryAsync(
      "SELECT 1 FROM achievements WHERE username = ? AND achievement_code = ?",
      [username, achievementCode]
    );
    
    if (hasTitle.length > 0) return false;
    
    // Vérifier si le nombre maximum de détenteurs n'est pas atteint
    if (achievement.maxHolders) {
      const currentHolders = await countAchievementHolders(achievementCode);
      if (currentHolders >= achievement.maxHolders) {
        // Dans ce cas, le joueur doit défier un détenteur existant
        return true;
      }
    }
    
    return true;
  } catch (error) {
    console.error(`Erreur lors de la vérification d'éligibilité pour ${achievementCode}:`, error);
    return false;
  }
}
// Fonction pour obtenir le détenteur actuel d'un titre
async function getCurrentTitleHolder(achievementCode) {
  try {
    const results = await queryAsync(
      "SELECT username FROM achievements WHERE achievement_code = ? ORDER BY earned_at DESC LIMIT 1",
      [achievementCode]
    );

    return results.length > 0 ? results[0].username : null;
  } catch (error) {
    console.error(
      `Erreur lors de la récupération du détenteur de ${achievementCode}:`,
      error
    );
    return null;
  }
}

// Fonction pour gérer le défi de titre (à appeler après une victoire)
// Dans la fonction handleTitleChallenge
async function handleTitleChallenge(winner, loser, gameId) {
  // Liste des titres pouvant être détrônés
  const challengeableTitles = ['konungr', 'jarl', 'berserker', 'einherjar'];
  
  // Vérifier pour chaque titre
  for (const title of challengeableTitles) {
    // Vérifier si le perdant est détenteur du titre
    const loserHasTitle = await queryAsync(
      "SELECT 1 FROM achievements WHERE username = ? AND achievement_code = ?",
      [loser, title]
    );
    
    if (loserHasTitle.length === 0) continue;
    
    // Vérifier si le gagnant peut prétendre à ce titre
    const winnerCanChallenge = await canChallengeForTitle(winner, title);
    
    if (winnerCanChallenge) {
      // Transaction pour le transfert de titre
      await queryAsync("START TRANSACTION");
      
      try {
        // Révoquer le titre du perdant
        await queryAsync(
          "DELETE FROM achievements WHERE username = ? AND achievement_code = ?",
          [loser, title]
        );
        
        // Attribuer le titre au gagnant
        await queryAsync(
          "INSERT INTO achievements (username, achievement_code) VALUES (?, ?)",
          [winner, title]
        );
        
        // Enregistrer l'historique du transfert
        await queryAsync(
          "INSERT INTO achievement_transfers (achievement_code, from_username, to_username, game_id) VALUES (?, ?, ?, ?)",
          [title, loser, winner, gameId]
        );
        
        await queryAsync("COMMIT");
        
        // Notifier les joueurs du transfert de titre
        notifyTitleTransfer(winner, loser, title);
      } catch (error) {
        await queryAsync("ROLLBACK");
        console.error(`Erreur lors du transfert du titre ${title}:`, error);
      }
    }
  }
}
// Fonction pour notifier les joueurs d'un transfert de titre
// Fonction pour notifier les joueurs d'un transfert de titre
function notifyTitleTransfer(winner, loser, title) {
  // Trouver les sockets des deux joueurs
  let winnerSocketId = null;
  let loserSocketId = null;

  for (const [socketId, player] of onlinePlayers.entries()) {
    if (player.username === winner) {
      winnerSocketId = socketId;
    } else if (player.username === loser) {
      loserSocketId = socketId;
    }

    if (winnerSocketId && loserSocketId) break;
  }

  // Récupérer les informations du titre
  const titleInfo = {
    code: title,
    icon: ACHIEVEMENTS[title].icon,
    title: ACHIEVEMENTS[title].title.split("-")[0].trim(),
  };

  // Notifier le gagnant
  if (winnerSocketId) {
    io.to(winnerSocketId).emit("titleClaimed", {
      title: titleInfo.title,
      icon: titleInfo.icon,
      previousHolder: loser,
    });
  }

  // Notifier le perdant
  if (loserSocketId) {
    io.to(loserSocketId).emit("titleLost", {
      title: titleInfo.title,
      icon: titleInfo.icon,
      newHolder: winner,
    });
  }

  // Annoncer le transfert de titre à tous les joueurs
  io.emit("titleTransferred", {
    title: titleInfo.title,
    icon: titleInfo.icon,
    from: loser,
    to: winner,
  });
}
// 3. Fonctions pour vérifier les conditions des distinctions

// Vérifier si le joueur a un minimum d'ELO
async function hasMinimumElo(username, minElo) {
  try {
    const results = await queryAsync(
      "SELECT score FROM users WHERE username = ? AND score >= ?",
      [username, minElo]
    );
    return results.length > 0;
  } catch (error) {
    console.error(
      `Erreur lors de la vérification ELO pour ${username}:`,
      error
    );
    return false;
  }
}

// Vérifier si le joueur a joué un certain nombre de parties
async function hasPlayedGames(username, minGames) {
  try {
    const results = await queryAsync(
      "SELECT games_played FROM users WHERE username = ? AND games_played >= ?",
      [username, minGames]
    );
    return results.length > 0;
  } catch (error) {
    console.error(
      `Erreur lors de la vérification des parties jouées pour ${username}:`,
      error
    );
    return false;
  }
}

// Vérifier si le joueur a un certain nombre de victoires consécutives
async function hasConsecutiveWins(username, winCount) {
  try {
    const results = await queryAsync(
      `SELECT result 
       FROM games_history 
       WHERE player_username = ? 
       ORDER BY created_at DESC 
       LIMIT ?`,
      [username, winCount]
    );

    // Vérifier si nous avons suffisamment de parties et si toutes sont des victoires
    return (
      results.length >= winCount && results.every((game) => game.result === 1)
    );
  } catch (error) {
    console.error(
      `Erreur lors de la vérification des victoires consécutives pour ${username}:`,
      error
    );
    return false;
  }
}

// Vérifier les victoires contre des joueurs à ELO élevé
async function hasWinsAgainstHighElo(username, minElo, winCount) {
  try {
    const results = await queryAsync(
      `SELECT COUNT(*) AS win_count 
       FROM games_history 
       WHERE player_username = ? 
       AND result = 1 
       AND (SELECT score FROM users WHERE username = games_history.opponent_username) >= ?`,
      [username, minElo]
    );

    return results[0].win_count >= winCount;
  } catch (error) {
    console.error(
      `Erreur lors de la vérification des victoires contre ELO élevé pour ${username}:`,
      error
    );
    return false;
  }
}

// Vérifier les victoires contre différents joueurs
async function hasWinsAgainstDifferentPlayers(username, playerCount) {
  try {
    const results = await queryAsync(
      `SELECT COUNT(DISTINCT opponent_username) AS unique_opponents 
       FROM games_history 
       WHERE player_username = ? 
       AND result = 1`,
      [username]
    );

    return results[0].unique_opponents >= playerCount;
  } catch (error) {
    console.error(
      `Erreur lors de la vérification des victoires contre différents joueurs pour ${username}:`,
      error
    );
    return false;
  }
}

// Vérifier les victoires dans un intervalle de temps
async function hasWinsInTimeframe(username, winCount, hours) {
  try {
    const results = await queryAsync(
      `SELECT COUNT(*) AS win_count 
       FROM games_history 
       WHERE player_username = ? 
       AND result = 1 
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
      [username, hours]
    );

    return results[0].win_count >= winCount;
  } catch (error) {
    console.error(
      `Erreur lors de la vérification des victoires dans un intervalle de temps pour ${username}:`,
      error
    );
    return false;
  }
}

// Vérifier les victoires par une raison spécifique (mise à terre, abandon, etc.)
async function hasVictoriesByReason(username, reason, count) {
  try {
    const results = await queryAsync(
      `SELECT COUNT(*) AS wins_count 
       FROM games_history 
       WHERE player_username = ? 
       AND result = 1 
       AND end_reason = ?`,
      [username, reason]
    );

    return results[0].wins_count >= count;
  } catch (error) {
    console.error(
      `Erreur lors de la vérification des victoires par ${reason} pour ${username}:`,
      error
    );
    return false;
  }
}

// 4. Fonction pour vérifier et attribuer les distinctions
async function checkAndAwardAchievements(username) {
  try {
    // Récupérer les distinctions déjà obtenues
    const existingAchievements = await queryAsync(
      "SELECT achievement_code FROM achievements WHERE username = ?",
      [username]
    );

    const userAchievements = new Set(
      existingAchievements.map((a) => a.achievement_code)
    );
    const newAchievements = [];

    // Vérifier chaque distinction que le joueur n'a pas encore
    for (const [code, achievement] of Object.entries(ACHIEVEMENTS)) {
      if (!userAchievements.has(code)) {
        // Vérifier si le joueur remplit les conditions
        const isEligible = await achievement.check(username);

        if (isEligible) {
          // Si c'est un titre de rang avec limite, vérifier le nombre de détenteurs
          if (achievement.maxHolders !== undefined) {
            const currentHolders = await countAchievementHolders(code);

            // Ne pas attribuer si la limite est atteinte
            if (currentHolders >= achievement.maxHolders) {
              continue;
            }
          }

          // Attribuer la distinction
          await queryAsync(
            "INSERT INTO achievements (username, achievement_code) VALUES (?, ?)",
            [username, code]
          );

          newAchievements.push({
            code,
            title: achievement.title,
            icon: achievement.icon,
          });
        }
      }
    }

    return newAchievements;
  } catch (error) {
    console.error(
      `Erreur lors de la vérification des distinctions pour ${username}:`,
      error
    );
    return [];
  }
}
// 5. Fonction pour récupérer toutes les distinctions d'un joueur
async function getUserAchievements(username) {
  try {
    const results = await queryAsync(
      "SELECT achievement_code, earned_at FROM achievements WHERE username = ?",
      [username]
    );

    return results.map((a) => a.achievement_code);
  } catch (error) {
    console.error(
      `Erreur lors de la récupération des distinctions pour ${username}:`,
      error
    );
    return [];
  }
}

// 6. Modifier votre fonction de fin de partie pour vérifier les distinctions
async function afterGameCompleted(gameId, player1Username, player2Username) {
  try {
    // Déterminer le gagnant et le perdant
    const gameResult = await queryAsync(
      "SELECT player_username, result FROM games_history WHERE game_id = ? LIMIT 1",
      [gameId]
    );

    if (gameResult.length === 0) return;

    const result = gameResult[0].result;
    const player = gameResult[0].player_username;

    let winner, loser;
    if (result === 1) {
      // Le joueur a gagné
      winner = player;
      loser = player === player1Username ? player2Username : player1Username;
    } else {
      // Le joueur a perdu
      winner = player === player1Username ? player2Username : player1Username;
      loser = player;
    }

    // Gérer les défis de titre
    await handleTitleChallenge(winner, loser, gameId);

    // Vérifier les distinctions pour les deux joueurs (code existant)
    const player1Achievements = await checkAndAwardAchievements(
      player1Username
    );
    const player2Achievements = await checkAndAwardAchievements(
      player2Username
    );

    // Notifier les joueurs des nouvelles distinctions
    notifyPlayerAchievements(player1Username, player1Achievements);
    notifyPlayerAchievements(player2Username, player2Achievements);
  } catch (error) {
    console.error(
      `Erreur lors du traitement après la partie ${gameId}:`,
      error
    );
  }
}

// Fonction pour vérifier si deux noms d'utilisateur sont identiques (sensible à la casse)
function isSameUsername(username1, username2) {
  // Comparaison directe et sensible à la casse
  return username1 === username2;
}


// 7. Fonction pour notifier les joueurs de leurs nouvelles distinctions
function notifyPlayerAchievements(username, achievements) {
  if (achievements.length === 0) return;

  // Trouver le socket du joueur
  let playerSocketId = null;
  for (const [socketId, player] of onlinePlayers.entries()) {
    if (player.username === username) {
      playerSocketId = socketId;
      break;
    }
  }

  if (playerSocketId) {
    io.to(playerSocketId).emit("achievementsUnlocked", achievements);
  }
}

// Route pour la page de replay
app.get("/replay", (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.redirect("/login");
  }
  res.sendFile(__dirname + "/public/replay.html");
});

// Route pour récupérer les détails complets d'un match pour le replay
app.get("/api/match/:gameId", async (req, res) => {
  try {
    const gameId = req.params.gameId;
    console.log("API /api/match/ appelée pour gameId:", gameId);
    
    // Vérifier si la table match_data existe
    try {
      const tableCheck = await queryAsync(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'match_data'",
        []
      );
      
      if (tableCheck.length === 0) {
        console.log("La table match_data n'existe pas!");
        return res.status(500).json({ error: "La table match_data n'existe pas" });
      }
      
      console.log("Table match_data existe, on continue");
    } catch (tableError) {
      console.error("Erreur lors de la vérification de la table:", tableError);
      return res.status(500).json({ error: "Erreur lors de la vérification de la table" });
    }
    
    // Récupérer les données du match
    const matchDetails = await queryAsync(
      `SELECT 
        gh.game_id, 
        gh.player_username, 
        gh.opponent_username, 
        gh.result, 
        gh.player_elo_before, 
        gh.player_elo_after,
        gh.end_reason,
        gh.created_at,
        md.match_data
      FROM games_history gh
      LEFT JOIN match_data md ON gh.game_id = md.game_id
      WHERE gh.game_id = ?
      ORDER BY gh.id ASC
      LIMIT 2`,
      [gameId]
    );
    
    console.log("Résultats de la requête:", matchDetails);
    
    if (matchDetails.length === 0) {
      return res.status(404).json({ error: "Match non trouvé" });
    }
    
    // Gérer les données de match avec précaution
    let parsedMatchData = null;
    if (matchDetails[0].match_data) {
      console.log("Type de match_data:", typeof matchDetails[0].match_data);
      
      try {
        // Si c'est une chaîne, essayer de la parser
        if (typeof matchDetails[0].match_data === 'string') {
          parsedMatchData = JSON.parse(matchDetails[0].match_data);
        } 
        // Si c'est déjà un objet, l'utiliser directement
        else if (typeof matchDetails[0].match_data === 'object') {
          parsedMatchData = matchDetails[0].match_data;
        }
      } catch (parseError) {
        console.error("Erreur de parsing JSON:", parseError);
        // Ne pas planter, continuer avec parsedMatchData = null
      }
    }
    
    // Structurer les données sous forme d'objet match
    const match = {
      gameId: matchDetails[0].game_id,
      players: [
        {
          username: matchDetails[0].player_username,
          opponent: matchDetails[0].opponent_username,
          eloBefore: matchDetails[0].player_elo_before,
          eloAfter: matchDetails[0].player_elo_after,
          result: matchDetails[0].result
        }
      ],
      endReason: matchDetails[0].end_reason,
      createdAt: matchDetails[0].created_at,
      matchData: parsedMatchData
    };
    
    // Ajouter le deuxième joueur s'il existe
    if (matchDetails.length > 1) {
      match.players.push({
        username: matchDetails[1].player_username,
        opponent: matchDetails[1].opponent_username,
        eloBefore: matchDetails[1].player_elo_before,
        eloAfter: matchDetails[1].player_elo_after,
        result: matchDetails[1].result
      });
    }
    
    // Si les données complètes du match n'existent pas,
    // indiquer qu'il n'est pas disponible pour replay
    match.replayAvailable = !!match.matchData;
    
    res.json(match);
  } catch (error) {
    console.error("Erreur détaillée lors de la récupération des détails du match:", error);
    res.status(500).json({ error: "Erreur serveur: " + error.message });
  }
});

// Ajouter cette route dans server.js pour récupérer rapidement les statistiques d'un joueur
app.get("/api/player-stats/:username", async (req, res) => {
  try {
    const username = req.params.username;
    
    // Récupérer les statistiques de base du joueur
    const userStats = await queryAsync(
      "SELECT username, score as elo, games_played FROM users WHERE username = ?",
      [username]
    );
    
    if (userStats.length === 0) {
      return res.status(404).json({ error: "Joueur non trouvé" });
    }
    
    // Récupérer les parties jouées pour calculer le taux de victoire
    const matchHistory = await queryAsync(
      "SELECT result FROM games_history WHERE player_username = ? LIMIT 100",
      [username]
    );
    
    // Calculer le taux de victoire
    const totalGames = userStats[0].games_played;
    let wins = 0;
    
    if (matchHistory.length > 0) {
      wins = matchHistory.filter(match => match.result === 1).length;
    }
    
    const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
    
    // Vérifier si le joueur a une photo
    const hasPhoto = await checkUserHasPhoto(username);
    
    res.json({
      username: userStats[0].username,
      elo: userStats[0].elo,
      gamesPlayed: totalGames,
      wins: wins,
      winRate: winRate,
      hasPhoto: hasPhoto
    });
    
  } catch (error) {
    console.error("Erreur lors de la récupération des statistiques:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
// Route pour récupérer les détenteurs de titres
app.get("/api/title-holders", (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  
  // La requête récupère les détenteurs actuels des titres limités
  db.query(
    `SELECT a.username, a.achievement_code, a.earned_at
     FROM achievements a
     WHERE a.achievement_code IN ('konungr', 'jarl', 'berserker', 'einherjar')
     ORDER BY 
       CASE 
         WHEN a.achievement_code = 'konungr' THEN 1
         WHEN a.achievement_code = 'jarl' THEN 2
         WHEN a.achievement_code = 'berserker' THEN 3
         WHEN a.achievement_code = 'einherjar' THEN 4
       END`,
    (err, results) => {
      if (err) {
        console.error("Erreur lors de la récupération des détenteurs de titre:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      res.json(results);
    }
  );
});

// Route pour récupérer les détenteurs de distinctions par catégorie
app.get("/api/achievement-holders", (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  
  const category = req.query.category;
  let achievementCodes = [];
  
  // Définir les codes d'achievement en fonction de la catégorie
  if (category === 'exploits') {
    achievementCodes = ['skald', 'thegn', 'drengr', 'hersir'];
  } else if (category === 'conquests') {
    achievementCodes = ['ulfhednar', 'hirdman'];
  } else {
    return res.status(400).json({ error: "Catégorie non valide" });
  }
  
  // Récupérer les détenteurs pour les codes spécifiés
  db.query(
    `SELECT username, achievement_code, earned_at
     FROM achievements
     WHERE achievement_code IN (?)
     ORDER BY earned_at DESC`,
    [achievementCodes],
    (err, results) => {
      if (err) {
        console.error(`Erreur lors de la récupération des détenteurs de la catégorie ${category}:`, err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      res.json(results);
    }
  );
});

// Route pour récupérer l'historique des transferts de titre
app.get("/api/title-transfers/history", (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  
  db.query(
    `SELECT * FROM achievement_transfers
     ORDER BY transferred_at DESC
     LIMIT 30`,
    (err, results) => {
      if (err) {
        console.error("Erreur lors de la récupération de l'historique des transferts:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      res.json(results);
    }
  );
});

// Route pour accéder à la page du Temple de la Gloire
app.get("/temple", (req, res) => {
  if (req.session && req.session.loggedin) {
    res.sendFile(__dirname + "/public/temple.html");
  } else {
    res.redirect("/login");
  }
});


// Ajouter cet endpoint API pour récupérer l'historique des transferts récents
// Route API pour récupérer l'historique des transferts récents
app.get("/api/title-transfers/recent", (req, res) => {
  db.query(
    `SELECT 
      at.*, 
      at.from_username, 
      at.to_username, 
      at.transferred_at,
      at.achievement_code,
      CASE 
        WHEN at.achievement_code = 'konungr' THEN '🏆'
        WHEN at.achievement_code = 'jarl' THEN '👑'
        WHEN at.achievement_code = 'berserker' THEN '🪓'
        WHEN at.achievement_code = 'einherjar' THEN '⚔️'
        ELSE '🏅'
      END as achievement_icon,
      CASE 
        WHEN at.achievement_code = 'konungr' THEN 'Konungr'
        WHEN at.achievement_code = 'jarl' THEN 'Jarl'
        WHEN at.achievement_code = 'berserker' THEN 'Berserker'
        WHEN at.achievement_code = 'einherjar' THEN 'Einherjar'
        ELSE at.achievement_code
      END as achievement_title
    FROM achievement_transfers at
    ORDER BY transferred_at DESC 
    LIMIT 10`,
    (err, results) => {
      if (err) {
        console.error(
          "Erreur lors de la récupération des transferts récents:",
          err
        );
        return res.status(500).json({ error: "Erreur serveur" });
      }
      res.json(results);
    }
  );
});
// Ajouter cette route API pour modifier le nom d'utilisateur
// Route pour vérifier si l'utilisateur peut changer son nom d'utilisateur
app.get('/api/check-name-change-eligibility', async (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  const username = req.session.username;
  
  try {
    // Vérifier si la colonne existe avant de l'utiliser
    const checkColumn = await queryAsync(
      "SHOW COLUMNS FROM users LIKE 'last_name_change'"
    );
    
    // Si la colonne n'existe pas, autoriser le changement de nom
    if (checkColumn.length === 0) {
      return res.json({ 
        canChange: true,
        message: "La vérification des restrictions n'est pas encore configurée"
      });
    }
    
    // Récupérer la date du dernier changement de nom
    const result = await queryAsync(
      "SELECT last_name_change FROM users WHERE username = ?",
      [username]
    );
    
    if (result.length === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }
    
    const lastNameChange = result[0].last_name_change;
    
    // Si jamais changé de nom, autoriser immédiatement
    if (!lastNameChange) {
      return res.json({ 
        canChange: true,
        message: "Premier changement de nom"
      });
    }
    
    // Récupérer les titres pour déterminer le délai applicable
    const userAchievements = await getUserAchievements(username);
    
    // Définir le délai en fonction des titres
    let requiredDays = 30; // Délai par défaut
    
    if (userAchievements.includes('konungr')) {
      requiredDays = 1; // Le Konungr peut changer son nom chaque jour
    } else if (userAchievements.includes('jarl')) {
      requiredDays = 7; // Le Jarl peut changer son nom chaque semaine
    } else if (userAchievements.includes('berserker') || userAchievements.includes('einherjar')) {
      requiredDays = 14; // Les Berserker et Einherjar peuvent changer leur nom toutes les deux semaines
    }
    
    // Calculer le temps écoulé depuis le dernier changement
    const lastChange = new Date(lastNameChange);
    const now = new Date();
    const daysSinceLastChange = Math.floor((now - lastChange) / (1000 * 60 * 60 * 24));
    
    // Déterminer si l'utilisateur peut changer son nom
    const canChange = daysSinceLastChange >= requiredDays;
    
    // Calculer la date du prochain changement possible
    const nextChangeDate = new Date(lastChange);
    nextChangeDate.setDate(nextChangeDate.getDate() + requiredDays);
    
    // Calculer les jours restants
    const daysLeft = Math.max(0, requiredDays - daysSinceLastChange);
    
    res.json({
      canChange: canChange,
      lastChangeDate: lastChange,
      nextChangeDate: nextChangeDate,
      daysLeft: daysLeft,
      requiredDays: requiredDays
    });
    
  } catch (error) {
    console.error("Erreur lors de la vérification de l'éligibilité au changement de nom:", error);
    // En cas d'erreur, autoriser quand même le changement pour éviter de bloquer la fonctionnalité
    res.json({ 
      canChange: true,
      message: "Erreur lors de la vérification, changement autorisé par défaut",
      error: error.message
    });
  }
});
// Ajouter cette route API pour modifier le nom d'utilisateur
app.post('/api/update-username', async (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  const { newUsername, password } = req.body;
  const currentUsername = req.session.username;

  // Vérifications de base
  if (!newUsername || !password) {
    return res.status(400).json({ error: "Le nouveau nom d'utilisateur et le mot de passe sont requis" });
  }

  if (newUsername === currentUsername) {
    return res.status(400).json({ error: "Le nouveau nom d'utilisateur doit être différent de l'actuel" });
  }
  if (newUsername.length > 15) {
    return res.status(400).json({ error: "Le nom d'utilisateur ne peut pas dépasser 15 caractères" });
  }
  
  if (newUsername.length < 3) {
    return res.status(400).json({ error: "Le nom d'utilisateur doit contenir au moins 3 caractères" });
  }


  try {
    // Vérifier si la colonne last_name_change existe 
    const checkColumn = await queryAsync(
      "SHOW COLUMNS FROM users LIKE 'last_name_change'"
    );
    
    // Si elle n'existe pas, l'ajouter
    if (checkColumn.length === 0) {
      try {
        await queryAsync(
          "ALTER TABLE users ADD COLUMN last_name_change TIMESTAMP NULL"
        );
        console.log("Colonne last_name_change ajoutée à la table users");
      } catch (err) {
        console.error("Erreur lors de l'ajout de la colonne last_name_change:", err);
        // Continuer même en cas d'erreur
      }
    }
    
    // Vérification des restrictions de changement de nom seulement si la colonne existe
    if (checkColumn.length > 0) {
      try {
        // Récupérer la date du dernier changement de nom d'utilisateur
        const lastNameChangeResult = await queryAsync(
          "SELECT last_name_change FROM users WHERE username = ?",
          [currentUsername]
        );
        
        if (lastNameChangeResult.length > 0 && lastNameChangeResult[0].last_name_change) {
          const lastChange = new Date(lastNameChangeResult[0].last_name_change);
          const now = new Date();
          const daysSinceLastChange = Math.floor((now - lastChange) / (1000 * 60 * 60 * 24));
          
          // Récupérer les titres de l'utilisateur pour déterminer ses privilèges
          const userAchievements = await getUserAchievements(currentUsername);
          
          // Définir les délais en fonction des titres
          let requiredDays = 30; // Délai par défaut pour les utilisateurs sans titre
          
          if (userAchievements.includes('konungr')) {
            requiredDays = 1; // Le Konungr peut changer son nom chaque jour
          } else if (userAchievements.includes('jarl')) {
            requiredDays = 7; // Le Jarl peut changer son nom chaque semaine
          } else if (userAchievements.includes('berserker') || userAchievements.includes('einherjar')) {
            requiredDays = 14; // Les Berserker et Einherjar peuvent changer leur nom toutes les deux semaines
          }
          
          if (daysSinceLastChange < requiredDays) {
            // Calculer le temps restant
            const daysLeft = requiredDays - daysSinceLastChange;
            return res.status(400).json({ 
              error: `Vous ne pouvez pas changer votre nom pour le moment. Prochain changement autorisé dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}.`,
              daysLeft: daysLeft,
              nextChangeDate: new Date(lastChange.getTime() + (requiredDays * 24 * 60 * 60 * 1000))
            });
          }
        }
      } catch (err) {
        console.error("Erreur lors de la vérification des restrictions:", err);
        // Continuer même en cas d'erreur
      }
    }

    // Vérifier que le nouveau nom d'utilisateur n'existe pas déjà
    const usernameExists = await queryAsync(
      "SELECT 1 FROM users WHERE username = ? AND username = ? COLLATE utf8mb4_bin",
      [newUsername, newUsername]
    );

    if (usernameExists.length > 0) {
      return res.status(400).json({ error: "Ce nom d'utilisateur est déjà utilisé" });
    }

    // Vérifier le mot de passe de l'utilisateur
    const userData = await queryAsync(
      "SELECT password FROM users WHERE username = ?",
      [currentUsername]
    );

    if (userData.length === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    const passwordMatch = await bcrypt.compare(password, userData[0].password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Mot de passe incorrect" });
    }

    // Commencer une transaction pour mettre à jour toutes les tables
    await queryAsync("START TRANSACTION");

    try {
      // Mettre à jour la table principale des utilisateurs
      await queryAsync(
        "UPDATE users SET username = ? WHERE username = ?",
        [newUsername, currentUsername]
      );

      // Mettre à jour les autres tables qui utilisent le nom d'utilisateur
      const tablesToUpdate = [
        { table: "games_history", columns: ["player_username", "opponent_username"] },
        { table: "global_chat", columns: ["username"] },
        { table: "achievement_transfers", columns: ["from_username", "to_username"] },
        { table: "profile_photos", columns: ["username"] },
        { table: "achievements", columns: ["username"] }
      ];

      for (const table of tablesToUpdate) {
        for (const column of table.columns) {
          await queryAsync(
            `UPDATE ${table.table} SET ${column} = ? WHERE ${column} = ?`,
            [newUsername, currentUsername]
          );
        }
      }

      // Mettre à jour la date du dernier changement de nom si la colonne existe
      try {
        await queryAsync(
          "UPDATE users SET last_name_change = NOW() WHERE username = ?",
          [newUsername]
        );
      } catch (err) {
        // Ignorer les erreurs ici, ce n'est pas critique
        console.warn("Attention: impossible de mettre à jour last_name_change:", err);
      }

      await queryAsync("COMMIT");

      // Mettre à jour la session
      req.session.username = newUsername;
      req.session.save();

      // Récupérer les titres de l'utilisateur pour la réponse
      const userAchievements = await getUserAchievements(newUsername);
      
      // Déterminer le délai avant le prochain changement possible
      let nextChangeDays = 30; // Délai par défaut
      
      if (userAchievements.includes('konungr')) {
        nextChangeDays = 1;
      } else if (userAchievements.includes('jarl')) {
        nextChangeDays = 7;
      } else if (userAchievements.includes('berserker') || userAchievements.includes('einherjar')) {
        nextChangeDays = 14;
      }
      
      const nextChangeDate = new Date();
      nextChangeDate.setDate(nextChangeDate.getDate() + nextChangeDays);
      
      res.json({ 
        success: true, 
        newUsername,
        nextChangeDate: nextChangeDate,
        nextChangeDays: nextChangeDays
      });
    } catch (error) {
      await queryAsync("ROLLBACK");
      console.error("Erreur lors du changement de nom d'utilisateur:", error);
      res.status(500).json({ error: "Une erreur est survenue lors de la mise à jour du nom d'utilisateur" });
    }
  } catch (error) {
    console.error("Erreur lors de la vérification du nom d'utilisateur:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
// Route pour télécharger une photo de profil
app.post('/api/upload-profile-photo', upload.single('photo'), async (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Aucun fichier téléchargé" });
  }

  try {
    const username = req.session.username;
    
    // Redimensionner et optimiser l'image
    const processedImageBuffer = await sharp(req.file.buffer)
      .resize({ width: 200, height: 200, fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Vérifier si l'utilisateur a déjà une photo
    const checkExisting = await queryAsync(
      "SELECT 1 FROM profile_photos WHERE username = ?",
      [username]
    );

    let result;
    if (checkExisting.length > 0) {
      // Mettre à jour la photo existante
      result = await queryAsync(
        "UPDATE profile_photos SET photo_data = ?, photo_type = ?, uploaded_at = NOW() WHERE username = ?",
        [processedImageBuffer, 'image/jpeg', username]
      );
    } else {
      // Insérer une nouvelle photo
      result = await queryAsync(
        "INSERT INTO profile_photos (username, photo_data, photo_type) VALUES (?, ?, ?)",
        [username, processedImageBuffer, 'image/jpeg']
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Erreur lors du téléchargement de la photo:", error);
    res.status(500).json({ error: "Erreur lors du traitement de l'image" });
  }
});

// Route pour récupérer une photo de profil
app.get('/api/profile-photo/:username', async (req, res) => {
  try {
    const username = req.params.username;
    
    const result = await queryAsync(
      "SELECT photo_data, photo_type FROM profile_photos WHERE username = ?",
      [username]
    );

    if (result.length === 0) {
      return res.status(404).send('Photo non trouvée');
    }

    const photo = result[0];
    res.set('Content-Type', photo.photo_type);
    res.send(photo.photo_data);
  } catch (error) {
    console.error("Erreur lors de la récupération de la photo:", error);
    res.status(500).send('Erreur serveur');
  }
});

// Route pour supprimer une photo de profil
app.delete('/api/profile-photo', async (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  try {
    const username = req.session.username;
    
    await queryAsync(
      "DELETE FROM profile_photos WHERE username = ?",
      [username]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Erreur lors de la suppression de la photo:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 8. Modifier la route de profil pour inclure les distinctions
app.get("/api/profile/:username", (req, res) => {
  const username = req.params.username;

  // Requête pour les données utilisateur
  db.query(
    "SELECT username, score, games_played, created_at, (SELECT MAX(created_at) FROM games_history WHERE player_username = users.username) as last_active FROM users WHERE username = ?",
    [username],
    async (err, userData) => {
      if (err) {
        console.error("Erreur lors de la récupération des données utilisateur:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }

      if (userData.length === 0) {
        return res.status(404).json({ error: "Utilisateur non trouvé" });
      }

      try {
        // Vérifier si l'utilisateur a une photo de profil
        const photoResult = await queryAsync(
          "SELECT 1 FROM profile_photos WHERE username = ?",
          [username]
        );
        
        const hasProfilePhoto = photoResult.length > 0;

        // Récupérer les distinctions de l'utilisateur
        const achievements = await getUserAchievements(username);

        // Requête pour l'historique des matches
        db.query(
          `SELECT 
            game_id,
            opponent_username,
            result,
            player_elo_before,
            player_elo_after,
            (player_elo_after - player_elo_before) as elo_change,
            end_reason,
            created_at
          FROM games_history 
          WHERE player_username = ?
          ORDER BY created_at DESC 
          LIMIT 10`,
          [username],
          (err, matchHistory) => {
            if (err) {
              console.error("Erreur lors de la récupération de l'historique:", err);
              return res.status(500).json({ error: "Erreur serveur" });
            }

            const stats = {
              totalGames: userData[0].games_played,
              wins: matchHistory.filter((match) => match.result === 1).length,
              losses: matchHistory.filter((match) => match.result === 0).length,
              currentElo: userData[0].score,
              winRate:
                userData[0].games_played > 0
                  ? Math.round(
                      (matchHistory.filter((match) => match.result === 1)
                        .length /
                        userData[0].games_played) *
                        100
                    )
                  : 0,
            };

            res.json({
              user: {
                ...userData[0],
                achievements: achievements,
                hasProfilePhoto: hasProfilePhoto
              },
              stats,
              matchHistory,
            });
          }
        );
      } catch (error) {
        console.error("Erreur lors de la récupération des données:", error);
        return res.status(500).json({ error: "Erreur serveur" });
      }
    }
  );
});
// Exemple de fonction de nettoyage que vous pourriez exécuter périodiquement
function cleanupOldMessages() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  db.query(
    "DELETE FROM global_chat WHERE timestamp < ?",
    [thirtyDaysAgo],
    (err, result) => {
      if (err) {
        console.error("Erreur lors du nettoyage des anciens messages:", err);
      } else {
        console.log(`${result.affectedRows} anciens messages supprimés.`);
      }
    }
  );
}

// Exécuter ce nettoyage une fois par jour à minuit
setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000);

// Garder une trace des joueurs en ligne
const onlinePlayers = new Map();
const games = {};

// Ajouter ces variables au début du fichier, après la déclaration des autres variables
const matchRequests = new Map(); // Pour stocker les demandes de match en cours

// Configurer correctement les fichiers statiques
app.use(express.static("public"));

// Utiliser la session dans Express
app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware d'authentification
function requireLogin(req, res, next) {
  if (req.session && req.session.loggedin) {
    next();
  } else {
    // Stocker l'URL demandée pour redirection après login
    req.session.returnTo = req.originalUrl;
    res.redirect("/login");
  }
}

// Fonction de calcul ELO
function calculateNewElo(playerElo, opponentElo, score) {
  const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  return Math.round(playerElo + ELO_K_FACTOR * (score - expectedScore));
}

// Middleware d'authentification simplifié
app.use((req, res, next) => {
  // Liste des chemins autorisés sans authentification
  const publicPaths = ["/login", "/register"];

  // Autoriser l'accès aux fichiers statiques et aux chemins publics
  if (
    req.path.startsWith("/css") ||
    req.path.startsWith("/js") ||
    req.path.startsWith("/public") ||
    publicPaths.includes(req.path)
  ) {
    return next();
  }

  // Vérifier l'authentification
  if (req.session && req.session.loggedin) {
    return next();
  }

  // Rediriger vers login si non authentifié
  res.redirect("/login");
});

// Routes principales
app.get("/", (req, res) => {
  if (req.session && req.session.loggedin) {
    res.redirect("/accueil");
  } else {
    res.redirect("/login");
  }
});

// Ajouter des logs pour le débogage
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  
  if (username && password) {
    // Requête de vérification...
    db.query(
      "SELECT users.*, CASE WHEN profile_photos.id IS NOT NULL THEN 1 ELSE 0 END AS has_photo " +
      "FROM users " +
      "LEFT JOIN profile_photos ON users.username = profile_photos.username " +
      "WHERE users.username = ? AND users.username = ? COLLATE utf8mb4_bin",
      [username, username],
      (err, results) => {
        if (err) {
          return res.redirect("/login?error=server");
        }
        
        if (results.length > 0) {
          bcrypt.compare(password, results[0].password, (err, match) => {
            if (match) {
              // Connexion réussie
              req.session.loggedin = true;
              req.session.username = results[0].username;
              req.session.hasPhoto = results[0].has_photo === 1;
              res.redirect("/accueil");
            } else {
              // Mot de passe incorrect
              res.redirect(`/login?error=password&username=${encodeURIComponent(username)}`);
            }
          });
        } else {
          // Utilisateur non trouvé
          res.redirect("/login?error=user");
        }
      }
    );
  } else {
    // Données manquantes
    res.redirect("/login?error=missing");
  }
});


app.get("/accueil", (req, res) => {
  console.log("Tentative d'accès à /accueil");
  console.log("Session:", req.session);
  console.log("LoggedIn:", req.session?.loggedin);
  console.log("Directory:", __dirname);

  if (req.session && req.session.loggedin) {
    const filePath = __dirname + "/public/accueil.html";
    console.log("Chemin du fichier:", filePath);

    // Vérifier si le fichier existe
    if (require("fs").existsSync(filePath)) {
      console.log("Le fichier accueil.html existe");
      res.sendFile(filePath);
    } else {
      console.log("Le fichier accueil.html n'existe pas");
      res.status(404).send("Page non trouvée");
    }
  } else {
    console.log("Utilisateur non authentifié, redirection vers /login");
    res.redirect("/login");
  }
});

// Ajouter cette route dans votre section des routes
app.get("/profile/:username", (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.redirect("/login");
  }

  const username = req.params.username;
  res.sendFile(__dirname + "/public/profile.html");
});

app.get("/api/profile/:username", (req, res) => {
  const username = req.params.username;

  // Requête pour les données utilisateur
  db.query(
    "SELECT username, score, games_played FROM users WHERE username = ?",
    [username],
    (err, userData) => {
      if (err) {
        console.error(
          "Erreur lors de la récupération des données utilisateur:",
          err
        );
        return res.status(500).json({ error: "Erreur serveur" });
      }

      if (userData.length === 0) {
        return res.status(404).json({ error: "Utilisateur non trouvé" });
      }

      // Requête pour l'historique des matches avec tous les détails
      db.query(
        `SELECT 
          game_id,
          opponent_username,
          result,
          player_elo_before,
          player_elo_after,
          (player_elo_after - player_elo_before) as elo_change,
          end_reason,
          created_at
        FROM games_history 
        WHERE player_username = ?
        ORDER BY created_at DESC 
        LIMIT 10`,
        [username],
        (err, matchHistory) => {
          if (err) {
            console.error(
              "Erreur lors de la récupération de l'historique:",
              err
            );
            return res.status(500).json({ error: "Erreur serveur" });
          }

          const stats = {
            totalGames: userData[0].games_played,
            wins: matchHistory.filter((match) => match.result === 1).length,
            losses: matchHistory.filter((match) => match.result === 0).length,
            currentElo: userData[0].score,
            winRate:
              userData[0].games_played > 0
                ? Math.round(
                    (matchHistory.filter((match) => match.result === 1).length /
                      userData[0].games_played) *
                      100
                  )
                : 0,
          };

          res.json({
            user: userData[0],
            stats,
            matchHistory,
          });
        }
      );
    }
  );
});

// Ajoutez une route pour récupérer les parties en cours
app.get("/api/active-games", (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  const activeGames = [];

  for (const [gameId, game] of Object.entries(games)) {
    // Ne pas inclure les parties privées
    if (!game.gameState.isPublic) continue;

    // S'assurer qu'il y a au moins 2 joueurs (partie en cours)
    if (game.players.length >= 2) {
      activeGames.push({
        id: gameId,
        player1: game.gameState.player1Name,
        player2: game.gameState.player2Name,
        scoreRed: game.gameState.scoreRed,
        scoreBlue: game.gameState.scoreBlue,
        spectatorCount: game.spectators.length,
        inProgress: true,
      });
    }
  }

  res.json(activeGames);
});

app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});

app.get("/register", (req, res) => {
  res.sendFile(__dirname + "/public/register.html");
});

app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (username && password) {
    bcrypt.hash(password, 8, (err, hash) => {
      if (err) throw err;
      // Modifier la requête pour inclure le score initial de 1200
      db.query(
        "INSERT INTO users (username, password, score, games_played) VALUES (?, ?, 1200, 0)",
        [username, hash],
        (err) => {
          if (err) {
            return res.status(500).send("Error registering user");
          }
          res.redirect("/login");
        }
      );
    });
  } else {
    res.status(400).send("Please enter username and password");
  }
});

app.get("/game", (req, res) => {
  if (req.session && req.session.loggedin) {
    res.sendFile(__dirname + "/public/game.html");
  } else {
    res.redirect("/login");
  }
});

app.get("/logout", (req, res) => {
  if (req.session.username) {
    // Trouver et supprimer le joueur de la liste des joueurs en ligne
    for (const [socketId, player] of onlinePlayers.entries()) {
      if (player.username === req.session.username) {
        onlinePlayers.delete(socketId);
        io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
        break;
      }
    }
  }

  req.session.destroy((err) => {
    if (err) {
      console.log(err);
    }
    res.redirect("/login");
  });
});

// Ajouter une route pour vérifier l'état de la session
app.get("/check-session", (req, res) => {
  if (req.session && req.session.loggedin) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// Route de débogage
app.get("/debug-session", (req, res) => {
  res.json({
    session: req.session,
    loggedin: req.session?.loggedin,
    username: req.session?.username,
  });
});

// Ajouter cette variable pour stocker les messages du chat global

// Attacher la session à Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Gestion des connexions Socket.IO
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Map pour stocker les timeouts de déconnexion par utilisateur
  const userDisconnectTimeouts = new Map();

  // Ajouter le joueur connecté à la liste des joueurs en ligne
  if (socket.request.session?.username) {
    const username = socket.request.session.username;

    // Annuler tout timeout de déconnexion existant pour cet utilisateur
    if (userDisconnectTimeouts.has(username)) {
      clearTimeout(userDisconnectTimeouts.get(username));
      userDisconnectTimeouts.delete(username);
    }
    // Trouver les parties où ce joueur était
    for (const [gameId, game] of Object.entries(games)) {
      if (game.players.some(p => p.username === username)) {
        // Mettre à jour l'ID du socket
        const player = game.players.find(p => p.username === username);
        if (player) {
          player.id = socket.id;
          
          // Notifier les autres joueurs de la reconnexion
          io.to(gameId).emit('playerReconnected', {
            username: username,
            message: `${username} s'est reconnecté.`
          });
        }
      }
    }
  

    // Mettre à jour les connexions existantes
    for (const [oldSocketId, player] of onlinePlayers.entries()) {
      if (player.username === username) {
        onlinePlayers.delete(oldSocketId);
        break;
      }
    }

    // Vérifier si l'utilisateur a une photo de profil
    checkUserHasPhoto(username).then(hasPhoto => {
      // Ajouter le nouveau joueur avec l'information sur sa photo
      onlinePlayers.set(socket.id, {
        username: username,
        inGame: false,
        id: socket.id,
        hasPhoto: hasPhoto
      });

      
      io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
    });

    // Récupérer les statistiques du joueur et l'ajouter à la liste des joueurs en ligne
    getPlayerStats(username).then(stats => {
      onlinePlayers.set(socket.id, {
        username: username,
        inGame: false,
        id: socket.id,
        elo: stats.elo,
        winRate: stats.winRate,
        gamesPlayed: stats.gamesPlayed,
        hasPhoto: stats.hasPhoto
      });
      
      // Envoyer la liste mise à jour à tous les clients
      io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
    });

    
    

    // Ajouter le nouveau joueur
    onlinePlayers.set(socket.id, {
      username: username,
      inGame: false,
      id: socket.id,
    });
    io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));

    // Rejoindre automatiquement la partie en cours
    for (const [gameId, game] of Object.entries(games)) {
      const existingPlayer = game.players.find((p) => p.username === username);
      if (existingPlayer) {
        existingPlayer.id = socket.id;

          // Mettre à jour le statut "en partie"
          if (onlinePlayers.has(socket.id)) {
            const player = onlinePlayers.get(socket.id);
            player.inGame = true;
            onlinePlayers.set(socket.id, player);
            io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
          }

        socket.join(gameId);
        socket.emit("gameJoined", {
          playerType: existingPlayer.type,
          gameState: game.gameState,
          gameId: gameId,
        });
        if (game.players.length === 2) {
          socket.emit("gameStart", game.gameState);
        }
        break;
      }
    }
  }

  socket.on('sendAdminMessage', function(message) {
    // Vérifier si le message est vide
    if (!message || message.trim().length === 0) return;
    
    // S'assurer que l'utilisateur est bien connecté et a la permission d'administrateur
    // Note: Dans cet exemple, la vérification d'admin se fait côté client pour simplifier
    // Dans un environnement de production, ajoutez une vérification côté serveur plus sécurisée
    
    // Insérer le message dans la base de données
    db.query(
      "INSERT INTO admin_messages (message) VALUES (?)",
      [message],
      (err, result) => {
        if (err) {
          console.error("Erreur lors de l'enregistrement du message administratif:", err);
          return;
        }
        
        // Récupérer le message avec son ID et timestamp
        db.query(
          "SELECT id, message AS text, timestamp FROM admin_messages WHERE id = ?",
          [result.insertId],
          (err, messageData) => {
            if (err || !messageData.length) {
              console.error("Erreur lors de la récupération du message administratif:", err);
              return;
            }
            
            // Envoyer le message à tous les clients connectés
            io.emit('newAdminMessage', messageData[0]);
          }
        );
      }
    );
  });
  
  // Récupération des messages administratifs
  socket.on('getAdminMessages', function() {
    db.query(
      "SELECT id, message AS text, timestamp FROM admin_messages ORDER BY timestamp DESC LIMIT 20",
      (err, messages) => {
        if (err) {
          console.error("Erreur lors de la récupération des messages administratifs:", err);
          socket.emit('adminMessages', []);
          return;
        }
        
        // Envoyer les messages au client
        socket.emit('adminMessages', messages);
      }
    );
  });
  socket.on("getRecentTitleTransfers", () => {
    db.query(
      `SELECT 
        at.*, 
        at.from_username, 
        at.to_username, 
        at.transferred_at,
        at.achievement_code,
        CASE 
          WHEN at.achievement_code = 'konungr' THEN '🏆'
          WHEN at.achievement_code = 'jarl' THEN '👑'
          WHEN at.achievement_code = 'berserker' THEN '🪓'
          WHEN at.achievement_code = 'einherjar' THEN '⚔️'
          ELSE '🏅'
        END as achievement_icon,
        CASE 
          WHEN at.achievement_code = 'konungr' THEN 'Konungr'
          WHEN at.achievement_code = 'jarl' THEN 'Jarl'
          WHEN at.achievement_code = 'berserker' THEN 'Berserker'
          WHEN at.achievement_code = 'einherjar' THEN 'Einherjar'
          ELSE at.achievement_code
        END as achievement_title
      FROM achievement_transfers at
      ORDER BY transferred_at DESC 
      LIMIT 10`,
      (err, results) => {
        if (err) {
          console.error(
            "Erreur lors de la récupération des transferts récents:",
            err
          );
          socket.emit("recentTitleTransfers", []);
          return;
        }
        socket.emit("recentTitleTransfers", results);
      }
    );
  });

  socket.on("markMessagesAsRead", () => {
    if (!socket.request.session?.username) return;

    const username = socket.request.session.username;

    // Obtenir l'ID du dernier message
    db.query("SELECT MAX(id) as lastId FROM global_chat", (err, result) => {
      if (err || !result[0].lastId) return;

      lastSeenMessageIds.set(username, result[0].lastId);
    });
  });

  socket.on("spectateGame", (gameId) => {
    console.log(
      `Utilisateur ${socket.request.session.username} tente de rejoindre la partie ${gameId} en tant que spectateur`
    );

    if (!socket.request.session?.loggedin) {
      socket.emit("notAuthenticated");
      return;
    }

    if (!games[gameId]) {
      socket.emit("gameNotFound");
      return;
    }

    const game = games[gameId];
    const username = socket.request.session.username;

    // Vérifier si l'utilisateur est déjà un spectateur
    const existingSpectator = game.spectators.find(
      (s) => s.username === username
    );
    if (existingSpectator) {
      existingSpectator.socketId = socket.id;
    } else {
      // Ajouter l'utilisateur aux spectateurs
      game.spectators.push({
        username: username,
        socketId: socket.id,
      });

      // Notifier les joueurs et autres spectateurs qu'un nouveau spectateur a rejoint
      io.to(gameId).emit("spectatorJoined", {
        spectatorCount: game.spectators.length,
        username: username,
      });
    }

    // Rejoindre la room Socket.IO pour cette partie
    socket.join(gameId);

    // Envoyer l'état actuel du jeu au spectateur
    socket.emit("gameSpectated", {
      gameState: game.gameState,
      gameId: gameId,
    });

    // Mettre à jour le joueur comme étant en ligne mais pas "en partie"
    if (onlinePlayers.has(socket.id)) {
      const player = onlinePlayers.get(socket.id);
      player.spectating = gameId;
      onlinePlayers.set(socket.id, player);
      io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
    }
  });

  // Ajouter cette fonction pour envoyer le nombre de messages non lus
  socket.on("getUnreadMessageCount", () => {
    if (!socket.request.session?.username) return;

    const username = socket.request.session.username;
    const lastSeenId = lastSeenMessageIds.get(username) || 0;

    db.query(
      "SELECT COUNT(*) as count FROM global_chat WHERE id > ?",
      [lastSeenId],
      (err, result) => {
        if (err) {
          console.error("Erreur lors du comptage des messages non lus:", err);
          return;
        }

        socket.emit("unreadMessageCount", result[0].count);
      }
    );
  });

  const globalChatMessages = [];
  const MAX_GLOBAL_MESSAGES = 50; // Limiter le nombre de messages stockés

  // Ajouter cette gestion d'événements socket pour le chat global
  socket.on("sendGlobalMessage", (message) => {
    if (!socket.request.session?.username) return;

    const username = socket.request.session.username;
    const text = message.trim();

    if (text.length === 0 || text.length > 150) return; // Validation basique

    // Insérer le message dans la base de données
    db.query(
      "INSERT INTO global_chat (username, message) VALUES (?, ?)",
      [username, text],
      (err, result) => {
        if (err) {
          console.error("Erreur lors de l'enregistrement du message:", err);
          return;
        }

        // Récupérer le message avec son ID et son timestamp
        db.query(
          "SELECT id, username, message, timestamp FROM global_chat WHERE id = ?",
          [result.insertId],
          (err, messageData) => {
            if (err || !messageData.length) {
              console.error("Erreur lors de la récupération du message:", err);
              return;
            }

            // Construire l'objet message
            const newMessage = {
              id: messageData[0].id,
              username: messageData[0].username,
              text: messageData[0].message,
              timestamp: messageData[0].timestamp,
            };

            // Diffuser le message à tous les utilisateurs connectés
            io.emit("globalChatMessage", newMessage);
          }
        );
      }
    );
  });
  // Ajouter cet événement pour récupérer l'historique des messages
  socket.on("getGlobalChatHistory", () => {
    // Récupérer les 50 derniers messages
    db.query(
      "SELECT id, username, message AS text, timestamp FROM global_chat ORDER BY timestamp DESC LIMIT 50",
      (err, messages) => {
        if (err) {
          console.error(
            "Erreur lors de la récupération de l'historique des messages:",
            err
          );
          socket.emit("globalChatHistory", []);
          return;
        }

        // Inverser l'ordre pour avoir les plus anciens en premier
        messages.reverse();

        socket.emit("globalChatHistory", messages);
      }
    );
  });

  // Gestion des joueurs en ligne
  socket.on("requestOnlinePlayers", () => {
    socket.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
  });

  // Gestion du classement
  socket.on("requestLeaderboard", async () => {
  try {
    // Récupérer le classement de base
    const basicLeaderboard = await queryAsync(
      "SELECT username, score, games_played FROM users ORDER BY score DESC LIMIT 10"
    );
    
    // Pour chaque joueur, récupérer les statistiques supplémentaires
    const enrichedLeaderboard = await Promise.all(
      basicLeaderboard.map(async (player) => {
        // Vérifier si le joueur a une photo de profil
        const photoCheck = await queryAsync(
          "SELECT 1 FROM profile_photos WHERE username = ?",
          [player.username]
        );
        
        // Calculer le taux de victoire
        const matchHistory = await queryAsync(
          "SELECT result FROM games_history WHERE player_username = ? LIMIT 100",
          [player.username]
        );
        
        let wins = 0;
        if (matchHistory.length > 0) {
          wins = matchHistory.filter(match => match.result === 1).length;
        }
        
        const winRate = player.games_played > 0 
          ? Math.round((wins / player.games_played) * 100) 
          : 0;
        
        // Vérifier si le joueur est en ligne
        const isOnline = Array.from(onlinePlayers.values()).some(
          p => p.username === player.username
        );
        
        // Vérifier si le joueur est en partie
        const inGame = Array.from(onlinePlayers.values()).some(
          p => p.username === player.username && p.inGame
        );
        
        // Retourner le joueur avec les données enrichies
        return {
          ...player,
          hasPhoto: photoCheck.length > 0,
          winRate: winRate,
          wins: wins,
          isOnline: isOnline,
          inGame: inGame
        };
      })
    );
    
    socket.emit("updateLeaderboard", enrichedLeaderboard);
  } catch (error) {
    console.error("Erreur lors de la récupération du classement:", error);
    socket.emit("updateLeaderboard", []);
  }
});

  // Dans server.js, remplacer le gestionnaire d'abandon existant
  // Dans server.js, modifions le gestionnaire d'abandon
  socket.on("abandonGame", async ({ gameId, player }) => {
    const game = games[gameId];
    if (!game) return;

    try {
      const winner = player === "player1" ? "player2" : "player1";
      const player1 = game.players.find((p) => p.type === "player1");
      const player2 = game.players.find((p) => p.type === "player2");

      // Récupérer les scores ELO actuels
      const [player1Data, player2Data] = await Promise.all([
        queryAsync("SELECT score FROM users WHERE username = ?", [
          player1.username,
        ]),
        queryAsync("SELECT score FROM users WHERE username = ?", [
          player2.username,
        ]),
      ]);

      const player1Elo = player1Data[0]?.score || 1200;
      const player2Elo = player2Data[0]?.score || 1200;

      const player1Score = winner === "player1" ? 1 : 0;
      const player2Score = 1 - player1Score;

      const newPlayer1Elo = calculateNewElo(
        player1Elo,
        player2Elo,
        player1Score
      );
      const newPlayer2Elo = calculateNewElo(
        player2Elo,
        player1Elo,
        player2Score
      );

      // Démarrer une transaction
      await queryAsync("START TRANSACTION");

      try {
        // Insérer dans l'historique
        await queryAsync(
          "INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            gameId,
            player1.username,
            player2.username,
            player1Score,
            player1Elo, // ELO avant
            newPlayer1Elo, // ELO après
            "abandonGame",
          ]
        );

        // Faire la même chose pour le joueur 2
        await queryAsync(
          "INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            gameId,
            player2.username,
            player1.username,
            player2Score,
            player2Elo, // ELO avant
            newPlayer2Elo, // ELO après
            "abandonGame",
          ]
        );

        // Mettre à jour les scores
        await Promise.all([
          queryAsync("UPDATE users SET score = ? WHERE username = ?", [
            newPlayer1Elo,
            player1.username,
          ]),
          queryAsync("UPDATE users SET score = ? WHERE username = ?", [
            newPlayer2Elo,
            player2.username,
          ]),
        ]);

        // Mettre à jour games_played en se basant sur games_history
        await queryAsync(
          `
            UPDATE users u 
            SET games_played = (
                SELECT COUNT(DISTINCT game_id) 
                FROM games_history 
                WHERE player_username = u.username
            )
            WHERE username IN (?, ?)
        `,
          [player1.username, player2.username]
        );

        await queryAsync("COMMIT");

        // Dans miseATerre, après await queryAsync("COMMIT");
        await afterGameCompleted(gameId, player1.username, player2.username);

        // Envoyer les résultats
        io.to(gameId).emit("gameEnded", {
          reason: "abandon",
          winner: winner,
          message: `${
            player === "player1" ? "Joueur 1" : "Joueur 2"
          } a abandonné la partie`,
          finalScores: {
            player1: {
              username: player1.username,
              oldElo: player1Elo,
              newElo: newPlayer1Elo,
              scoreDiff: newPlayer1Elo - player1Elo,
            },
            player2: {
              username: player2.username,
              oldElo: player2Elo,
              newElo: newPlayer2Elo,
              scoreDiff: newPlayer2Elo - player2Elo,
            },
          },
        });

        // À la fin, avant de supprimer la partie
  if (games[gameId]?.moveHistory) {
    const matchData = {
      moves: games[gameId].moveHistory,
      finalState: {
        dots: games[gameId].gameState.dots,
        outlines: games[gameId].gameState.outlines,
        scoreRed: games[gameId].gameState.scoreRed,
        scoreBlue: games[gameId].gameState.scoreBlue
      }
    };
    
    await saveMatchData(gameId, matchData);
  }

        // Nettoyer la partie
        delete games[gameId];
      } catch (dbError) {
        await queryAsync("ROLLBACK");
        throw dbError;
      }
    } catch (error) {
      console.error("Erreur lors de la gestion de l'abandon:", error);
    }
  });
  // Gestionnaire pour le timeout
  socket.on("timeoutGame", async ({ gameId, loser, winner }) => {
    const game = games[gameId];
    if (!game) return;

    try {
      const player1 = game.players.find((p) => p.type === "player1");
      const player2 = game.players.find((p) => p.type === "player2");

      const [player1Data, player2Data] = await Promise.all([
        queryAsync("SELECT score FROM users WHERE username = ?", [
          player1.username,
        ]),
        queryAsync("SELECT score FROM users WHERE username = ?", [
          player2.username,
        ]),
      ]);

      const player1Elo = player1Data[0]?.score || 1200;
      const player2Elo = player2Data[0]?.score || 1200;

      const player1Score = winner === "player1" ? 1 : 0;
      const player2Score = 1 - player1Score;

      const newPlayer1Elo = calculateNewElo(
        player1Elo,
        player2Elo,
        player1Score
      );
      const newPlayer2Elo = calculateNewElo(
        player2Elo,
        player1Elo,
        player2Score
      );

      // Démarrer une transaction
      await queryAsync("START TRANSACTION");

      try {
        // Insérer dans l'historique
        await queryAsync(
          "INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            gameId,
            player1.username,
            player2.username,
            player1Score,
            player1Elo, // ELO avant
            newPlayer1Elo, // ELO après
            "timeoutGame",
          ]
        );

        // Faire la même chose pour le joueur 2
        await queryAsync(
          "INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            gameId,
            player2.username,
            player1.username,
            player2Score,
            player2Elo, // ELO avant
            newPlayer2Elo, // ELO après
            "timeoutGame",
          ]
        );

        // Mettre à jour les scores
        await Promise.all([
          queryAsync("UPDATE users SET score = ? WHERE username = ?", [
            newPlayer1Elo,
            player1.username,
          ]),
          queryAsync("UPDATE users SET score = ? WHERE username = ?", [
            newPlayer2Elo,
            player2.username,
          ]),
        ]);

        // Mettre à jour games_played en se basant sur games_history
        await queryAsync(
          `
            UPDATE users u 
            SET games_played = (
                SELECT COUNT(DISTINCT game_id) 
                FROM games_history 
                WHERE player_username = u.username
            )
            WHERE username IN (?, ?)
        `,
          [player1.username, player2.username]
        );

        await queryAsync("COMMIT");

        // Dans miseATerre, après await queryAsync("COMMIT");
        await afterGameCompleted(gameId, player1.username, player2.username);

        io.to(gameId).emit("gameEnded", {
          reason: "timeout",
          winner: winner,
          message: `Partie terminée par timeout`,
          finalScores: {
            player1: {
              username: player1.username,
              oldElo: player1Elo,
              newElo: newPlayer1Elo,
              scoreDiff: newPlayer1Elo - player1Elo,
            },
            player2: {
              username: player2.username,
              oldElo: player2Elo,
              newElo: newPlayer2Elo,
              scoreDiff: newPlayer2Elo - player2Elo,
            },
          },
        });

        // À la fin, avant de supprimer la partie
  if (games[gameId]?.moveHistory) {
    const matchData = {
      moves: games[gameId].moveHistory,
      finalState: {
        dots: games[gameId].gameState.dots,
        outlines: games[gameId].gameState.outlines,
        scoreRed: games[gameId].gameState.scoreRed,
        scoreBlue: games[gameId].gameState.scoreBlue
      }
    };
    
    await saveMatchData(gameId, matchData);
  }

        delete games[gameId];
      } catch (dbError) {
        await queryAsync("ROLLBACK");
        throw dbError;
      }
    } catch (error) {
      console.error("Erreur lors de la gestion du timeout:", error);
    }
  });

// Modifiez votre gestionnaire de déconnexion dans server.js
// Ajouter ce gestionnaire d'événement dans la section socket.io du fichier server.js
socket.on("insufficientPoints", ({ gameId, message }) => {
  const game = games[gameId];
  if (!game) return;

  // Marquer la partie comme terminée pour éviter les actions supplémentaires
  game.gameEnded = true;

  console.log(`Partie ${gameId} annulée: ${message}`);

  // Vérifier si la partie a déjà été enregistrée dans games_history (ne devrait pas être le cas)
  queryAsync("SELECT 1 FROM games_history WHERE game_id = ? LIMIT 1", [gameId])
    .then(results => {
      // Si la partie est déjà enregistrée (ce qui ne devrait pas arriver), la supprimer
      if (results.length > 0) {
        return queryAsync("DELETE FROM games_history WHERE game_id = ?", [gameId]);
      }
      return Promise.resolve();
    })
    .catch(err => {
      console.error("Erreur lors de la vérification/suppression de l'historique:", err);
    })
    .finally(() => {
      // Informer tous les joueurs et spectateurs de la partie
      io.to(gameId).emit("gameEnded", {
        reason: "insufficientPoints",
        message: message,
        gameStarted: false // Indiquer que la partie n'a pas réellement commencé
      });

      // Nettoyer la partie
      delete games[gameId];
    });
});

socket.on("disconnect", () => {
  console.log("User disconnected:", socket.id);

  const playerInfo = onlinePlayers.get(socket.id);
  if (!playerInfo) return;

  const username = playerInfo.username;

  // Notifier immédiatement les autres joueurs qu'un joueur est déconnecté
  for (const [gameId, game] of Object.entries(games)) {
    const playerIndex = game.players.findIndex((p) => p.id === socket.id);
    if (playerIndex !== -1) {
      const disconnectedPlayer = game.players[playerIndex];
      
      // Informer les autres joueurs qu'un compte à rebours a commencé
      io.to(gameId).emit("playerTemporarilyDisconnected", {
        username: username,
        reconnectionTime: 30, // Temps en secondes pour se reconnecter
        message: `${disconnectedPlayer.username} s'est déconnecté. Attente de reconnexion: 30 secondes.`
      });
    }
  }

  // Créer un timeout pour la déconnexion
  const timeout = setTimeout(async () => {
    // Vérifier si le joueur n'est pas déjà reconnecté
    const reconnected = Array.from(onlinePlayers.values()).some(
      (p) => p.username === username && p.id !== socket.id
    );

    if (!reconnected) {
      onlinePlayers.delete(socket.id);
      io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));

      // Gérer la déconnexion dans les parties
      for (const [gameId, game] of Object.entries(games)) {
        // Ne pas traiter les parties déjà terminées
        if (game.gameEnded) continue;

        // Vérifier si c'est un joueur
        const playerIndex = game.players.findIndex((p) => p.id === socket.id);
        if (playerIndex !== -1) {
          const disconnectedPlayer = game.players[playerIndex];
          
          // S'il s'agit d'une partie en cours (2 joueurs présents)
          if (game.players.length === 2) {
            // Marquer la partie comme terminée
            game.gameEnded = true;
            
            console.log(`Joueur ${disconnectedPlayer.username} définitivement déconnecté de la partie ${gameId}`);
            
            // Déterminer l'autre joueur
            const otherPlayerIndex = 1 - playerIndex; // 0 -> 1, 1 -> 0
            const otherPlayer = game.players[otherPlayerIndex];
            
            // Vérifier que les deux joueurs existent avant de continuer
            const player1 = game.players.find((p) => p.type === "player1");
            const player2 = game.players.find((p) => p.type === "player2");
            
            if (!player1 || !player2) {
              console.error("Erreur: Un ou plusieurs joueurs manquants dans la partie", gameId);
              // Si un joueur est manquant, simplement nettoyer la partie
              delete games[gameId];
              continue;
            }
            
            // Vérifier si chaque joueur a placé au moins 2 points
            const player1Dots = game.gameState.dots.filter(dot => dot.type === "player1").length;
            const player2Dots = game.gameState.dots.filter(dot => dot.type === "player2").length;
            const gameStarted = player1Dots >= 2 && player2Dots >= 2;
            
            console.log(`Points joueur 1: ${player1Dots}, Points joueur 2: ${player2Dots}`);
            console.log(`Partie considérée comme commencée: ${gameStarted}`);
            
            // Si la partie a vraiment commencé, mettre à jour les scores ELO
            if (gameStarted) {
              try {
                // Récupérer les scores ELO actuels
                const [player1Data, player2Data] = await Promise.all([
                  queryAsync("SELECT score FROM users WHERE username = ?", [player1.username]),
                  queryAsync("SELECT score FROM users WHERE username = ?", [player2.username]),
                ]);

                const player1Elo = player1Data[0]?.score || 1200;
                const player2Elo = player2Data[0]?.score || 1200;

                // Déterminer le gagnant (l'autre joueur) et le perdant (le déconnecté)
                const winner = otherPlayer.type;
                const player1Score = winner === "player1" ? 1 : 0;
                const player2Score = 1 - player1Score;

                // Calculer les nouveaux scores ELO
                const newPlayer1Elo = calculateNewElo(
                  player1Elo,
                  player2Elo,
                  player1Score
                );
                const newPlayer2Elo = calculateNewElo(
                  player2Elo,
                  player1Elo,
                  player2Score
                );

                // Mettre à jour la base de données
                await queryAsync("START TRANSACTION");

                try {
                  // Vérifier si la partie est déjà enregistrée
                  const historyExists = await queryAsync(
                    "SELECT 1 FROM games_history WHERE game_id = ? LIMIT 1",
                    [gameId]
                  );

                  if (!historyExists.length) {
                    await Promise.all([
                      // Mise à jour des scores uniquement
                      queryAsync("UPDATE users SET score = ? WHERE username = ?", [
                        newPlayer1Elo,
                        player1.username,
                      ]),
                      queryAsync("UPDATE users SET score = ? WHERE username = ?", [
                        newPlayer2Elo,
                        player2.username,
                      ]),
                      // Enregistrer l'historique pour le joueur 1
                      queryAsync(
                        "INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        [
                          gameId,
                          player1.username,
                          player2.username,
                          player1Score,
                          player1Elo,
                          newPlayer1Elo,
                          "disconnection",
                        ]
                      ),
                      // Enregistrer l'historique pour le joueur 2
                      queryAsync(
                        "INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        [
                          gameId,
                          player2.username,
                          player1.username,
                          player2Score,
                          player2Elo,
                          newPlayer2Elo,
                          "disconnection",
                        ]
                      ),
                    ]);

                    // Mettre à jour games_played
                    await queryAsync(
                      `
                        UPDATE users u 
                        SET games_played = (
                            SELECT COUNT(DISTINCT game_id) 
                            FROM games_history 
                            WHERE player_username = u.username
                        )
                        WHERE username IN (?, ?)
                      `,
                      [player1.username, player2.username]
                    );

                    await queryAsync("COMMIT");
                    
                    // Vérifier les distinctions après la partie
                    await afterGameCompleted(gameId, player1.username, player2.username);

                    // Sauvegarder les données du match si disponibles
                    if (game.moveHistory) {
                      const matchData = {
                        moves: game.moveHistory,
                        finalState: {
                          dots: game.gameState.dots,
                          outlines: game.gameState.outlines,
                          scoreRed: game.gameState.scoreRed,
                          scoreBlue: game.gameState.scoreBlue
                        }
                      };
                      
                      await saveMatchData(gameId, matchData);
                    }
                  } else {
                    await queryAsync("ROLLBACK");
                  }
                  
                  // Informer les clients de la fin de partie
                  io.to(gameId).emit("gameEnded", {
                    reason: "disconnection",
                    winner: otherPlayer.type,
                    message: `${disconnectedPlayer.username} s'est déconnecté et a perdu la partie`,
                    gameStarted: gameStarted,
                    finalScores: {
                      player1: {
                        username: player1.username,
                        oldElo: player1Elo,
                        newElo: newPlayer1Elo,
                        scoreDiff: newPlayer1Elo - player1Elo,
                      },
                      player2: {
                        username: player2.username,
                        oldElo: player2Elo,
                        newElo: newPlayer2Elo,
                        scoreDiff: newPlayer2Elo - player2Elo,
                      }
                    }
                  });
                } catch (dbError) {
                  await queryAsync("ROLLBACK");
                  console.error("ERREUR DE BASE DE DONNÉES:", dbError.message, dbError.stack);
                }
              } catch (error) {
                console.error("Erreur lors de la gestion de la déconnexion:", error);
                
                // Malgré l'erreur, informer quand même le client
                io.to(gameId).emit("gameEnded", {
                  reason: "disconnection",
                  winner: otherPlayer.type,
                  message: `${disconnectedPlayer.username} s'est déconnecté et a perdu la partie`,
                  gameStarted: false // Ne pas montrer les scores en cas d'erreur
                });
              }
            } else {
              // Si la partie n'a pas commencé, simplement informer le client
              io.to(gameId).emit("gameEnded", {
                reason: "disconnection",
                winner: otherPlayer.type,
                message: `${disconnectedPlayer.username} s'est déconnecté. La partie n'est pas comptabilisée.`,
                gameStarted: false
              });
            }
            
            // Nettoyer la partie
            delete games[gameId];
          } else {
            // Si un seul joueur, simplement supprimer la partie
            delete games[gameId];
          }
        }

        // Gestion des spectateurs - code existant
        const spectatorIndex = game.spectators.findIndex(
          (s) => s.socketId === socket.id
        );
        if (spectatorIndex !== -1) {
          game.spectators.splice(spectatorIndex, 1);

          // Notifier les autres utilisateurs
          io.to(gameId).emit("spectatorLeft", {
            spectatorCount: game.spectators.length,
            username: username,
          });
        }
      }
    }
  }, 30000); // 5 secondes de délai pour permettre la reconnexion

  userDisconnectTimeouts.set(username, timeout);
});

  // Gestion de la mise à terre
  // Modification de l'événement miseATerre pour éviter le double comptage
  socket.on("miseATerre", async ({ gameId }) => {
    if (!games[gameId]) return;
  
    const game = games[gameId];
    // Vérifier si la partie est déjà terminée
    if (game.gameEnded) return;
  
    // Marquer immédiatement la partie comme terminée pour éviter les doublons
    game.gameEnded = true;
  
    const currentPlayer = game.players.find((p) => p.id === socket.id);
    if (!currentPlayer || currentPlayer.type !== game.gameState.currentTurn) {
      game.gameEnded = false; // Réinitialiser si le joueur n'est pas valide
      return;
    }
  
    try {
      // Première étape : placer tous les nouveaux points
      const playerDots = game.gameState.dots.filter(
        (dot) => dot.type === currentPlayer.type
      );
      const opponentType =
        currentPlayer.type === "player1" ? "player2" : "player1";
      const newDots = [];
      
      // Créer un ensemble pour suivre les positions existantes (points et espaces capturés)
      const existingPositions = new Set(
        game.gameState.dots.map((dot) => `${dot.x},${dot.y}`)
      );
      
      // Ajouter les espaces vides capturés à l'ensemble des positions existantes
      if (game.gameState.capturedEmpty && Array.isArray(game.gameState.capturedEmpty)) {
        game.gameState.capturedEmpty.forEach(pos => {
          existingPositions.add(pos);
        });
      }
  
      playerDots.forEach((dot) => {
        [
          [-1, -1],
          [-1, 0],
          [-1, 1],
          [0, -1],
          [0, 1],
          [1, -1],
          [1, 0],
          [1, 1],
        ].forEach(([dx, dy]) => {
          const newX = dot.x + dx;
          const newY = dot.y + dy;
          const posKey = `${newX},${newY}`;
  
          if (
            newX >= 0 &&
            newX < 39 &&
            newY >= 0 &&
            newY < 32 &&
            !existingPositions.has(posKey) &&
            !existingPositions.has(`${newX} ${newY}`) // Vérifier aussi le format "x y"
          ) {
            newDots.push({ x: newX, y: newY, type: opponentType });
            existingPositions.add(posKey);
          }
        });
      });
  
      // Ajouter les points à l'état du jeu
      game.gameState.dots.push(...newDots);
  
      // Notifier les points
      for (const newDot of newDots) {
        io.to(gameId).emit("dotPlaced", newDot);
      }
  
      // Attendre pour les calculs
      await new Promise((resolve) => setTimeout(resolve, 100));
  
      // Deuxième étape : traiter les scores et la fin de partie
      const player1 = game.players.find((p) => p.type === "player1");
      const player2 = game.players.find((p) => p.type === "player2");
  
      // Récupérer les scores ELO actuels
      const [player1Data, player2Data] = await Promise.all([
        queryAsync("SELECT score FROM users WHERE username = ?", [
          player1.username,
        ]),
        queryAsync("SELECT score FROM users WHERE username = ?", [
          player2.username,
        ]),
      ]);
  
      const player1Elo = player1Data[0]?.score || 1200;
      const player2Elo = player2Data[0]?.score || 1200;
  
      // Déterminer le gagnant
      const player1Score =
        game.gameState.scoreRed > game.gameState.scoreBlue ? 1 : 0;
      const player2Score = 1 - player1Score;
  
      // Calculer les nouveaux scores ELO
      const newPlayer1Elo = calculateNewElo(
        player1Elo,
        player2Elo,
        player1Score
      );
      const newPlayer2Elo = calculateNewElo(
        player2Elo,
        player1Elo,
        player2Score
      );
  
      // Transaction unique pour l'enregistrement
      await queryAsync("START TRANSACTION");
  
      try {
        // Vérifier si la partie est déjà enregistrée
        const historyExists = await queryAsync(
          "SELECT 1 FROM games_history WHERE game_id = ? LIMIT 1",
          [gameId]
        );
  
        if (!historyExists.length) {
          await Promise.all([
            // Mise à jour des scores uniquement
            queryAsync("UPDATE users SET score = ? WHERE username = ?", [
              newPlayer1Elo,
              player1.username,
            ]),
            queryAsync("UPDATE users SET score = ? WHERE username = ?", [
              newPlayer2Elo,
              player2.username,
            ]),
            // Enregistrer l'historique pour le joueur 1
            queryAsync(
              "INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
              [
                gameId,
                player1.username,
                player2.username,
                player1Score,
                player1Elo,
                newPlayer1Elo,
                "miseATerre",
              ]
            ),
            // Enregistrer l'historique pour le joueur 2
            queryAsync(
              "INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
              [
                gameId,
                player2.username,
                player1.username,
                player2Score,
                player2Elo,
                newPlayer2Elo,
                "miseATerre",
              ]
            ),
          ]);
  
          // Mettre à jour games_played APRÈS en se basant sur games_history
          await queryAsync(
            `
                UPDATE users u 
                SET games_played = (
                    SELECT COUNT(DISTINCT game_id) 
                    FROM games_history 
                    WHERE player_username = u.username
                )
                WHERE username IN (?, ?)
            `,
            [player1.username, player2.username]
          );
  
          await queryAsync("COMMIT");
          // Dans miseATerre, après await queryAsync("COMMIT");
          await afterGameCompleted(gameId, player1.username, player2.username);
        } else {
          await queryAsync("ROLLBACK");
        }
  
        // Envoyer le résultat final
        io.to(gameId).emit("gameEnded", {
          reason: "miseATerre",
          winner: player1Score > player2Score ? "player1" : "player2",
          message: "Partie terminée par mise à terre",
          finalScores: {
            player1: {
              username: player1.username,
              oldElo: player1Elo,
              newElo: newPlayer1Elo,
              scoreDiff: newPlayer1Elo - player1Elo,
            },
            player2: {
              username: player2.username,
              oldElo: player2Elo,
              newElo: newPlayer2Elo,
              scoreDiff: newPlayer2Elo - player2Elo,
            },
          },
        });
  
        // À la fin, avant de supprimer la partie
        if (games[gameId]?.moveHistory) {
          const matchData = {
            moves: games[gameId].moveHistory,
            finalState: {
              dots: games[gameId].gameState.dots,
              outlines: games[gameId].gameState.outlines,
              scoreRed: games[gameId].gameState.scoreRed,
              scoreBlue: games[gameId].gameState.scoreBlue
            }
          };
          
          await saveMatchData(gameId, matchData);
        }
  
        // Nettoyer la partie
        delete games[gameId];
      } catch (dbError) {
        await queryAsync("ROLLBACK");
        throw dbError;
      }
    } catch (error) {
      console.error("Erreur lors de la mise à terre:", error);
      game.gameEnded = false;
      io.to(gameId).emit("gameError", {
        message: "Une erreur est survenue lors de la mise à terre",
      });
    }
  });

  
  socket.on("gameOver", async ({ gameId, winner, reason }) => {
    await handleGameEnd(gameId, winner, reason);

    io.to(gameId).emit("gameEnded", {
      reason: reason,
      winner: winner,
      message: `Partie terminée - ${reason}`,
    });
  });

  // Fonction de gestion de fin de partie
  // Modifier la fonction handleGameEnd
  async function handleGameEnd(gameId, winner, reason) {
    const game = games[gameId];
    if (!game || game.gameEnded) return; // Empêcher le double comptage

    try {
      // Marquer la partie comme terminée
      game.gameEnded = true;

      const player1 = game.players.find((p) => p.type === "player1");
      const player2 = game.players.find((p) => p.type === "player2");

      const [player1Data, player2Data] = await Promise.all([
        queryAsync("SELECT score FROM users WHERE username = ?", [
          player1.username,
        ]),
        queryAsync("SELECT score FROM users WHERE username = ?", [
          player2.username,
        ]),
      ]);

      const player1Elo = player1Data[0]?.score || 1200;
      const player2Elo = player2Data[0]?.score || 1200;

      // Déterminer les scores selon la raison
      let p1Score, p2Score;
      switch (reason) {
        case "miseATerre":
          p1Score = game.gameState.scoreRed > game.gameState.scoreBlue ? 1 : 0;
          p2Score = 1 - p1Score;
          break;
        case "abandon":
          p1Score = winner === "player1" ? 1 : 0;
          p2Score = 1 - p1Score;
          break;
        case "timeout":
          p1Score = winner === "player1" ? 1 : 0;
          p2Score = 1 - p1Score;
          break;
        default:
          p1Score = 0.5;
          p2Score = 0.5;
      }

      const newPlayer1Elo = calculateNewElo(player1Elo, player2Elo, p1Score);
      const newPlayer2Elo = calculateNewElo(player2Elo, player1Elo, p2Score);

      await queryAsync("START TRANSACTION");

      try {
        // Mettre à jour les scores et enregistrer l'historique
        await Promise.all([
          // Mise à jour des scores uniquement
          queryAsync("UPDATE users SET score = ? WHERE username = ?", [
            newPlayer1Elo,
            player1.username,
          ]),
          queryAsync("UPDATE users SET score = ? WHERE username = ?", [
            newPlayer2Elo,
            player2.username,
          ]),
          // Enregistrer dans l'historique
          queryAsync(
            "INSERT INTO games_history (game_id, player_username, opponent_username, result, end_reason) VALUES (?, ?, ?, ?, ?)",
            [gameId, player1.username, player2.username, p1Score, reason]
          ),
        ]);

        // Mettre à jour games_played en comptant à la fois comme joueur et comme adversaire
        await queryAsync(
          `
            UPDATE users u 
            SET games_played = (
                SELECT COUNT(DISTINCT game_id) 
                FROM games_history 
                WHERE player_username = u.username
            )
            WHERE username IN (?, ?)
        `,
          [player1.username, player2.username]
        );

        await queryAsync("COMMIT");
        // Dans miseATerre, après await queryAsync("COMMIT");
        await afterGameCompleted(gameId, player1.username, player2.username);

        // Nettoyer la partie
        delete games[gameId];

        // Ajouter l'appel à la vérification des distinctions
        if (player1 && player2) {
          await afterGameCompleted(gameId, player1.username, player2.username);
        }

        return {
          player1: { oldElo: player1Elo, newElo: newPlayer1Elo },
          player2: { oldElo: player2Elo, newElo: newPlayer2Elo },
        };
      } catch (dbError) {
        await queryAsync("ROLLBACK");
        throw dbError;
      }
    } catch (error) {
      console.error("Erreur lors de la fin de partie:", error);
      throw error;
    }
  }
  // Fonction pour gérer la reconnexion
  function handleDisconnect() {
    db.on("error", function (err) {
      console.log("db error", err);
      if (err.code === "PROTOCOL_CONNECTION_LOST") {
        handleDisconnect();
      } else {
        throw err;
      }
    });
  }

  handleDisconnect();

  // Fonction pour vérifier/rétablir la connexion avant chaque requête
  function ensureConnection() {
    return new Promise((resolve, reject) => {
      if (db.state === "disconnected") {
        db.connect(function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  // Gestion des demandes de match
  socket.on("requestMatch", async (data) => {
    if (!socket.request.session?.username) {
      socket.emit('matchRequestError', { message: "Vous n'êtes pas connecté" });
      return;
    }

  
    const fromPlayer = socket.request.session.username;
    const toPlayer = data.toPlayer;

     // Vérifier que les noms d'utilisateurs sont valides
     if (!fromPlayer || !toPlayer) {
      socket.emit('matchRequestError', { message: "Information de joueur invalide" });
      return;
    }
    
    console.log(`Demande de match: ${fromPlayer} → ${toPlayer}`);

  
    let toPlayerSocketId = null;
    for (const [socketId, player] of onlinePlayers.entries()) {
      if (player.username === toPlayer) {
        toPlayerSocketId = socketId;
        break;
      }
    }
  
    if (toPlayerSocketId) {
      
      // Récupérer les statistiques du joueur qui fait la demande
      try {
        const playerStats = await queryAsync(
          "SELECT score, games_played FROM users WHERE username = ?",
          [fromPlayer]
        );
        
        // Calculer le taux de victoire
        const matchHistory = await queryAsync(
          "SELECT result FROM games_history WHERE player_username = ? LIMIT 100",
          [fromPlayer]
        );
        
        const totalGames = playerStats[0].games_played;
        let wins = 0;
        
        if (matchHistory.length > 0) {
          wins = matchHistory.filter(match => match.result === 1).length;
        }
        
        const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
        
        // Stocker la demande avec les statistiques
        matchRequests.set(toPlayerSocketId, {
          from: fromPlayer,
          fromSocketId: socket.id,
          stats: {
            elo: playerStats[0].score,
            winRate: winRate
          }
        });
  
        // Envoyer la demande avec les statistiques
        io.to(toPlayerSocketId).emit("matchRequest", {
          fromPlayer: fromPlayer,
          stats: {
            elo: playerStats[0].score,
            winRate: winRate
          }
        });
        
      } catch (error) {
        console.error("Erreur lors de la récupération des statistiques pour la demande de match:", error);
        
        // En cas d'erreur, envoyer une demande simplifiée
        matchRequests.set(toPlayerSocketId, {
          from: fromPlayer,
          fromSocketId: socket.id
        });
        
        io.to(toPlayerSocketId).emit("matchRequest", {
          fromPlayer: fromPlayer
        });
      }
    }
  });

  // Gestion de l'acceptation du match
  socket.on("acceptMatch", () => {
    const request = matchRequests.get(socket.id);
    if (!request) return;

    const gameId = Math.random().toString(36).substring(2, 8);
    console.log(`Nouvelle partie créée: ${gameId}`);

    games[gameId] = {
      players: [],
      spectators: [], // Nouveau tableau pour les spectateurs
      gameState: {
        dots: [],
        scoreRed: 0,
        scoreBlue: 0,
        currentTurn: "player1",
        player1Name: null,
        player2Name: null,
        outlines: [],
        capturedEmpty: [],
        timers: {
          player1Time: 240,
          player2Time: 240,
          commonReflectionTime: 30,
          isReflectionPhase: true,
        },
        isPublic: true, // Par défaut, les parties sont publiques
      },
    };

    io.to(request.fromSocketId).emit("matchAccepted", gameId);
    io.to(socket.id).emit("matchAccepted", gameId);
    matchRequests.delete(socket.id);
  });

  // Gestion du refus du match
  socket.on("declineMatch", () => {
    const request = matchRequests.get(socket.id);
    if (!request) return;

    io.to(request.fromSocketId).emit(
      "matchDeclined",
      socket.request.session.username
    );
    matchRequests.delete(socket.id);
  });

  // Gestion de l'entrée dans une partie
  socket.on("joinGame", (gameId) => {
    console.log(`Tentative de rejoindre la partie ${gameId}`);

    if (!socket.request.session?.loggedin) {
      socket.emit("notAuthenticated");
      return;
    }

    if (!games[gameId]) {
      games[gameId] = {
        players: [],
        spectators: [], // Ajoutez cette ligne pour initialiser le tableau des spectateurs
        gameState: {
          dots: [],
          scoreRed: 0,
          scoreBlue: 0,
          currentTurn: "player1",
          player1Name: null,
          player2Name: null,
          outlines: [],
          capturedEmpty: [],
          timers: {
            player1Time: 240,
            player2Time: 240,
            commonReflectionTime: 30,
            isReflectionPhase: true,
          },
        },
      };
    }

    const existingPlayer = games[gameId].players.find(
      (p) => p.username === socket.request.session.username
    );

    if (existingPlayer) {
      existingPlayer.id = socket.id;
      socket.join(gameId);

      // Préparer l'état du jeu avec les outlines formatées
      const formattedGameState = {
        ...games[gameId].gameState,
        dots: games[gameId].gameState.dots.map((dot) => ({
          x: dot.x,
          y: dot.y,
          type: dot.type,
          captured: dot.captured,
        })),
        outlines: games[gameId].gameState.outlines.map((outline) =>
          outline.map((point) => ({
            x: point.x,
            y: point.y,
            type: point.type === "red" ? "red" : "blue",
            c: point.type === "red" ? "#ed2939" : "#4267B2",
          }))
        ),
      };

      // Assurez-vous que l'état complet du jeu est envoyé, y compris les timers actuels
      socket.emit("gameJoined", {
        playerType: existingPlayer.type,
        gameState: {
          ...games[gameId].gameState,
          // Envoyez explicitement l'état actuel des timers
          timers: {
            player1Time: games[gameId].gameState.timers.player1Time,
            player2Time: games[gameId].gameState.timers.player2Time,
            commonReflectionTime:
              games[gameId].gameState.timers.commonReflectionTime,
            isReflectionPhase: games[gameId].gameState.timers.isReflectionPhase,
          },
        },
        gameId: gameId,
      });
      return;
    }

    if (games[gameId].players.length >= 2) {
      socket.emit("gameFull");
      return;
    }

    const playerType =
      games[gameId].players.length === 0 ? "player1" : "player2";
    const username = socket.request.session.username;

    if (playerType === "player1") {
      games[gameId].gameState.player1Name = username;
    } else {
      games[gameId].gameState.player2Name = username;
    }

    games[gameId].players.push({
      id: socket.id,
      type: playerType,
      username: username,
    });

    // Mettre à jour le statut en partie
    if (onlinePlayers.has(socket.id)) {
      const player = onlinePlayers.get(socket.id);
      player.inGame = true;
      onlinePlayers.set(socket.id, player);
      io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
    }

    socket.join(gameId);

    // Préparer l'état du jeu formaté pour le nouveau joueur
    const formattedGameState = {
      ...games[gameId].gameState,
      dots: games[gameId].gameState.dots.map((dot) => ({
        x: dot.x,
        y: dot.y,
        type: dot.type,
        captured: dot.captured,
      })),
      outlines: games[gameId].gameState.outlines.map((outline) =>
        outline.map((point) => ({
          x: point.x,
          y: point.y,
          type: point.type === "red" ? "red" : "blue",
          c: point.type === "red" ? "#ed2939" : "#4267B2",
        }))
      ),
    };

    socket.emit("gameJoined", {
      playerType,
      gameState: formattedGameState,
      gameId: gameId,
    });

    if (games[gameId].players.length === 2) {
      io.to(gameId).emit("gameStart", formattedGameState);
    }
  });

  // Gestion du placement des points
  socket.on("placeDot", ({ gameId, x, y, type }) => {
    if (!games[gameId] || games[gameId].gameState.currentTurn !== type) return;

    const newDot = { x, y, type };
    const game = games[gameId];
    game.gameState.dots.push(newDot);
    game.gameState.currentTurn = type === "player1" ? "player2" : "player1";

    // Réinitialiser le temps de réflexion à chaque tour
    game.gameState.timers.commonReflectionTime = 30;
    game.gameState.timers.isReflectionPhase = true;

    io.to(gameId).emit("dotPlaced", newDot);
    io.to(gameId).emit("turnChange", game.gameState.currentTurn);

     // Ajouter le mouvement à l'historique du match
  if (!games[gameId].moveHistory) {
    games[gameId].moveHistory = [];
  }
  
  games[gameId].moveHistory.push({
    type: type,
    x: x,
    y: y,
    timestamp: Date.now()
  });


  });

  // Gestion de la mise à jour des scores
  socket.on(
    "updateScore",
    ({
      gameId,
      scoreRed,
      scoreBlue,
      dots,
      outlines,
      capturedEmpty,
      timers,
    }) => {
      if (!games[gameId]) return;

      // Mettre à jour les scores et l'état du jeu
      const game = games[gameId];
      game.gameState.scoreRed = scoreRed;
      game.gameState.scoreBlue = scoreBlue;

      // Mettre à jour l'état complet du jeu si fourni
      if (dots) {
        game.gameState.dots = dots.map((dot) => ({
          x: dot.x,
          y: dot.y,
          type: dot.type,
          captured: dot.captured,
        }));
      }

      if (outlines) {
        game.gameState.outlines = outlines.map((outline) =>
          outline.map((point) => ({
            x: point.x,
            y: point.y,
            type: point.type === "red" ? "red" : "blue",
            c: point.type === "red" ? "#ed2939" : "#4267B2",
          }))
        );
      }

      if (capturedEmpty) {
        game.gameState.capturedEmpty = capturedEmpty;
      }

      if (timers) {
        game.gameState.timers = {
          player1Time: timers.player1Time,
          player2Time: timers.player2Time,
          commonReflectionTime: timers.commonReflectionTime,
          isReflectionPhase: timers.isReflectionPhase,
        };
      }

      // Créer un état formaté pour l'émission
      const formattedGameState = {
        ...game.gameState,
        dots: game.gameState.dots,
        outlines: game.gameState.outlines,
        capturedEmpty: game.gameState.capturedEmpty,
        timers: game.gameState.timers,
        scoreRed: game.gameState.scoreRed,
        scoreBlue: game.gameState.scoreBlue,
      };

      // Émettre l'état complet mis à jour
      io.to(gameId).emit("scoreUpdated", formattedGameState);

      // Gestion de la base de données pour les scores des joueurs
    }
  );

  // Ajouter un gestionnaire pour la mise à jour de l'état des timers
  socket.on("updateTimers", ({ gameId, timers }) => {
    if (games[gameId]) {
      games[gameId].gameState.timers = {
        player1Time: timers.player1Time,
        player2Time: timers.player2Time,
        commonReflectionTime: timers.commonReflectionTime,
        isReflectionPhase: timers.isReflectionPhase,
      };

      // Émettre la mise à jour à tous les joueurs de la partie
      io.to(gameId).emit("timerUpdate", games[gameId].gameState.timers);
    }
  });
  // Gestion de la déconnexion
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    const playerInfo = onlinePlayers.get(socket.id);
    if (!playerInfo) return;

    const username = playerInfo.username;

    // Créer un timeout pour la déconnexion
    const timeout = setTimeout(() => {
      // Vérifier si le joueur n'est pas déjà reconnecté
      const reconnected = Array.from(onlinePlayers.values()).some(
        (p) => p.username === username && p.id !== socket.id
      );

      if (!reconnected) {
        onlinePlayers.delete(socket.id);
        io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));

        // Gérer la déconnexion dans les parties
        for (const [gameId, game] of Object.entries(games)) {
          // Vérifier si c'est un joueur
          const playerIndex = game.players.findIndex((p) => p.id === socket.id);
          if (playerIndex !== -1) {
            game.players.splice(playerIndex, 1);
            if (game.players.length === 1) {
              io.to(gameId).emit("playerDisconnected");
            } else if (game.players.length === 0) {
              delete games[gameId];
            }
          }

          // Vérifier si c'est un spectateur
          const spectatorIndex = game.spectators.findIndex(
            (s) => s.socketId === socket.id
          );
          if (spectatorIndex !== -1) {
            game.spectators.splice(spectatorIndex, 1);

            // Notifier les autres utilisateurs
            io.to(gameId).emit("spectatorLeft", {
              spectatorCount: game.spectators.length,
              username: username,
            });
          }
        }
      }
    }, 30000); // 5 secondes de délai

    userDisconnectTimeouts.set(username, timeout);
  });

  // Gestion de la tentative de reconnexion
  socket.on("reconnect_attempt", () => {
    const username = socket.request.session?.username;
    if (username && userDisconnectTimeouts.has(username)) {
      clearTimeout(userDisconnectTimeouts.get(username));
      userDisconnectTimeouts.delete(username);
    }
  });

  // Nettoyage lors de la déconnexion explicite
  socket.on("logout", () => {
    const playerInfo = onlinePlayers.get(socket.id);
    if (playerInfo) {
      const username = playerInfo.username;
      if (userDisconnectTimeouts.has(username)) {
        clearTimeout(userDisconnectTimeouts.get(username));
        userDisconnectTimeouts.delete(username);
      }
      onlinePlayers.delete(socket.id);
      io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
    }
  });
});

// Lancer le serveur
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
