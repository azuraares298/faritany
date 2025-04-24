// Variables globales
let player1HasPlayed = false;
let player2HasPlayed = false;
let initialized = false;
let isReplayMode = true; // Mode replay activé
let lastGameState = null;

const MAX_X = 39;
const MAX_Y = 32;
let Scale = Math.min(
  (window.innerWidth - 20) / MAX_X,
  window.innerHeight / MAX_Y
);
let WIDTH = Scale * (MAX_X - 1);
let HEIGHT = Scale * (MAX_Y - 1);
let DOTSIZE = Scale / 1.8;
let LINEWEIGHT = DOTSIZE / 8;

// Variables du jeu/replay
let svgElement;
let render = [];
let outlines = [];
let shapes = [];
let reddots = [];
let bluedots = [];
let scoreRed = 0;
let scoreBlue = 0;
let capturedEmpty = [];
let currentTurn;
let myPlayerType;
let PF;

// Variables spécifiques au replay
let matchData = null;
let totalMoves = 0;
let currentMoveIndex = 0;
let isPlaying = false;
let playInterval = null;
let playSpeed = 1000; // 1 seconde par défaut

console.log("Initializing replay mode");
console.log(
  `Grid: ${MAX_X}x${MAX_Y}, Canvas: ${WIDTH}x${HEIGHT}, Scale: ${Scale}`
);

// Classe Dot pour représenter un point
class Dot {
  constructor(type, x, y) {
    this.x = x;
    this.y = y;
    this.isUnit = false;
    this.captured = false;
    this.status = 0;
    if (type == 1 || type == "player1" || type == "red") {
      this.type = "red";
      this.c = "#ed2939";
    } else {
      this.type = "blue";
      this.c = "#4267B2";
    }
  }

  neighbors() {
    let n = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        try {
          if (reddots[this.x + i][this.y + j])
            n.push(reddots[this.x + i][this.y + j]);
          if (bluedots[this.x + i][this.y + j])
            n.push(bluedots[this.x + i][this.y + j]);
        } catch (err) {}
      }
    }
    return n;
  }
}

// Fonction pour charger les avatars des joueurs
function loadPlayerAvatars(player1Name, player2Name) {
  // Si les noms des joueurs ne sont pas définis, ne rien faire
  if (!player1Name || !player2Name) return;
  
  // Extraire les initiales pour l'affichage par défaut
  const player1Initial = player1Name.charAt(0).toUpperCase();
  const player2Initial = player2Name.charAt(0).toUpperCase();
  
  // Mettre à jour les éléments d'initiales
  document.getElementById('player1Initial').textContent = player1Initial;
  document.getElementById('player2Initial').textContent = player2Initial;
  
  // Fonction pour charger un avatar
  function loadAvatar(username, playerNumber) {
    fetch(`/api/profile-photo/${username}`)
      .then(response => {
        if (response.ok) return response.blob();
        throw new Error('No photo');
      })
      .then(blob => {
        // Mettre à jour l'image de l'avatar
        const imgElement = document.getElementById(`player${playerNumber}Image`);
        imgElement.src = URL.createObjectURL(blob);
        imgElement.style.display = 'block';
        
        // Cacher l'élément d'initiale
        document.getElementById(`player${playerNumber}Initial`).style.display = 'none';
      })
      .catch(error => {
        // En cas d'erreur, s'assurer que l'initiale est affichée
        document.getElementById(`player${playerNumber}Initial`).style.display = 'flex';
        document.getElementById(`player${playerNumber}Image`).style.display = 'none';
      });
  }
  
  // Charger les avatars des deux joueurs
  loadAvatar(player1Name, 1);
  loadAvatar(player2Name, 2);
}

// Fonction pour mettre à jour les avatars des joueurs
function updatePlayerAvatars(player1Name, player2Name) {
  // Mettre à jour les noms des joueurs
  document.getElementById('player1Name').textContent = player1Name || 'Joueur 1';
  document.getElementById('player2Name').textContent = player2Name || 'Joueur 2';
  
  // Charger les avatars avec les photos si disponibles
  loadPlayerAvatars(player1Name, player2Name);
}

