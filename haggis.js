async function parseLogAndPopulateForm() {
  const stats = parseLog(document.getElementById("allLogs").textContent);
  const data = await serializeJson(stats);
  document.getElementById("data").value = data;
  document.getElementById("statsForm").submit();
}

async function renderStats() {
  const urlParams = new URLSearchParams(window.location.search);
  const data = urlParams.get("data");
  const tableId = urlParams.get("tableId");

  document.getElementById("bgaLink").href = "https://boardgamearena.com/table?table=" + tableId;

  if (!data) {
    document.getElementById("stats").innerHTML = "Data not found";
    return;
  }

  const stats = await deserializeJson(data);
  const html = renderStatsAsHtmlString(tableId, stats);
  document.getElementById("stats").innerHTML = html;
}

function parseLog(logLines) {
  const game = {
    players: [],
    rounds: [],
    playerStats: {},
  };

  let inLog = false;
  let currentRound = null;

  for (const line of JSON.parse(logLines)) {
    const words = line.split(/\s+/);
    const player = words[0];
    if (player === "Move" || player === "") {
      continue;
    }

    if (line.includes("starts a new round")) {
      inLog = true;
      if (!(player in game.playerStats)) {
        game.playerStats[player] = createPlayerStats();
      }
      game.playerStats[player].led += 1;
      currentRound = {
        startPlayer: player,
        bets: {},
        tens: {},
        colorBombs: {},
        rainbowBombs: {},
        startingScore: {},
        sums: {},
        points: {},
        hand: {},
      };
      game.rounds.push(currentRound);
      continue;
    }

    if (!inLog) {
      continue;
    }

    if (game.players.length < 2 && !game.players.includes(player)) {
      game.players.push(player);
      if (!(player in game.playerStats)) {
        game.playerStats[player] = createPlayerStats();
      }
    }

    const score = line.match(/scores (\d+) point/);
    if (score) {
      game.playerStats[player].score += Number(score[1]);
      currentRound.points[player] =
        (currentRound.points[player] ?? 0) + Number(score[1]);
    }

    if (words[1].includes("bets")) {
      currentRound.bets[player] = words[2];
      game.playerStats[player].bets[words[2]] =
        (game.playerStats[player].bets[words[2]] ?? 0) + 1;
      game.playerStats[player].totalBets += 1;
      continue;
    }

    if (words[1].includes("plays")) {
      const cards = words[2].split("-");

      for (const card of cards) {
        const parsedCard = parseCard(card);

        if (!parsedCard) {
          continue;
        }

        if (!currentRound.hand[player]) {
          currentRound.hand[player] = createCardMap();
        }
        currentRound.hand[player][parsedCard.suit].push(parsedCard.rank);

        const num = parsedCard.rank;
        if (num === 10) {
          currentRound.tens[player] = (currentRound.tens[player] ?? 0) + 1;
          game.playerStats[player].tens += 1;
        }

        currentRound.sums[player] = (currentRound.sums[player] ?? 0) + num;
        game.playerStats[player].sumTotal += num;
      }

      if (isBomb(words[2])) {
        if (isColorBomb(words[2])) {
          currentRound.colorBombs[player] =
            (currentRound.colorBombs[player] ?? 0) + 1;
          game.playerStats[player].colorBombs += 1;
        } else {
          currentRound.rainbowBombs[player] =
            (currentRound.rainbowBombs[player] ?? 0) + 1;
          game.playerStats[player].rainbowBombs += 1;
        }
      }

      continue;
    }

    if (line.includes("goes out")) {
      currentRound.winner = player;
      currentRound.remainingCards = Number(words[8]);
      game.playerStats[player].wins += 1;

      if (currentRound.bets[player]) {
        game.playerStats[player].successfulBets += 1;
      }
      if (player === currentRound.startPlayer) {
        game.playerStats[player].ledAndWon += 1;
      }
      continue;
    }

    if (line.includes("The end of the game")) {
      game.winner = words[5];

      for (const name of game.players) {
        game.playerStats[name].sumAvg =
          game.playerStats[name].sumTotal / game.rounds.length;
        let min = 999999;
        let max = 0;
        for (const round of game.rounds) {
          const sum = round.sums[name];
          if (sum > max) {
            max = sum;
          }
          if (sum < min) {
            min = sum;
          }
        }
        game.playerStats[name].sumMin = min;
        game.playerStats[name].sumMax = max;
      }

      for (const round of game.rounds) {
        if (round.sums[game.players[0]] < round.sums[game.players[1]]) {
          game.playerStats[game.players[1]].largerSum += 1;
        } else if (round.sums[game.players[0]] > round.sums[game.players[1]]) {
          game.playerStats[game.players[0]].largerSum += 1;
        }
      }

      break;
    }

    for (const name of game.players) {
      if (name + ":" === player) {
        for (const word of words) {
          const card = word.substring(0, word.length - 1);
          const parsedCard = parseCard(card);

          if (!parsedCard) {
            continue;
          }

          if (!currentRound.hand[name]) {
            currentRound.hand[name] = createCardMap();
          }
          currentRound.hand[name][parsedCard.suit].push(parsedCard.rank);

          const num = parsedCard.rank;
          if (num === 10) {
            currentRound.tens[name] = (currentRound.tens[name] ?? 0) + 1;
            game.playerStats[name].tens += 1;
          }

          currentRound.sums[name] = (currentRound.sums[name] ?? 0) + num;
          game.playerStats[name].sumTotal += num;
        }
      }
    }
  }
    addPointsPerRound(game);
    return game;
}

