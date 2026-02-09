document.addEventListener("paste", async function (event) {
    const clipboardData = event.clipboardData || window.clipboardData;
    const htmlData = clipboardData.getData("text/html");

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlData, "text/html");

    const players = [];
    for (const el of doc.querySelectorAll(".score-entry .playername")) {
        players.push(el.textContent);
    }

    const tableId = extractTableId(doc);
    const withColor = addColorData(doc);
    const serializer = new XMLSerializer();
    const serializedLogs = serializer.serializeToString(withColor);
    const logData = extractGameData(serializedLogs);
    const game = parseLog(tableId, players, logData);

    event.preventDefault();
    const textArea = document.getElementById("logText");
    textArea.value = JSON.stringify(game);
});

async function submitGame() {
    const game = JSON.parse(document.getElementById("logText").value);
    const data = await serializeJson(game);
    document.getElementById("data").value = data;
    document.getElementById("statsForm").submit();
}

async function renderStats() {
    const urlParams = new URLSearchParams(window.location.search);
    const data = urlParams.get("data");

    if (!data) {
        document.getElementById("stats").innerHTML = "Data not found";
        return;
    }

    const game = await deserializeJson(data);

    document.getElementById("bgaLink").href = "https://boardgamearena.com/table?table=" + game.tableId;

    const stats = computeStats(game);
    const hands = buildHands(game);

    document.getElementById("stats").innerHTML = render2pStatsAsHtmlString(game.tableId, stats, game, hands);
    render2pCharts(stats);
}

function parseLog(tableId, players, logLines) {
    const game = {
        tableId: tableId,
        players: players,
        rounds: [],
    };

    let inLog = false;
    let currentRound = null;
    let goesOut = null;
    let goesOutIndex = null;

    for (let i = 0; i < logLines.length; i++) {
        const line = logLines[i];

        const player = identifyPlayer(players, line);
        let words;
        if (player == null) {
            words = line.split(/\s+/);
        } else {
            words = line.substring(player.length + 1).split(/\s+/);
        }

        if (words[0] === "Move" || words[0] === "You" || words[0] === "") {
            continue;
        }

        if (line.includes("starts a new round") || line.includes("will start a new round")) {
            inLog = true;
            currentRound = {
                actions: [],
            };
            game.rounds.push(currentRound);
            goesOut = null;
            goesOutIndex = null;

            continue;
        }

        if (!inLog) {
            continue;
        }

        // The order of this is important. Do not move!

        if (line.includes('wins the trick')
            || line.includes('wins this trick')
            || line.includes('won this trick')) {
            const winsTrick = {
                subject: player,
                predicate: 'wins-trick'
            };

            if (goesOut == null) {
                currentRound.actions.push(winsTrick);
            } else {
                currentRound.actions.splice(goesOutIndex, 0, winsTrick);
            }
        }

        const score = line.match(/scores? (\d+) point/);
        if (score) {
            const points = Number(score[1]);
            let reason;

            if (line.includes('bomb')) {
                reason = 'bomb';
            } else if (line.includes("trick") || line.includes("remaining")) {
                reason = 'cards';
            } else if (line.includes("bet")) {
                reason = 'bet';
            } else if (line.includes("goes out")) {
                reason = 'hand';
            }

            currentRound.actions.push({
                subject: player,
                predicate: 'scores',
                object: {
                    points: points,
                    reason: reason,
                }
            });
        }

        if (words[0].includes("bets")) {
            currentRound.actions.push({
                subject: player,
                predicate: 'bets',
                object: {
                    points: words[1],
                }
            });

            continue;
        }

        if (words[0].includes("plays")) {
            const cards = words[1].split("-");
            const parsedCards = [];

            for (const card of cards) {
                const parsedCard = parseCard(card);
                if (!parsedCard) {
                    continue;
                }
                parsedCards.push(parsedCard);
            }

            currentRound.actions.push({
                subject: player,
                predicate: 'plays',
                object: {
                    cards: parsedCards,
                }
            });

            continue;
        }

        if (line.includes('goes out')) {
            goesOut = {
                subject: player,
                predicate: 'goes-out',
                object: {}
            };
            goesOutIndex = currentRound.actions.length;
            currentRound.actions.push(goesOut);

            continue;
        }

        if (line.includes('remaining cards')) {
            const remainingLine = logLines[++i];
            const remainingPlayer = identifyPlayer(players, remainingLine);
            const remainingCards = parseRemainingCardsLine(remainingLine);
            const haggisCards = parseRemainingCardsLine(logLines[++i]);

            goesOut.object.remaining = {
                [remainingPlayer]: remainingCards
            };
            goesOut.object.haggis = haggisCards;

            continue;
        }

        if (line.includes("concedes the game")) {
            currentRound.actions.push({
                subject: player,
                predicate: 'concedes',
            });
        }
    }

    return game;
}

