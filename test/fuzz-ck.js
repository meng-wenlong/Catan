// ck 模式模糊测试：随机动作跑若干局，验证状态机不抛非游戏错误
import { Game } from '../server/game.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const ALL = [...RES, 'cloth', 'coin', 'paper'];

for (let seed = 1; seed <= 30; seed++) {
  const rng = seeded(seed);
  const rnd = (n) => Math.floor(rng() * n);
  // 3-6 人轮换：覆盖 5-6 人扩展（大地图 + 特别建设阶段）
  const np = 3 + (seed % 4);
  const infos = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, np).map((name) => ({ name }));
  const g = new Game(infos, seeded(seed + 999), 0, 'ck');
  // 初始放置
  while (g.phase === 'setup') {
    const p = g.currentSetupPlayer();
    const vs = g.validSettlementVertices(p, true);
    const v = vs[rnd(vs.length)];
    g.placeSetupSettlement(p, v);
    const es = g.validRoadEdges(p, v);
    g.placeSetupRoad(p, es[rnd(es.length)]);
  }
  let steps = 0;
  try {
    while (g.phase === 'play' && steps++ < 3000) {
      const p = g.turn.player;
      const st = g.turn.state;
      if (st === 'preroll') {
        g.roll(p);
      } else if (st === 'discard') {
        const i = Number(Object.keys(g.turn.pendingDiscards)[0]);
        const need = g.turn.pendingDiscards[i];
        const sel = Object.fromEntries(ALL.map((r) => [r, 0]));
        let left = need;
        for (const r of ALL) {
          const take = Math.min(left, g.players[i].hand[r]);
          sel[r] = take; left -= take;
        }
        g.discard(i, sel);
      } else if (st === 'robber') {
        const hexes = g.board.hexes.filter((h) => h.id !== g.robber);
        g.moveRobber(p, hexes[rnd(hexes.length)].id);
      } else if (st === 'steal') {
        g.steal(p, g.turn.stealTargets[0]);
      } else if (st === 'aqueduct') {
        const i = g.turn.pendingAqueduct[0];
        const r = RES.find((x) => g.bank[x] > 0);
        g.aqueductPick(i, r);
      } else if (st === 'barbarianLoss') {
        const i = Number(Object.keys(g.turn.pendingCityLoss)[0]);
        g.chooseCityLoss(i, g.turn.pendingCityLoss[i][0]);
      } else if (st === 'progressDiscard') {
        const i = g.turn.pendingProgressDiscard[0];
        const cards = g.players[i].progressCards;
        g.progressDiscardCard(i, cards[rnd(cards.length)].type);
      } else if (st === 'defenderPick') {
        const i = g.turn.pendingDefenderPick[0];
        const decks = ['trade', 'politics', 'science'].filter((t) => g.progressDecks[t].length > 0);
        g.defenderPickDeck(i, decks[rnd(decks.length)]);
      } else if (st === 'displace') {
        const d = g.turn.displace;
        g.placeDisplaced(d.owner, d.options[rnd(d.options.length)]);
      } else if (st === 'deserterPick') {
        const t = g.turn.deserter.target;
        const mine = Object.keys(g.knights).filter((v) => g.knights[v].player === t);
        g.deserterPick(t, Number(mine[rnd(mine.length)]));
      } else if (st === 'metropolis') {
        const c = g.turn.metroChoice;
        g.chooseMetropolis(c.player, c.options[rnd(c.options.length)]);
      } else if (st === 'specialBuild') {
        const b = g.turn.sb.queue[g.turn.sb.idx];
        // 随机尝试一次建设动作（失败无妨），然后结束建设窗口
        try {
          const roll = rnd(4);
          if (roll === 0) {
            const es = g.validRoadEdges(b);
            if (es.length) g.buildRoad(b, es[rnd(es.length)]);
          } else if (roll === 1) {
            const spots = g.validKnightSpots(b);
            if (spots.length) g.buildKnight(b, spots[rnd(spots.length)]);
          } else if (roll === 2) {
            const mine = Object.keys(g.knights).filter((v) => g.knights[v].player === b && !g.knights[v].active);
            if (mine.length) g.activateKnight(b, Number(mine[0]));
          } else {
            g.buyImprovement(b, ['trade', 'politics', 'science'][rnd(3)]);
          }
        } catch (e) { if (!e.isGameError) throw e; }
        if (g.turn.state === 'specialBuild' && g.turn.sb.queue[g.turn.sb.idx] === b) g.sbPass(b);
      } else if (st === 'pickCards') {
        g.pickCard(p, ALL.find((r) => g.players[g.turn.pick.from].hand[r] > 0));
      } else if (st === 'pickProgress') {
        const cards = g.players[g.turn.pick.from].progressCards;
        g.pickProgressCard(p, cards[rnd(cards.length)].type);
      } else if (st === 'wedding') {
        const i = Number(Object.keys(g.turn.pendingGive)[0]);
        g.weddingGive(i, ALL.find((r) => g.players[i].hand[r] > 0));
      } else if (st === 'harbor') {
        const h = g.turn.harbor;
        if (h.stage === 'give') {
          g.harborGive(p, RES.find((r) => g.players[p].hand[r] > 0));
        } else {
          const t = h.queue[h.idx];
          g.harborTake(t, ['cloth', 'coin', 'paper'].find((r) => g.players[t].hand[r] > 0));
        }
      } else if (st === 'roadbuilding') {
        const es = g.validRoadEdges(p);
        if (es.length === 0) { g.turn.state = 'main'; g.turn.freeRoads = 0; continue; }
        g.buildRoad(p, es[rnd(es.length)]);
      } else if (st === 'main') {
        // 随机做 0-3 个动作再结束回合
        const acts = rnd(4);
        for (let a = 0; a < acts && g.turn.state === 'main' && g.phase === 'play'; a++) {
          const roll = rnd(10);
          try {
            if (roll === 0) {
              const spots = g.validKnightSpots(p);
              if (spots.length) {
                g.players[p].hand.sheep++; g.players[p].hand.ore++;
                g.buildKnight(p, spots[rnd(spots.length)]);
              }
            } else if (roll === 1) {
              const mine = Object.keys(g.knights).filter((v) => g.knights[v].player === p && !g.knights[v].active);
              if (mine.length) {
                g.players[p].hand.wheat++;
                g.activateKnight(p, Number(mine[0]));
              }
            } else if (roll === 2) {
              const t = ['trade', 'politics', 'science'][rnd(3)];
              const com = { trade: 'cloth', politics: 'coin', science: 'paper' }[t];
              g.players[p].hand[com] += 5;
              g.buyImprovement(p, t);
            } else if (roll === 3) {
              const es = g.validRoadEdges(p);
              if (es.length && g.players[p].pieces.road > 0) {
                g.players[p].hand.wood++; g.players[p].hand.brick++;
                g.buildRoad(p, es[rnd(es.length)]);
              }
            } else if (roll === 4) {
              const vs = g.validSettlementVertices(p, false);
              if (vs.length && g.players[p].pieces.settlement > 0) {
                g.players[p].hand.wood++; g.players[p].hand.brick++;
                g.players[p].hand.sheep++; g.players[p].hand.wheat++;
                g.buildSettlement(p, vs[rnd(vs.length)]);
              }
            } else if (roll === 5) {
              const cs = g.validCityVertices(p);
              if (cs.length && g.players[p].pieces.city > 0) {
                g.players[p].hand.wheat += 2; g.players[p].hand.ore += 3;
                g.buildCity(p, cs[rnd(cs.length)]);
              }
            } else if (roll === 6) {
              const walls = g.ownCityVertices(p).filter((v) => g.walls[v] === undefined);
              if (walls.length && g.wallCountOf(p) < 3) {
                g.players[p].hand.brick += 2;
                g.buildWall(p, walls[0]);
              }
            } else if (roll === 7) {
              // 打一张手里的进步卡（无 payload 的类型）
              const simple = g.players[p].progressCards.find((c) => ['warlord', 'crane', 'irrigation', 'mining', 'commercialHarbor', 'wedding', 'saboteur', 'roadBuilding'].includes(c.type));
              if (simple) g.playProgress(p, simple.type);
            } else if (roll === 8) {
              // 移动骑士（优先驱逐，锻炼被驱逐骑士安置流程）
              const mine = Object.keys(g.knights)
                .filter((v) => g.knights[v].player === p && !g.knightCanAct(p, Number(v)));
              if (mine.length) {
                const v = Number(mine[rnd(mine.length)]);
                const { moves, displaces } = g.knightMoveTargets(p, v);
                const to = displaces.length ? displaces[rnd(displaces.length)]
                  : (moves.length ? moves[rnd(moves.length)] : null);
                if (to !== null) g.moveKnight(p, v, to);
              }
            } else if (roll === 9) {
              // 打需要选目标的进步卡（商业大亨/间谍/阴谋/逃兵）
              const targeted = g.players[p].progressCards.find((c) => ['masterMerchant', 'spy', 'intrigue', 'deserter'].includes(c.type));
              if (targeted) {
                if (targeted.type === 'intrigue') {
                  const ks = Object.keys(g.knights).filter((v) => g.knights[v].player !== p
                    && g.board.vertices[v].adjE.some((e) => g.roads[e] === p));
                  if (ks.length) g.playProgress(p, 'intrigue', { vertex: Number(ks[0]) });
                } else if (targeted.type === 'deserter') {
                  const ts = g.players.map((_, i) => i).filter((i) => i !== p
                    && Object.values(g.knights).some((k) => k.player === i));
                  if (ts.length) g.playProgress(p, 'deserter', { target: ts[rnd(ts.length)] });
                } else {
                  g.playProgress(p, targeted.type, { target: (p + 1 + rnd(g.players.length - 1)) % g.players.length });
                }
              }
            }
          } catch (e) {
            if (!e.isGameError) throw e;
          }
        }
        if (g.turn.state === 'main' && g.phase === 'play') g.endTurn(p);
      } else {
        throw new Error(`未知状态 ${st}`);
      }
      // 序列化不应抛错
      g.publicState();
      for (let i = 0; i < g.players.length; i++) g.privateState(i);
    }
  } catch (e) {
    if (!e.isGameError) {
      console.error(`seed ${seed} 第 ${steps} 步崩溃（state=${g.turn.state}）:`, e);
      process.exit(1);
    }
  }
  const w = g.winner === null ? '未分胜负' : `${g.players[g.winner].name} 胜（${g.victoryPoints(g.winner, true)}分）`;
  console.log(`seed ${seed}（${np} 人）: ${steps} 步，野蛮人来袭 ${g.barbarians.attacks} 次，${w}`);
}
console.log('模糊测试通过 ✅');
