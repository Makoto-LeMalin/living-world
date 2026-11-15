/**
 * 最小经济：四种商品、库存、价格夹在区间内。
 * 不做均衡模型；事件只改供给/需求修正，价格是慢变量。
 */

import { clamp, round2 } from "../world/canon.ts";
import { provenance, type World } from "../world/world.ts";
import type { Character, Commodity } from "../types.ts";

const ROLE_GOODS: Record<string, Commodity[]> = {
  面包商: ["bread", "grain"],
  店主: ["bread", "fish"],
  船夫: ["fish"],
  祭司: ["grain"],
};

const PRICE_FLOOR: Record<Commodity, number> = {
  bread: 1,
  grain: 0.8,
  fish: 1.2,
  cloth: 1.5,
  tools: 4,
};

const PRICE_CEILING: Record<Commodity, number> = {
  bread: 12,
  grain: 10,
  fish: 16,
  cloth: 20,
  tools: 40,
};

export function goodsFor(character: Character): Commodity[] {
  return ROLE_GOODS[character.role] ?? ["bread"];
}

export function adjustPrice(
  world: World,
  commodity: Commodity,
  factor: number,
  reason: string,
  sourceEventIds: string[] = [],
): number {
  const from = world.state.prices[commodity];
  const to = round2(clamp(from * factor, PRICE_FLOOR[commodity], PRICE_CEILING[commodity]));
  if (Math.abs(to - from) < 0.01) return from;
  const changeRatio = Math.abs(to - from) / Math.max(0.01, from);
  world.emit({
    type: "PriceChanged",
    actorId: undefined,
    roomId: "market_square",
    visibility: "public",
    sourceEventIds,
    payload: { commodity, from, to, reason, changeRatio },
    facts:
      changeRatio >= 0.08
        ? [
            {
              kind: "trade",
              subjectId: "market_square",
              objectId: commodity,
              detail: { commodity, from, to, reason, changeRatio: round2(changeRatio) },
              salience: clamp(0.3 + changeRatio),
              summary: `${commodity} 的价格从 ${from} 变成 ${to}（${reason}）。`,
            },
          ]
        : [],
    provenance: provenance("system", { seed: world.seed }),
  });
  return to;
}

export function changeStock(
  world: World,
  roomId: string,
  commodity: Commodity,
  delta: number,
  reason: string,
  actorId?: string,
): number {
  const current = world.state.stocks[roomId]?.[commodity] ?? 0;
  const applied = delta < 0 ? -Math.min(current, Math.abs(delta)) : delta;
  world.emit({
    type: "StockChanged",
    actorId,
    roomId,
    visibility: "private",
    payload: { roomId, commodity, delta: applied, reason },
    provenance: provenance(actorId ? "actor" : "system", { seed: world.seed }),
  });
  return applied;
}

export function changeCoins(world: World, characterId: string, delta: number, reason: string): void {
  world.emit({
    type: "CoinsChanged",
    actorId: characterId,
    roomId: world.character(characterId).currentRoomId,
    visibility: "private",
    payload: { characterId, delta, reason },
    provenance: provenance("actor", { seed: world.seed }),
  });
}

export function tryTrade(world: World, characterId: string, tick: number): void {
  const character = world.character(characterId);
  if (character.jailed || character.currentRoomId === "alley") return;
  const activity = world.scheduleActivity(character);
  if (activity !== "work" && activity !== "trade") return;
  const last = character.lastWorkTick ?? -999;
  if (tick - last < 12) return;

  const room = world.room(character.currentRoomId);
  const stocks = world.state.stocks[room.id] ?? {};
  const goods = goodsFor(character).filter((commodity) => (stocks[commodity] ?? 0) > 0);
  if (goods.length === 0) return;
  const commodity = goods[Math.floor(world.rng("trade-good", characterId, tick).next() * goods.length)];
  const price = world.state.prices[commodity];
  if (character.coins < price && character.role !== "店主") return;

  character.lastWorkTick = tick;
  changeStock(world, room.id, commodity, -1, "sold", characterId);
  changeCoins(world, characterId, Math.round(price), "sale");
  world.emit({
    type: "Trade",
    actorId: characterId,
    roomId: room.id,
    visibility: "room",
    payload: { commodity, price, buyer: "anonymous" },
    provenance: provenance("actor", { seed: world.seed }),
  });

  const remaining = world.state.stocks[room.id]?.[commodity] ?? 0;
  if (remaining < 18) adjustPrice(world, commodity, 1.04, "供给偏紧");
  else if (remaining > 90) adjustPrice(world, commodity, 0.99, "库存充足");
}