function identifyPlayer(players, line) {
    for (const player of players) {
        if (line.startsWith(player)) {
            return player;
        }
    }
    return null;
}

function parseRemainingCardsLine(line) {
    const words = line.split(/\s+/);
    const cards = [];

    for (const word of words) {
        const card = word.endsWith(",") ? word.substring(0, word.length - 1) : word;
        const parsedCard = parseCard(card);
        if (!parsedCard) {
            continue;
        }
        cards.push(parsedCard);
    }

    return cards;
}

function computeStats(game) {
    const stats = {
        playerCount: game.players.length,
        players: game.players,
        rounds: [],
        playerStats: {}
    };

    for (const player of game.players) {
        stats.playerStats[player] = createPlayerStats();
    }

    for (const round of game.rounds) {
        const roundStats = {
            startPlayer: null,
            bets: {},
            tens: {},
            colorBombs: {},
            rainbowBombs: {},
            startingScore: {},
            sums: {},
            points: {},
            hand: {},
            outOrder: [],
            remainingCount: {}
        };

        stats.rounds.push(roundStats);

        for (const player of game.players) {
            roundStats.startingScore[player] = stats.playerStats[player].score;
        }

        for (const action of round.actions) {
            const player = action.subject;

            if (roundStats.startPlayer == null
                && action.predicate === 'plays') {
                roundStats.startPlayer = player;
                stats.playerStats[player].led += 1;
            }

            switch (action.predicate) {
                case 'scores': {
                    const points = action.object.points;
                    stats.playerStats[player].score += points;
                    roundStats.points[player] = (roundStats.points[player] ?? 0) + points;

                    const reason = action.object.reason;
                    if (reason === 'cards' || reason === 'bomb') {
                        stats.playerStats[player].pointsFromCards += points;
                    } else if (reason === 'bet') {
                        stats.playerStats[player].pointsFromBets += points;
                    } else if (reason === 'hand') {
                        stats.playerStats[player].pointsFromRemaining += points;
                    }
                    break;
                }
                case 'bets': {
                    const points = action.object.points;
                    roundStats.bets[player] = points;
                    stats.playerStats[player].bets[points] = (stats.playerStats[player].bets[points] ?? 0) + 1;
                    stats.playerStats[player].totalBets += 1;
                    break;
                }
                case 'plays': {
                    const cards = action.object.cards;

                    for (const card of cards) {
                        if (card.suit === 'w') {
                            continue;
                        }

                        const num = card.rank;
                        if (num === 10) {
                            roundStats.tens[player] = (roundStats.tens[player] ?? 0) + 1;
                            stats.playerStats[player].tens += 1;
                        }

                        roundStats.sums[player] = (roundStats.sums[player] ?? 0) + num;
                        stats.playerStats[player].sumTotal += num;
                    }

                    if (isRainbowBomb(cards)) {
                        roundStats.rainbowBombs[player] = (roundStats.rainbowBombs[player] ?? 0) + 1;
                        stats.playerStats[player].rainbowBombs += 1;
                    } else if (isColorBomb(cards)) {
                        roundStats.colorBombs[player] = (roundStats.colorBombs[player] ?? 0) + 1;
                        stats.playerStats[player].colorBombs += 1;
                    }
                    break;
                }
                case 'goes-out': {
                    roundStats.outOrder.push(player);
                    const otherPlayer = findOtherPlayer(player, game.players);
                    roundStats.remainingCount[player] = action.object.remaining[otherPlayer].length;
                    stats.playerStats[player].wins += 1;

                    if (roundStats.bets[player]) {
                        stats.playerStats[player].successfulBets += 1;
                    }
                    if (player === roundStats.startPlayer) {
                        stats.playerStats[player].ledAndWon += 1;
                    }

                    for (const card of action.object.remaining[otherPlayer]) {
                        if (card.suit === 'w') {
                            continue;
                        }

                        const num = card.rank;
                        if (num === 10) {
                            roundStats.tens[otherPlayer] = (roundStats.tens[otherPlayer] ?? 0) + 1;
                            stats.playerStats[otherPlayer].tens += 1;
                        }

                        roundStats.sums[otherPlayer] = (roundStats.sums[otherPlayer] ?? 0) + num;
                        stats.playerStats[otherPlayer].sumTotal += num;
                    }

                    break;
                }
                case 'concedes': {
                    stats.conceder = player;
                    stats.rounds.pop();
                    break;
                }
            }
        }
    }

    stats.winner = (stats.playerStats[game.players[0]].score > stats.playerStats[game.players[1]].score)
        ? game.players[0] : game.players[1];

    addSumStats(stats);

    return stats;
}