// Fonctions de configuration et rendu
function setup() {
  svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgElement.setAttribute("width", WIDTH);
  svgElement.setAttribute("height", HEIGHT);
  svgElement.style.backgroundColor = "white";
  document.getElementById("gameSVG").appendChild(svgElement);

  RED = "#ed2939";
  BLUE = "#4267B2";
  CYAN = "#cccccc";
  LIGHT_RED = "rgba(255, 112, 112, 0.3)";
  LIGHT_BLUE = "rgba(22, 96, 255, 0.3)";

  reddots = matrixArray(MAX_X, MAX_Y);
  bluedots = matrixArray(MAX_X, MAX_Y);
  
  // En mode replay, charger les données du match
  loadMatchData();
  
  // Initialiser les contrôles de replay
  initReplayControls();
}

function draw() {
  svgElement.innerHTML = "";
  field(); // Dessiner d'abord la grille
  drawShapesAndLines(); // Ensuite les outlines/contours
  for (let d of render) {
    DotDisplay(d); // Et enfin les points
  }
}

function DotDisplay(a) {
  const dotGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");

  // Point principal
  const circle = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle"
  );
  circle.setAttribute("cx", a.x * Scale);
  circle.setAttribute("cy", a.y * Scale);
  circle.setAttribute("r", DOTSIZE / 2);
  circle.setAttribute("fill", a.c);
  dotGroup.appendChild(circle);

  svgElement.appendChild(dotGroup);
}

function field() {
  const gridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");

  // Grille verticale
  for (let i = 0; i <= MAX_X; i++) {
    const vLine = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );
    vLine.setAttribute("x1", i * Scale);
    vLine.setAttribute("x2", i * Scale);
    vLine.setAttribute("y1", 0);
    vLine.setAttribute("y2", HEIGHT);
    vLine.setAttribute("stroke", CYAN);
    vLine.setAttribute("stroke-width", "0.5");
    gridGroup.appendChild(vLine);
  }

  // Grille horizontale
  for (let i = 0; i <= MAX_Y; i++) {
    const hLine = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );
    hLine.setAttribute("x1", 0);
    hLine.setAttribute("x2", WIDTH);
    hLine.setAttribute("y1", i * Scale);
    hLine.setAttribute("y2", i * Scale);
    hLine.setAttribute("stroke", CYAN);
    hLine.setAttribute("stroke-width", "0.5");
    gridGroup.appendChild(hLine);
  }

  svgElement.appendChild(gridGroup);
}

function drawShapesAndLines() {
  for (let outline of outlines) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let d =
      "M " +
      outline.map((p) => `${p.x * Scale} ${p.y * Scale}`).join(" L ") +
      " Z";
    path.setAttribute("d", d);
    path.setAttribute(
      "fill",
      outline[1].type === "red" ? LIGHT_RED : LIGHT_BLUE
    );
    path.setAttribute("stroke", outline[1].c);
    path.setAttribute("stroke-width", LINEWEIGHT);
    path.setAttribute("opacity", "0.9"); // Rendre les contours légèrement transparents pour voir la grille en-dessous
    svgElement.appendChild(path);
  }
}

// Initialiser les contrôles de replay
function initReplayControls() {
  // Créer l'interface de contrôle de replay
  const replayControlsHTML = `
    <div class="move-info" id="moveInfo">
      Coup 0/${totalMoves}
    </div>
    
    <div class="slider-container">
      <input type="range" min="0" max="${totalMoves}" value="0" class="move-slider" id="moveSlider">
    </div>
    
    <div class="replay-controls controls-main">
      <button id="btnFirst" onclick="goToMove(0)">⏮️</button>
      <button id="btnPrev" onclick="prevMove()">⏪</button>
      <button id="btnPlayPause" onclick="togglePlay()">▶️</button>
      <button id="btnNext" onclick="nextMove()">⏩</button>
      <button id="btnLast" onclick="goToMove(totalMoves)">⏭️</button>
    </div>
    
    <div class="replay-controls speed-controls">
      <button onclick="setPlaySpeed(2000)">0.5x</button>
      <button onclick="setPlaySpeed(1000)">1x</button>
      <button onclick="setPlaySpeed(500)">2x</button>
      <button onclick="setPlaySpeed(200)">5x</button>
    </div>
  `;
  
  // Créer un élément pour contenir les contrôles
  const controlsContainer = document.createElement('div');
  controlsContainer.className = 'replay-controls-container';
  controlsContainer.innerHTML = replayControlsHTML;
  
  // Ajouter à la page
  const gameSVGContainer = document.getElementById('gameSVG').parentNode;
  gameSVGContainer.insertBefore(controlsContainer, document.getElementById('gameSVG').nextSibling);
  
  // Ajouter le listener pour le slider
  document.getElementById('moveSlider').addEventListener('input', function() {
    const moveIndex = parseInt(this.value);
    goToMove(moveIndex);
  });
}

