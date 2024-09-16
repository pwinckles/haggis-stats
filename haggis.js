const parseLogAndPopulateFormSync = async() => {
    await parseLogAndPopulateForm();
};

async function parseLogAndPopulateForm() {
    const stats = parseLog(document.getElementById('logText').value);
    const data = await serializeJson(stats);
    document.getElementById('data').value = data;
}

async function renderStats() {
    const urlParams = new URLSearchParams(window.location.search);
    const data = urlParams.get('data');

    if (!data) {
        document.getElementById("stats").innerHTML = 'Data not found';
        return;
    }

    const stats = await deserializeJson(data);
    const html = renderStatsAsHtmlString(stats);
    document.getElementById("stats").innerHTML = html;
}

function parseLog(text) {
    const lines = text.split('\n');
    const game = {
        players: [],
        rounds: [],
        playerStats: {},
    };

    let inLog = false;
    let currentRound = null;

    for (const line of lines) {
        const words = line.split(' ');
        const player = words[0];

        if (player === 'Move' || player === '') {
            continue;
        }

        if (line.includes('starts a new round')) {
            inLog = true;
            if (!(player in game.playerStats)) {
                game.playerStats[player] = createPlayerStats();
            }
            game.playerStats[player].led += 1;
            currentRound = {
                startPlayer: player,
                bets: {},
                tens: {},
                bombs: {},
                sums: {},
                haggisTens: 0,
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
        }

        if (words[1] === 'bets') {
            currentRound.bets[player] = words[2];
            game.playerStats[player].bets[words[2]] = (game.playerStats[player].bets[words[2]] ?? 0) + 1;
            game.playerStats[player].totalBets += 1;
            continue;
        }

        if (words[1] === 'plays') {
            const cards = words[2].split('-');

            for (const card of cards) {
                if (isNaN(card)) {
                    continue;
                }

                const num = Number(card);
                if (num === 10) {
                    currentRound.tens[player] = (currentRound.tens[player] ?? 0) + 1;
                    game.playerStats[player].tens += 1;
                }

                currentRound.sums[player] = (currentRound.sums[player] ?? 0) + num;
                game.playerStats[player].sumTotal += num;
            }

            if (words[2] === '3-5-7-9') {
                currentRound.bombs[player] = (currentRound.bombs[player] ?? 0) + 1;
                game.playerStats[player].bombs += 1;
            }

            continue;
        }

        if (line.includes('goes out')) {
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

        if (player === 'Haggis:') {
            const tenCount = [...line.matchAll(/10/g)].length;
            currentRound.haggisTens += tenCount;
            continue;
        }

        if (line.includes('The end of the game')) {
            game.winner = words[5];

            for (const name of game.players) {
                game.playerStats[name].sumAvg = game.playerStats[name].sumTotal / game.rounds.length;
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

            break;
        }

        for (const name of game.players) {
            if (name + ':' === player) {
                for (const card of words) {
                    if (isNaN(card)) {
                        continue;
                    }

                    const num = Number(card);
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

    return game;
}

function createPlayerStats() {
    return {
       tens: 0,
       bombs: 0,
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
   };
}

function renderStatsAsHtmlString(stats) {
    const player1 = stats.players[0];
    const player2 = stats.players[1];
    const player1Stats = stats.playerStats[player1];
    const player2Stats = stats.playerStats[player2];

    let output = "<div>\n<h4>Game</h4>\n";
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

    output += "<table>\n";
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
    output += `    <td>${player1Stats.bets['5'] ?? 0}</td>\n`;
    output += `    <td>${player2Stats.bets['5'] ?? 0}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>15 Bets</td>\n";
    output += `    <td>${player1Stats.bets['15'] ?? 0}</td>\n`;
    output += `    <td>${player2Stats.bets['15'] ?? 0}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>30 Bets</td>\n";
    output += `    <td>${player1Stats.bets['30'] ?? 0}</td>\n`;
    output += `    <td>${player2Stats.bets['30'] ?? 0}</td>\n`;
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
    output += "    <td>Started & Won</td>\n";
    output += `    <td>${player1Stats.ledAndWon}</td>\n`;
    output += `    <td>${player2Stats.ledAndWon}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>10s</td>\n";
    output += `    <td>${player1Stats.tens}</td>\n`;
    output += `    <td>${player2Stats.tens}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Rainbow/Color Bombs</td>\n";
    output += `    <td>${player1Stats.bombs}</td>\n`;
    output += `    <td>${player2Stats.bombs}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Card Sum</td>\n";
    output += `    <td>${player1Stats.sumTotal}</td>\n`;
    output += `    <td>${player2Stats.sumTotal}</td>\n`;
    output += "  </tr>\n";
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

    output += "<div>\n<h4>Rounds</h4>\n";

    for (const i in stats.rounds) {
        const round = stats.rounds[i];
        output += `<h5>Round ${Number(i) + 1}</h5>\n`;
        output += "<table>\n";
        output += "  <tr>\n";
        output += "    <td>Started</td>\n";
        output += `    <td>${round.startPlayer}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Won</td>\n";
        output += `    <td>${round.winner}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Remaining Cards</td>\n";
        output += `    <td>${round.remainingCards}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Haggis 10s</td>\n";
        output += `    <td>${round.haggisTens}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Card Sum Diff</td>\n";
        output += `    <td>${Math.abs(round.sums[player1] - round.sums[player2])}</td>\n`;
        output += "  </tr>\n";
        output += "</table>\n";

        output += "<table>\n";
        output += "  <tr>\n";
        output += `    <th></th>\n`;
        output += `    <th>${player1}</th>\n`;
        output += `    <th>${player2}</th>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>5 Bets</td>\n";
        output += `    <td>${round.bets[player1]?.['5'] ?? 0}</td>\n`;
        output += `    <td>${round.bets[player2]?.['5'] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>15 Bets</td>\n";
        output += `    <td>${round.bets[player1]?.['15'] ?? 0}</td>\n`;
        output += `    <td>${round.bets[player2]?.['15'] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>20 Bets</td>\n";
        output += `    <td>${round.bets[player1]?.['30'] ?? 0}</td>\n`;
        output += `    <td>${round.bets[player2]?.['30'] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>10s</td>\n";
        output += `    <td>${round.tens[player1] ?? 0}</td>\n`;
        output += `    <td>${round.tens[player2] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Rainbow/Color Bombs</td>\n";
        output += `    <td>${round.bombs[player1] ?? 0}</td>\n`;
        output += `    <td>${round.bombs[player2] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Card Sum</td>\n";
        output += `    <td>${round.sums[player1] ?? 0}</td>\n`;
        output += `    <td>${round.sums[player2] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "</table>\n";
    }

    output += "</div>\n";

    return output;
}

async function serializeJson(json) {
    const stream = new Blob([JSON.stringify(json)], {
        type: 'application/json',
    }).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
    const response = await new Response(compressedStream);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const encoded = window.btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return encoded.replaceAll('+', '.').replaceAll('/', '_').replaceAll('=', '-');
}

async function deserializeJson(data) {
    const dataRestored = data.replaceAll('.', '+').replaceAll('_', '/').replaceAll('-', '=');
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