function buildHands(game) {
    const hands = [];
    for (const round of game.rounds) {
        hands.push(buildHandsForRound(game.players, round));
    }
    return hands;
}

function buildHandsForRound(players, round) {
    const hands = {};
    for (const player of players) {
        hands[player] = [];
    }
    for (const action of round.actions) {
        switch (action.predicate) {
            case 'plays': {
                hands[action.subject].push(...action.object.cards);
                break;
            }
            case 'goes-out': {
                const otherPlayer = findOtherPlayer(action.subject, players);
                hands[otherPlayer].push(...action.object.remaining[otherPlayer]);
                break;
            }
        }
    }
    for (const player of players) {
        hands[player].sort(sortCardsByRank);
    }
    return hands;
}

function sortCardsByRank(left, right) {
    if (left.suit === 'w' && right.suit === 'w') {
        if (left.rank === 'J') {
            return -1;
        } else if (right.rank === 'J') {
            return 1;
        } else if (left.rank === 'Q') {
            return -1;
        } else {
            return 1;
        }
    } else if (left.suit === 'w') {
        return 1;
    } else if (right.suit === 'w') {
        return -1;
    }

    const result = left.rank - right.rank;
    if (result !== 0) {
        return result;
    }
    return left.suit.charCodeAt(0) - right.suit.charCodeAt(0);
}

function addSumStats(stats) {
    for (const name of stats.players) {
        stats.playerStats[name].sumAvg = stats.playerStats[name].sumTotal / stats.rounds.length;
        let min = 999999;
        let max = 0;
        for (const round of stats.rounds) {
            const sum = round.sums[name];
            if (sum > max) {
                max = sum;
            }
            if (sum < min) {
                min = sum;
            }
        }
        stats.playerStats[name].sumMin = min;
        stats.playerStats[name].sumMax = max;
    }

    if (stats.playerCount === 2) {
        for (const round of stats.rounds) {
            if (round.sums[stats.players[0]] < round.sums[stats.players[1]]) {
                stats.playerStats[stats.players[1]].largerSum += 1;
            } else if (round.sums[stats.players[0]] > round.sums[stats.players[1]]) {
                stats.playerStats[stats.players[0]].largerSum += 1;
            }
        }
    }
}

function createPlayerStats() {
    return {
        tens: 0,
        colorBombs: 0,
        rainbowBombs: 0,
        bets: {},
        totalBets: 0,
        successfulBets: 0,
        wins: 0,
        score: 0,
        pointsFromCards: 0,
        pointsFromBets: 0,
        pointsFromRemaining: 0,
        led: 0,
        ledAndWon: 0,
        sumTotal: 0,
        sumMin: 0,
        sumMax: 0,
        sumAvg: 0,
        largerSum: 0,
        slams: 0,
    };
}

function findOtherPlayer(player, players) {
    for (const otherPlayer of players) {
        if (player !== otherPlayer) {
            return otherPlayer;
        }
    }
    return null;
}

function isColorBomb(cards) {
    if (cards.length !== 4) {
        return false;
    }
    const suits = new Set();
    for (const card of cards) {
        suits.add(card.suit);
    }
    if (suits.size !== 1) {
        return false;
    }
    return cards[0].rank === 3 && cards[1].rank === 5 && cards[2].rank === 7 && cards[3].rank === 9;
}

function isRainbowBomb(cards) {
    if (cards.length !== 4) {
        return false;
    }
    const suits = new Set();
    for (const card of cards) {
        suits.add(card.suit);
    }
    if (suits.size !== 4) {
        return false;
    }
    return cards[0].rank === 3 && cards[1].rank === 5 && cards[2].rank === 7 && cards[3].rank === 9;
}