function createPlayerStats() {
  return {
    tens: 0,
    bombs: 0,
    colorBombs: 0,
    rainbowBombs: 0,
    bets: {},
    totalBets: 0,
    successfulBets: 0,
    wins: 0,
    score: 0,
    led: 0,
    ledAndWon: 0,
    sumTotal: 0,
    sumMin: 0,
    sumMax: 0,
    sumAvg: 0,
    largerSum: 0,
  };
}

function createCardMap() {
  return {
    r: [],
    y: [],
    b: [],
    p: [],
  }
}

function renderStatsAsHtmlString(tableId, stats) {
  const player1 = stats.players[0];
  const player2 = stats.players[1];
  const player1Stats = stats.playerStats[player1];
  const player2Stats = stats.playerStats[player2];

  let output = `<div>\n<h2>Game ${tableId}</h2>\n`;
  output += "<table>\n";
  output += "  <tr>\n";
  output += "    <td>Winner</td>\n";
  output += `    <td>${stats.winner}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Rounds</td>\n";
  output += `    <td>${stats.rounds.length}</td>\n`;
  output += "  </tr>\n";
  output += "</table>\n";

  output += "<table class='shaded'>\n";
  output += "  <tr>\n";
  output += `    <th></th>\n`;
  output += `    <th>${player1}</th>\n`;
  output += `    <th>${player2}</th>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Score</td>\n";
  output += `    <td>${player1Stats.score}</td>\n`;
  output += `    <td>${player2Stats.score}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Bets (w/t)</td>\n";
  output += `    <td>${player1Stats.successfulBets}/${player1Stats.totalBets}</td>\n`;
  output += `    <td>${player2Stats.successfulBets}/${player2Stats.totalBets}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>5 Bets</td>\n";
  output += `    <td>${player1Stats.bets["5"] ?? 0}</td>\n`;
  output += `    <td>${player2Stats.bets["5"] ?? 0}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>15 Bets</td>\n";
  output += `    <td>${player1Stats.bets["15"] ?? 0}</td>\n`;
  output += `    <td>${player2Stats.bets["15"] ?? 0}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>30 Bets</td>\n";
  output += `    <td>${player1Stats.bets["30"] ?? 0}</td>\n`;
  output += `    <td>${player2Stats.bets["30"] ?? 0}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Out First</td>\n";
  output += `    <td>${player1Stats.wins}</td>\n`;
  output += `    <td>${player2Stats.wins}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Started</td>\n";
  output += `    <td>${player1Stats.led}</td>\n`;
  output += `    <td>${player2Stats.led}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Started & Out First</td>\n";
  output += `    <td>${player1Stats.ledAndWon}</td>\n`;
  output += `    <td>${player2Stats.ledAndWon}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>10s</td>\n";
  output += `    <td>${player1Stats.tens}</td>\n`;
  output += `    <td>${player2Stats.tens}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Color Bombs</td>\n";
  output += `    <td>${player1Stats.colorBombs}</td>\n`;
  output += `    <td>${player2Stats.colorBombs}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Rainbow Bombs</td>\n";
  output += `    <td>${player1Stats.rainbowBombs}</td>\n`;
  output += `    <td>${player2Stats.rainbowBombs}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Card Sum</td>\n";
  output += `    <td>${player1Stats.sumTotal}</td>\n`;
  output += `    <td>${player2Stats.sumTotal}</td>\n`;
  output += "  </tr>\n";
  output += "    <td>Rounds with > Sum</td>\n";
  output += `    <td>${player1Stats.largerSum}</td>\n`;
  output += `    <td>${player2Stats.largerSum}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "  <tr>\n";
  output += "    <td>Card Sum Avg</td>\n";
  output += `    <td>${player1Stats.sumAvg.toFixed(2)}</td>\n`;
  output += `    <td>${player2Stats.sumAvg.toFixed(2)}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Card Sum Min</td>\n";
  output += `    <td>${player1Stats.sumMin}</td>\n`;
  output += `    <td>${player2Stats.sumMin}</td>\n`;
  output += "  </tr>\n";
  output += "  <tr>\n";
  output += "    <td>Card Sum Max</td>\n";
  output += `    <td>${player1Stats.sumMax}</td>\n`;
  output += `    <td>${player2Stats.sumMax}</td>\n`;
  output += "  </tr>\n";
  output += "</table>\n</div>\n";

  output += "<div>\n<h3>Rounds</h3>\n";

  for (const i in stats.rounds) {
    const round = stats.rounds[i];
    
    output += `<h4>Round ${Number(i) + 1}</h4>\n`;
    output += "<table>\n";
    output += "  <tr>\n";
    output += "    <td>Started</td>\n";
    output += `    <td>${round.startPlayer}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Out First</td>\n";
    output += `    <td>${round.winner}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Remaining Cards</td>\n";
    output += `    <td>${round.remainingCards}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Card Sum Diff</td>\n";
    output += `    <td>${Math.abs(
      round.sums[player1] - round.sums[player2]
    )}</td>\n`;
    output += "  </tr>\n";
    output += "</table>\n";

    output += "<table class='shaded'>\n";
    output += "  <thead>\n";
    output += `    <th></th>\n`;
    output += `    <th>${player1}</th>\n`;
    output += `    <th>${player2}</th>\n`;
    output += "  </thead>\n";
    output += "  <tr>\n";
    output += "    <td>Starting Score</td>\n";
    output += `    <td>${round.startingScore[player1] ?? 0}</td>\n`;
    output += `    <td>${round.startingScore[player2] ?? 0}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Points Gained</td>\n";
    output += `    <td>${round.points[player1] ?? 0}</td>\n`;
    output += `    <td>${round.points[player2] ?? 0}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Bets</td>\n";
    output += `    <td>${round.bets[player1] ?? "NA"}</td>\n`;
    output += `    <td>${round.bets[player2] ?? "NA"}</td>\n`;
    output += "  <tr>\n";
    output += "    <td>10s</td>\n";
    output += `    <td>${round.tens[player1] ?? 0}</td>\n`;
    output += `    <td>${round.tens[player2] ?? 0}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Rainbow Bombs</td>\n";
    output += `    <td>${round.rainbowBombs[player1] ?? 0}</td>\n`;
    output += `    <td>${round.rainbowBombs[player2] ?? 0}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Color Bombs</td>\n";
    output += `    <td>${round.colorBombs[player1] ?? 0}</td>\n`;
    output += `    <td>${round.colorBombs[player2] ?? 0}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Card Sum</td>\n";
    output += `    <td>${round.sums[player1] ?? 0}</td>\n`;
    output += `    <td>${round.sums[player2] ?? 0}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Blue</td>\n";
    output += `    <td>${round.hand[player1].b.sort(sortNumeric).join(', ')}</td>\n`;
    output += `    <td>${round.hand[player2].b.sort(sortNumeric).join(', ')}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Purple</td>\n";
    output += `    <td>${round.hand[player1].p.sort(sortNumeric).join(', ')}</td>\n`;
    output += `    <td>${round.hand[player2].p.sort(sortNumeric).join(', ')}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Red</td>\n";
    output += `    <td>${round.hand[player1].r.sort(sortNumeric).join(', ')}</td>\n`;
    output += `    <td>${round.hand[player2].r.sort(sortNumeric).join(', ')}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Yellow</td>\n";
    output += `    <td>${round.hand[player1].y.sort(sortNumeric).join(', ')}</td>\n`;
    output += `    <td>${round.hand[player2].y.sort(sortNumeric).join(', ')}</td>\n`;
    output += "  </tr>\n";
    output += "</table>\n";
  }

  output += "</div>\n";

  return output;
}

async function serializeJson(json) {
  const stream = new Blob([JSON.stringify(json)], {
    type: "application/json",
  }).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
  const response = await new Response(compressedStream);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const encoded = window.btoa(String.fromCharCode(...new Uint8Array(buffer)));
  return encoded.replaceAll("+", ".").replaceAll("/", "_").replaceAll("=", "-");
}

async function deserializeJson(data) {
  const dataRestored = data
    .replaceAll(".", "+")
    .replaceAll("_", "/")
    .replaceAll("-", "=");
  const stream = new Blob([b64decode(dataRestored)], {
    type: "application/json",
  }).stream();
  const compressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
  const response = await new Response(compressedStream);
  const blob = await response.blob();
  return JSON.parse(await blob.text());
}

function b64decode(str) {
  const binary_string = window.atob(str);
  const len = binary_string.length;
  const bytes = new Uint8Array(new ArrayBuffer(len));
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

function extractGameData(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  const lines = [];

  for (const el of doc.querySelectorAll('.gamelogreview')) {
    const innerHtml = el.innerHTML;
    if (innerHtml.includes("<br")) {
      convertBr2nl(innerHtml).split("\n").forEach(l => lines.push(l));
    } else {
      lines.push(el.textContent);
    }
  }

  return lines;
}

function addColorData(doc) {
  const coloredElements = doc.querySelectorAll('[style*="color"]');

  const colorPrefixMap = {
    "rgb(224, 158, 29)": "y", // yellow
    "rgb(140, 132, 191)": "p", // purple
    "rgb(1, 87, 169)": "b", // blue
    "rgb(215, 51, 79)": "r", // red
  };

  coloredElements.forEach((el) => {
    const color = el.style.color;
    if (colorPrefixMap[color]) {
      const prefix = colorPrefixMap[color];
      el.textContent = prefix + el.textContent;
    }
  });

  return doc;
}

function parseCard(text) {
  if (/^[rbpy]\d+/.test(text)) {
    return {
      suit: text.charAt(0),
      rank: Number(text.slice(1))
    }
  }
  return null;
}

function isColorBomb(inputString) {
  const regex = /^(?:([rpyb])3)-\1?5-\1?7-\1?9$/;
  return regex.test(inputString);
}

function isBomb(inputString) {
  const regex = /^(?:[rpyb]?3)-(?:[rpyb]?5)-(?:[rpyb]?7)-(?:[rpyb]?9)$/;
  return regex.test(inputString);
}

document.addEventListener("paste", async function (event) {
  const clipboardData = event.clipboardData || window.clipboardData;
  const htmlData = clipboardData.getData("text/html");

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlData, "text/html");

  const tableId = extractTableId(doc);
  document.getElementById("tableId").value = tableId;

  const withColor = addColorData(doc);
  
  const serializer = new XMLSerializer();
  const serializedLogs = serializer.serializeToString(withColor);

  const logData = extractGameData(serializedLogs);

  const textArea = document.getElementById("allLogs");
  textArea.textContent = JSON.stringify(logData);
});

function convertBr2nl(innerHtml) {
  const parser = new DOMParser();
  const modified = "<div>" + innerHtml.replaceAll("&nbsp;", " ").replaceAll(/<br[^<>]*?>/g, "||BR||") + "</div>";
  const newDoc = parser.parseFromString(modified, "text/xml");
  return newDoc.firstElementChild.textContent.replaceAll("||BR||", "\n");
}

function extractTableId(doc) {
  return RegExp(/Replay Haggis #(\d+)/).exec(doc.getElementById("reviewtitle").textContent)[1];
}

function sortNumeric(a, b) {
  return a - b;
}

function addPointsPerRound(game) {
    const ptsPerRound = getTotalPointsAfterEachRound(game.rounds);
    
    for (let i = 0; i < game.rounds.length - 1; i++) {
        const nextRound = game.rounds[i + 1];
        const player1 = game.players[0];
        const player2 = game.players[1];

        nextRound.startingScore = {
            [player1]: ptsPerRound[i].points[player1],
            [player2]: ptsPerRound[i].points[player2]
        };
    }
}

function getTotalPointsAfterEachRound(rounds) {
    const totalPoints = {};

    return rounds.map(round => {
        Object.entries(round.points).forEach(([player, points]) => {
            totalPoints[player] = (totalPoints[player] || 0) + points;
        });

        return { points: { ...totalPoints } };
    });
}