// Charger les données du match
async function loadMatchData() {
    try {
      // Récupérer l'ID du match depuis l'URL
      const urlParams = new URLSearchParams(window.location.search);
      const gameId = urlParams.get('id');
      
      if (!gameId) {
        showError("ID de partie manquant");
        return;
      }
      
      // Récupérer les données du match
      const response = await fetch(`/api/match/${gameId}`);
      if (!response.ok) {
        throw new Error('Match non trouvé');
      }
      
      const data = await response.json();
      console.log("Données reçues:", data);
      
      if (data.replayAvailable && data.matchData) {
        matchData = data.matchData;
        totalMoves = matchData.moves ? matchData.moves.length : 0;
        
        // Correction pour les parties terminées par mise à terre
        if (data.endReason === "miseATerre") {
          console.log("Partie terminée par mise à terre, ajustement des scores...");
          
          // Vérifier lequel des joueurs a fait la mise à terre (dernier coup)
          const lastMove = matchData.moves && matchData.moves.length > 0 
            ? matchData.moves[matchData.moves.length - 1] : null;
          
          if (lastMove) {
            // Si c'est le joueur rouge qui a fait la mise à terre
            if (lastMove.type === "player1" || lastMove.type === "red") {
              console.log("Mise à terre par le joueur rouge, score bleu à 0");
              // Mettre le score bleu à 0 dans l'état final
              if (matchData.finalState) {
                matchData.finalState.scoreBlue = 0;
              }
            } else {
              console.log("Mise à terre par le joueur bleu, score rouge à 0");
              // Sinon c'est le joueur bleu, mettre le score rouge à 0
              if (matchData.finalState) {
                matchData.finalState.scoreRed = 0;
              }
            }
          }
        }
        
        // Si le slider existe déjà, mettre à jour sa plage
        const slider = document.getElementById('moveSlider');
        if (slider) {
          slider.max = totalMoves;
          slider.value = 0;
        }
        
        // Mettre à jour les noms des joueurs
        if (data.players && data.players.length > 0) {
          const player1Name = data.players[0].username;
          const player2Name = data.players.length > 1 ? data.players[1].username : data.players[0].opponent;
          updatePlayerAvatars(player1Name, player2Name);
        }
        
        // Mettre à jour l'information du mouvement
        updateMoveInfo(0);
        
        // Initialiser l'état du jeu
        goToMove(0);
      } else {
        showError("Données de replay non disponibles pour cette partie");
      }
    } catch (error) {
      console.error('Erreur lors du chargement des données:', error);
      showError(error.message);
    }
  }
// Afficher une erreur
function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.innerHTML = `
    <h3>Erreur</h3>
    <p>${message}</p>
  `;
  
  // Ajouter au document
  const gameSVGContainer = document.getElementById('gameSVG').parentNode;
  gameSVGContainer.appendChild(errorDiv);
}

// Mettre à jour les informations du mouvement
function updateMoveInfo(moveIndex) {
  const moveInfoElement = document.getElementById('moveInfo');
  if (moveInfoElement) {
    moveInfoElement.textContent = `Coup ${moveIndex}/${totalMoves}`;
  }
}