function render2pStatsAsHtmlString(tableId, stats, game, hands) {
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

    if (stats.conceder) {
        output += "  <tr>\n";
        output += "    <td>Conceder</td>\n";
        output += `    <td>${stats.conceder}</td>\n`;
        output += "  </tr>\n";
    }

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

    // This was added much later
    if (Object.hasOwn(player1Stats, "pointsFromCards")) {
        output += "  <tr>\n";
        output += "    <td>Captured Points</td>\n";
        output += `    <td>${player1Stats.pointsFromCards}</td>\n`;
        output += `    <td>${player2Stats.pointsFromCards}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>5x Points</td>\n";
        output += `    <td>${player1Stats.pointsFromRemaining}</td>\n`;
        output += `    <td>${player2Stats.pointsFromRemaining}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Bet Points</td>\n";
        output += `    <td>${player1Stats.pointsFromBets}</td>\n`;
        output += `    <td>${player2Stats.pointsFromBets}</td>\n`;
        output += "  </tr>\n";
    }

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
    output += "    <td>Rainbow Bombs</td>\n";
    output += `    <td>${player1Stats.rainbowBombs}</td>\n`;
    output += `    <td>${player2Stats.rainbowBombs}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Color Bombs</td>\n";
    output += `    <td>${player1Stats.colorBombs}</td>\n`;
    output += `    <td>${player2Stats.colorBombs}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Card Sum</td>\n";
    output += `    <td>${player1Stats.sumTotal}</td>\n`;
    output += `    <td>${player2Stats.sumTotal}</td>\n`;
    output += "  </tr>\n";
    output += "  <tr>\n";
    output += "    <td>Rounds with > Sum</td>\n";
    output += `    <td>${player1Stats.largerSum}</td>\n`;
    output += `    <td>${player2Stats.largerSum}</td>\n`;
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

    output += "<div>\n<h3>Rounds</h3>\n";

    for (const i in stats.rounds) {
        const roundStats = stats.rounds[i];
        const actions = game.rounds[i].actions;
        const player1Hand = hands[i][player1];
        const player2Hand = hands[i][player2];

        output += `<h4>Round ${Number(i) + 1}</h4>\n`;
        output += "<table>\n";
        output += "  <tr>\n";
        output += "    <td>Started</td>\n";
        output += `    <td>${roundStats.startPlayer}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Out First</td>\n";
        output += `    <td>${roundStats.outOrder[0]}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Remaining Cards</td>\n";
        output += `    <td>${roundStats.remainingCount[roundStats.outOrder[0]]}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Card Sum Diff</td>\n";
        output += `    <td>${Math.abs(
            roundStats.sums[player1] - roundStats.sums[player2]
        )}</td>\n`;
        output += "  </tr>\n";
        output += "</table>\n";

        output += "<table class='shaded'>\n";
        output += "  <thead>\n";
        output += "    <th></th>\n";
        output += `    <th>${player1}</th>\n`;
        output += `    <th>${player2}</th>\n`;
        output += "  </thead>\n";
        output += "  <tr>\n";
        output += "    <td>Starting Score</td>\n";
        output += `    <td>${roundStats.startingScore[player1] ?? 0}</td>\n`;
        output += `    <td>${roundStats.startingScore[player2] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Points Gained</td>\n";
        output += `    <td>${roundStats.points[player1] ?? 0}</td>\n`;
        output += `    <td>${roundStats.points[player2] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Bets</td>\n";
        output += `    <td>${roundStats.bets[player1] ?? "NA"}</td>\n`;
        output += `    <td>${roundStats.bets[player2] ?? "NA"}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Card Sum</td>\n";
        output += `    <td>${roundStats.sums[player1] ?? 0}</td>\n`;
        output += `    <td>${roundStats.sums[player2] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>10s</td>\n";
        output += `    <td>${roundStats.tens[player1] ?? 0}</td>\n`;
        output += `    <td>${roundStats.tens[player2] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Rainbow Bombs</td>\n";
        output += `    <td>${roundStats.rainbowBombs[player1] ?? 0}</td>\n`;
        output += `    <td>${roundStats.rainbowBombs[player2] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "  <tr>\n";
        output += "    <td>Color Bombs</td>\n";
        output += `    <td>${roundStats.colorBombs[player1] ?? 0}</td>\n`;
        output += `    <td>${roundStats.colorBombs[player2] ?? 0}</td>\n`;
        output += "  </tr>\n";
        output += "</table>\n";

        output += "<details>\n";
        output += "  <summary>Log</summary>\n";
        output += "  <table class='shaded'>\n";
        output += "    <thead>\n";
        output += "      <tr>\n";
        output += `        <th colspan='2' style="text-align: center;">${player1}</th>\n`;
        output += `        <th colspan='2' style="text-align: center;">${player2}</th>\n`;
        output += "      </tr>\n";
        output += "      <tr>\n";
        output += "        <th>Hand</th>\n";
        output += "        <th>Action</th>\n";
        output += "        <th>Action</th>\n";
        output += "        <th>Hand</th>\n";
        output += "      </tr>\n";
        output += "    </thead>\n";

        output += logRowHtml(handToHtml(player1Hand), '', '', handToHtml(player2Hand));

        let haggis = null;

        for (const action of actions) {
            const player = action.subject;
            const isPlayer1 = player === player1;
            switch (action.predicate) {
                case 'plays': {
                    const cards = action.object.cards;
                    removeCardsFromHand(cards, hands[i][player]);
                    const playHtml = playToHtml(cards);
                    const player1Action = isPlayer1 ? playHtml : '';
                    const player2Action = !isPlayer1 ? playHtml : '';
                    output += logRowHtml(handToHtml(player1Hand), player1Action, player2Action, handToHtml(player2Hand));
                    break;
                }
                case 'bets': {
                    const bet = `Bets ${action.object.points}`;
                    const player1Action = isPlayer1 ? bet : '';
                    const player2Action = !isPlayer1 ? bet : '';
                    output += logRowHtml('', player1Action, player2Action, '');
                    break;
                }
                case 'scores': {
                    const score = `${action.object.points} fr ${action.object.reason}`;
                    const player1Action = isPlayer1 ? score : '';
                    const player2Action = !isPlayer1 ? score : '';
                    output += logRowHtml('', player1Action, player2Action, '');
                    break;
                }
                case 'goes-out': {
                    haggis = action.object.haggis;
                }
            }
        }

        if (haggis != null) {
            output += "    <tr>\n";
            output += `      <td colspan='4' style="text-align: center;">Haggis: ${handToHtml(haggis)}</td>\n`;
            output += "    </tr>\n";
        }

        output += "  </table>\n";
        output += "</details>\n";
    }

    output += "</div>\n";

    return output;
}

function logRowHtml(player1Hand, player1Action, player2Action, player2Hand) {
    let output = "";
    output += "    <tr>\n";
    output += `      <td>${player1Hand}</td>\n`;
    output += `      <td>${player1Action}</td>\n`;
    output += `      <td>${player2Action}</td>\n`;
    output += `      <td>${player2Hand}</td>\n`;
    output += "    </tr>\n";
    return output;
}

function removeCardsFromHand(cards, hand) {
    for (const card of cards) {
        for (const i in hand) {
            const handCard = hand[i];
            if (cardEquals(card, handCard)) {
                hand.splice(i, 1);
                break;
            }
        }
    }
}

function cardEquals(left, right) {
    return left.rank === right.rank && left.suit === right.suit;
}

function playToHtml(cards) {
    let output = "";
    for (const card of cards) {
        output += `<span class="card-${lookupSuitColor(card)}">${card.rank}</span>-`;
    }
    return output.substring(0, output.length - 2);
}

function handToHtml(hand) {
    let output = "";
    for (const card of hand) {
        output += `<span class="card-${lookupSuitColor(card)}">${card.rank}</span>, `;
    }
    return output.substring(0, output.length - 3);
}

function lookupSuitColor(card) {
    switch (card.suit) {
        case 'b': return 'blue';
        case 'p': return 'purple';
        case 'r': return 'red';
        case 'y': return 'yellow';
        default: return 'black';
    }
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
    if (text === 'J' || text === 'Q' || text === 'K') {
        return {
            suit: 'w',
            rank: text
        };
    } else if (/^[rbpy]\d+/.test(text)) {
        const rank = Number(text.slice(1));
        if (!isNaN(rank)) {
            return {
                suit: text.charAt(0),
                rank: rank
            }
        }
    }
    return null;
}

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

function render2pCharts(stats) {
    appendChartElements();

    const labels = [];

    for (let i = 1; i <= stats.rounds.length; i++) {
        labels.push(i);
    }

    render2pChartsByType(stats, labels, true);

    const selectElement = document.querySelector("#chartType");
    selectElement.addEventListener("change", (event) => {
        removeAll2pCharts();
        render2pChartsByType(stats, labels, "Cumulative" === event.target.value);
    });
}

function appendChartElements() {
    const heading = document.createElement("h2");
    heading.textContent = 'Charts';
    document.body.appendChild(heading);

    const select = document.createElement('select');
    select.id = 'chartType';
    select.name = 'chartType';
    const cumulativeOption = document.createElement('option');
    cumulativeOption.textContent = 'Cumulative';
    const nonCumulativeOption = document.createElement('option');
    nonCumulativeOption.textContent = 'Noncumulative';
    select.appendChild(cumulativeOption);
    select.appendChild(nonCumulativeOption);
    document.body.appendChild(select);

    appendChartAnchor('scoreChart');
    appendChartAnchor('sumChart');
    appendChartAnchor('tenChart');
    appendChartAnchor('bombChart');
}

function appendChartAnchor(id) {
    const div = document.createElement('div');
    div.className = 'chart';
    const canvas = document.createElement('canvas');
    canvas.id = id;
    div.appendChild(canvas);
    document.body.appendChild(div);
}

function removeAll2pCharts() {
    const chartIds = ['scoreChart', 'sumChart', 'tenChart', 'bombChart'];
    for (const chart of chartIds) {
        removeChart(chart);
    }
}

function removeChart(canvasId) {
    const old = document.getElementById(canvasId);
    const newCanvas = document.createElement('canvas');
    newCanvas.id = canvasId;
    const div = old.parentElement;
    old.remove()
    div.appendChild(newCanvas);
}

function render2pChartsByType(stats, labels, cumulative) {
    render2pSimpleChart(stats, labels, 'points', 'scoreChart', 'Points', cumulative);
    render2pSimpleChart(stats, labels, 'sums', 'sumChart', 'Card Sum', cumulative);
    render2pSimpleChart(stats, labels, 'tens', 'tenChart', '10 Count', cumulative);
    render2pBombChart(stats, labels, 'bombChart', cumulative);
}

function render2pSimpleChart(stats, labels, field, canvasId, title, cumulative) {
    const player1 = stats.players[0];
    const player2 = stats.players[1];

    const player1Data = computeChartData(stats.rounds, field, player1, cumulative);
    const player2Data = computeChartData(stats.rounds, field, player2, cumulative);

    const ctx = document.getElementById(canvasId);

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${player1}`,
                data: player1Data
            }, {
                label: `${player2}`,
                data: player2Data
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: {
                    title: {
                        text: 'Round',
                        display: true
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: true,
                    text: title
                }
            }
        }
    });
}

