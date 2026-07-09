// 计算某玩家的最长连续道路（对手的村庄/城市会截断道路）
export function longestRoadLength(edgeIds, edges, blockedVertices) {
  const vAdj = new Map();
  for (const eid of edgeIds) {
    const e = edges[eid];
    for (const v of [e.v1, e.v2]) {
      if (!vAdj.has(v)) vAdj.set(v, []);
      vAdj.get(v).push(e);
    }
  }
  let best = 0;
  const used = new Set();

  function dfs(v, len, cameThrough) {
    if (len > best) best = len;
    // 对手建筑截断：路径可以在此结束，但不能穿过（起点除外）
    if (cameThrough && blockedVertices.has(v)) return;
    for (const e of vAdj.get(v) || []) {
      if (used.has(e.id)) continue;
      used.add(e.id);
      dfs(e.v1 === v ? e.v2 : e.v1, len + 1, true);
      used.delete(e.id);
    }
  }

  for (const v of vAdj.keys()) dfs(v, 0, false);
  return best;
}