// Navigation dans les coups
function goToMove(moveIndex, stopPlayback = true) {
  // Arrêter la lecture automatique si demandé
  if (stopPlayback && isPlaying) {
    stopPlay();
  }
  
  // Vérifier les limites
  moveIndex = Math.max(0, Math.min(moveIndex, totalMoves));
  currentMoveIndex = moveIndex;
  
  // Mettre à jour le slider
  const slider = document.getElementById('moveSlider');
  if (slider) {
    slider.value = currentMoveIndex;
  }
  
  // Réinitialiser l'état du jeu
  render = [];
  reddots = matrixArray(MAX_X, MAX_Y);
  bluedots = matrixArray(MAX_X, MAX_Y);
  outlines = [];
  capturedEmpty = [];
  scoreRed = 0;
  scoreBlue = 0;
  
  // Utiliser les scores précalculés si disponibles
  if (matchData.precalculatedScores && moveIndex < matchData.precalculatedScores.length) {
    scoreRed = matchData.precalculatedScores[moveIndex].red;
    scoreBlue = matchData.precalculatedScores[moveIndex].blue;
  }
  
  // Rejouer tous les mouvements jusqu'à l'index actuel
  if (matchData && matchData.moves) {
    for (let i = 0; i < moveIndex; i++) {
      applyMove(matchData.moves[i]);
    }
  }
  
  // Si on est à la fin, utiliser l'état final pour plus de précision
  if (moveIndex === totalMoves && matchData.finalState) {
    // Si on a un état final, l'utiliser pour plus de précision
    if (matchData.finalState.dots) {
      render = [];
      reddots = matrixArray(MAX_X, MAX_Y);
      bluedots = matrixArray(MAX_X, MAX_Y);
      
      // Recréer les points à partir de l'état final
      for (const dot of matchData.finalState.dots) {
        const newDot = new Dot(dot.type, dot.x, dot.y);
        if (dot.captured) newDot.captured = true;
        
        if (newDot.type === "red") {
          reddots[dot.x][dot.y] = newDot;
        } else {
          bluedots[dot.x][dot.y] = newDot;
        }
        render.push(newDot);
      }
    }
    
    // Recréer les outlines à partir de l'état final
    if (matchData.finalState.outlines) {
      outlines = matchData.finalState.outlines.map(outline => 
        outline.map(point => {
          const dotType = point.type === "red" || point.type === "player1" ? 1 : 2;
          const newPoint = new Dot(dotType, point.x, point.y);
          newPoint.c = point.c || (dotType === 1 ? RED : BLUE);
          return newPoint;
        })
      );
    }
    
    // Recalculer les scores à partir des points capturés
    let recountedScoreRed = 0;
    let recountedScoreBlue = 0;
    
    for (let x = 0; x < MAX_X; x++) {
      for (let y = 0; y < MAX_Y; y++) {
        if (reddots[x][y] && reddots[x][y].captured) {
          recountedScoreBlue++;
        }
        if (bluedots[x][y] && bluedots[x][y].captured) {
          recountedScoreRed++;
        }
      }
    }
    
    // Utiliser les scores recomptés
    scoreRed = recountedScoreRed;
    scoreBlue = recountedScoreBlue;
    
    // Si c'est une mise à terre, mettre le score du perdant à 0
    if (matchData.endReason === "miseATerre") {
      // Déterminer le dernier joueur qui a joué (qui a fait la mise à terre)
      const lastMove = matchData.moves[matchData.moves.length - 1];
      if (lastMove) {
        if (lastMove.type === "player1" || lastMove.type === "red") {
          // Rouge a fait la mise à terre, bleu à 0
          scoreBlue = 0;
        } else {
          // Bleu a fait la mise à terre, rouge à 0
          scoreRed = 0;
        }
      }
    }
  }
  
  // Mettre à jour l'affichage des scores
  document.getElementById("RED").innerHTML = scoreRed;
  document.getElementById("BLUE").innerHTML = scoreBlue;
  
  // Mettre à jour l'info du coup
  updateMoveInfo(moveIndex);
  
  // Mettre à jour les boutons
  updateButtonStates();
  
  // Redessiner
  draw();
}