function render2pBombChart(stats, labels, canvasId, cumulative) {
    const player1 = stats.players[0];
    const player2 = stats.players[1];

    const player1RainbowData = computeChartData(stats.rounds, 'rainbowBombs', player1, cumulative);
    const player2RainbowData = computeChartData(stats.rounds, 'rainbowBombs', player2, cumulative);
    const player1ColorData = computeChartData(stats.rounds, 'colorBombs', player1, cumulative);
    const player2ColorData = computeChartData(stats.rounds, 'colorBombs', player2, cumulative);

    const player1Data = [];
    const player2Data = [];
    for (const i in player1RainbowData) {
        player1Data.push(player1RainbowData[i] + player1ColorData[i]);
        player2Data.push(player2RainbowData[i] + player2ColorData[i]);
    }

    const ctx = document.getElementById(canvasId);

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${player1}`,
                data: player1Data
            }, {
                label: `${player2}`,
                data: player2Data
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: {
                    title: {
                        text: 'Round',
                        display: true
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Rainbow/Color Bomb Count'
                }
            }
        }
    });
}

function computeChartData(rounds, field, player, cumulative) {
    const result = [];
    for (const i in rounds) {
        const round = rounds[i];
        const currentValue = round[field][player] ?? 0;
        if (!cumulative || i == 0) {
            result.push(currentValue);
        } else {
            result.push(currentValue + result[i - 1]);
        }
    }
    return result;
}