// Appliquer un coup
function applyMove(move) {
  if (!move) return;
  
  // Créer un nouveau point
  const newDot = new Dot(move.type, move.x, move.y);
  
  // Ajouter à la liste des points rendus
  render.push(newDot);
  
  // Ajouter aux matrices appropriées
  if (newDot.type === "red") {
    reddots[move.x][move.y] = newDot;
  } else {
    bluedots[move.x][move.y] = newDot;
  }
  
  // Appliquer la logique de capture
  applyPathfinding(newDot);
}

// Aller au coup précédent
function prevMove() {
  goToMove(currentMoveIndex - 1);
}

// Aller au coup suivant
function nextMove() {
  goToMove(currentMoveIndex + 1);
}

// Démarrer/Arrêter la lecture automatique
function togglePlay() {
  if (isPlaying) {
    stopPlay();
  } else {
    startPlay();
  }
}

// Démarrer la lecture
function startPlay() {
    // Si on est à la fin, revenir au début
    if (currentMoveIndex >= totalMoves) {
      goToMove(0, false);
    }
    
    isPlaying = true;
    document.getElementById('btnPlayPause').textContent = "⏸️";
    
    // Créer un nouvel intervalle pour avancer automatiquement
    if (playInterval) clearInterval(playInterval);
    
    playInterval = setInterval(function() {
      if (currentMoveIndex < totalMoves) {
        // Incrémenter d'abord l'index
        currentMoveIndex++;
        
        // Puis aller au coup
        if (currentMoveIndex <= totalMoves) {
          // Important: appeler goToMove sans arrêter la lecture
          goToMove(currentMoveIndex, false);
        }
        
        // Si on arrive à la fin, arrêter la lecture
        if (currentMoveIndex >= totalMoves) {
          stopPlay();
        }
      } else {
        stopPlay();
      }
    }, playSpeed);
  }
// Arrêter la lecture
function stopPlay() {
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
  }
  isPlaying = false;
  document.getElementById('btnPlayPause').textContent = "▶️";
}

// Définir la vitesse de lecture
function setPlaySpeed(speed) {
  playSpeed = speed;
  if (isPlaying) {
    stopPlay();
    startPlay();
  }
}

// Mettre à jour l'état des boutons
function updateButtonStates() {
  document.getElementById('btnFirst').disabled = currentMoveIndex === 0;
  document.getElementById('btnPrev').disabled = currentMoveIndex === 0;
  document.getElementById('btnNext').disabled = currentMoveIndex >= totalMoves;
  document.getElementById('btnLast').disabled = currentMoveIndex >= totalMoves;
}

// Fonction pour revenir à la page précédente
function goBack() {
  window.history.back();
}

// Logique de capture (reprise de game.js)
function applyPathfinding(newdot) {
  let newdotNeighbors = newdot.neighbors();
  let mustSearch = [newdot, ...newdotNeighbors];

  for (let dot of mustSearch) {
    if (dot.captured) continue;
    PF = new Pathfinder(dot);
    let path = PF.SearchPath();
    if (path) {
      for (let i = 0; i < path.length; i++) {
        path[i].status = "Chained";
        path[i].outline = outlines.length;
      }
      outlines.push(path);
    }
  }

  // Mettre à jour les scores dans l'interface
  document.getElementById("RED").innerHTML = scoreRed;
  document.getElementById("BLUE").innerHTML = scoreBlue;
}

// Classe Pathfinder (reprise de game.js)
class Pathfinder {
  constructor(start) {
    this.start = start;
    this.came_from = matrixArray(MAX_X, MAX_Y);
  }

  neighbors(a) {
    let n = [];
    let otherWays = [];
    let typedots = a.type == "red" ? reddots : bluedots;
    let positions = [
      [1, -1],
      [0, -1],
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
      [1, 0],
    ];

    for (let [dx, dy] of positions) {
      try {
        let current = typedots[a.x + dx][a.y + dy];
        if (current && (!current.captured || current === this.start)) {
          n.push(current);
          if (this.came_from[current.x][current.y]) {
            otherWays.push(current);
          }
        }
      } catch (err) {}
    }
    return [n, otherWays];
  }

  SearchPath() {
    let frontiers = [this.start];
    this.came_from[this.start.x][this.start.y] = [];

    while (frontiers.length > 0) {
      let current = frontiers.shift();
      let [neighbors, otherWays] = this.neighbors(current);

      if (otherWays.length > 0) {
        for (let dot of otherWays) {
          if (this.came_from[current.x][current.y].includes(dot)) continue;

          let path = [...this.came_from[current.x][current.y], current, dot];
          let secondPart = this.came_from[dot.x][dot.y];

          if (path[1] === secondPart[1]) continue;

          path.push(...secondPart.slice(1).reverse());
          if (isAppropriate(path)) return path;
        }
      }

      for (let next of neighbors) {
        if (!otherWays.includes(next)) {
          this.came_from[next.x][next.y] = [
            ...this.came_from[current.x][current.y],
            current,
          ];
          frontiers.push(next);
        }
      }
    }
    return false;
  }
}

// Modification de isAppropriate pour le replay
function isAppropriate(path) {
  if (!path || path.length < 3) return false;

  let min = 0,
    max = 0,
    Xmin = 0,
    Xmax = 0;
  let flag = false;
  let xData = {};
  let typedots = path[0].type != "red" ? reddots : bluedots;
  let reverse_typedots = path[0].type == "red" ? reddots : bluedots;

  for (let i = 0; i < path.length; i++) {
    if (path[i].y > path[max].y) max = i;
    if (path[i].y < path[min].y) min = i;
    if (path[i].x > path[Xmax].x) Xmax = i;
    if (path[i].x < path[Xmin].x) Xmin = i;

    if (!xData[path[i].x]) {
      xData[path[i].x] = [path[i].y];
    } else {
      xData[path[i].x].push(path[i].y);
      xData[path[i].x].sort((a, b) => b - a);
    }
  }

  let temp_captured = [];

  for (let i = path[min].y; i <= path[max].y; i++) {
    let dotsX = path.filter((p) => p.y === i).sort((a, b) => a.x - b.x);

    for (let j = dotsX[0].x; j <= dotsX[dotsX.length - 1].x; j++) {
      let between_cond =
        xData[j]?.length > 1 &&
        xData[j][0] > i &&
        i > xData[j][xData[j].length - 1];

      if (!between_cond) continue;

      if (!reddots[j][i] && !bluedots[j][i]) {
        temp_captured.push(j + " " + i);
      } else if (reverse_typedots[j][i]?.captured) {
        reverse_typedots[j][i].captured = false;
        if (reverse_typedots[j][i].type == "red") scoreBlue--;
        else scoreRed--;
      } else if (typedots[j][i] && !typedots[j][i].captured) {
        typedots[j][i].captured = true;
        if (typedots[j][i].type == "red") scoreBlue++;
        else scoreRed++;
        flag = true;
      }
    }
  }

  if (flag) {
    capturedEmpty.push(...temp_captured);
  }
  return flag;
}

// Fonction utilitaire
function matrixArray(rows, cols) {
  return Array(rows)
    .fill()
    .map(() => Array(cols).fill(undefined));
}

// Boucle de jeu principale
function gameLoop() {
  draw();
  requestAnimationFrame(gameLoop);
}

// Initialisation
document.addEventListener("DOMContentLoaded", () => {
  if (!initialized) {
    initialized = true;
    console.log("Initialisation du replay...");
    setup();
    gameLoop();
  }
});

// Gestion du redimensionnement
window.addEventListener("resize", () => {
  Scale = Math.min(
    (window.innerWidth - 100) / MAX_X,
    (window.innerHeight - 300) / MAX_Y
  );
  WIDTH = Scale * (MAX_X - 1);
  HEIGHT = Scale * (MAX_Y - 1);
  DOTSIZE = Scale / 1.8;
  LINEWEIGHT = DOTSIZE / 8;

  svgElement.setAttribute("width", WIDTH);
  svgElement.setAttribute("height", HEIGHT);
});