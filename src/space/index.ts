/**
 * 空间：房间、路线、可见范围。
 *
 * 这里只做结构查询，不认识角色、事实或剧情。世界层把角色位置投影成
 * `scopeRoomIds()` 给出的房间集合，再决定谁在场、谁看得见。
 */

export interface SpaceRoom {
  id: string;
  placeId: string;
  exits?: readonly string[];
  light?: "bright" | "dim" | "dark";
}

export interface SpaceRoute {
  id: string;
  fromRoomId: string;
  toRoomId: string;
}

/** 与事件 visibility 对齐；`public` 在当前世界语义里等同 `place`。 */
export type SpatialVisibility = "private" | "room" | "place" | "public";

export class Space<R extends SpaceRoom = SpaceRoom, T extends SpaceRoute = SpaceRoute> {
  readonly rooms: readonly R[];
  readonly routes: readonly T[];
  readonly #roomsById: Map<string, R>;
  readonly #roomsByPlace: Map<string, R[]>;

  constructor(rooms: readonly R[], routes: readonly T[]) {
    this.rooms = [...rooms];
    this.routes = [...routes];
    this.#roomsById = new Map();
    this.#roomsByPlace = new Map();
    for (const room of this.rooms) {
      if (this.#roomsById.has(room.id)) throw new Error(`重复房间 id: ${room.id}`);
      this.#roomsById.set(room.id, room);
      const list = this.#roomsByPlace.get(room.placeId) ?? [];
      list.push(room);
      this.#roomsByPlace.set(room.placeId, list);
    }
  }

  maybeRoom(id: string): R | undefined {
    return this.#roomsById.get(id);
  }

  room(id: string): R {
    const found = this.#roomsById.get(id);
    if (!found) throw new Error(`未知房间: ${id}`);
    return found;
  }

  placeOfRoom(roomId: string): string {
    return this.room(roomId).placeId;
  }

  /** 保留 canon 中的房间顺序。 */
  roomsInPlace(placeId: string): R[] {
    return [...(this.#roomsByPlace.get(placeId) ?? [])];
  }

  /** 双向查找：A→B 与 B→A 视为同一条路线。 */
  routeBetween(fromRoomId: string, toRoomId: string): T | undefined {
    return this.routes.find(
      (route) =>
        (route.fromRoomId === fromRoomId && route.toRoomId === toRoomId) ||
        (route.toRoomId === fromRoomId && route.fromRoomId === toRoomId),
    );
  }

  neighbors(roomId: string): string[] {
    const result: string[] = [];
    for (const route of this.routes) {
      if (route.fromRoomId === roomId) result.push(route.toRoomId);
      else if (route.toRoomId === roomId) result.push(route.fromRoomId);
    }
    return result;
  }

  /**
   * 可见范围对应的房间集合。
   * - private：空
   * - room：当前房间
   * - place/public：当前聚落的所有房间
   */
  scopeRoomIds(visibility: SpatialVisibility, roomId: string): string[] {
    if (visibility === "private") return [];
    if (visibility === "room") return [this.room(roomId).id];
    return this.roomsInPlace(this.placeOfRoom(roomId)).map((room) => room.id);
  }

  /** 结构检查：出口/路线端点存在、无自环、无重复路线 id。 */
  validate(): string[] {
    const errors: string[] = [];
    const routeIds = new Set<string>();
    for (const room of this.rooms) {
      for (const exit of room.exits ?? []) {
        if (!this.#roomsById.has(exit)) errors.push(`房间 ${room.id} 的出口不存在: ${exit}`);
      }
    }
    for (const route of this.routes) {
      if (routeIds.has(route.id)) errors.push(`重复路线 id: ${route.id}`);
      routeIds.add(route.id);
      if (!this.#roomsById.has(route.fromRoomId)) errors.push(`路线 ${route.id} 起点不存在: ${route.fromRoomId}`);
      if (!this.#roomsById.has(route.toRoomId)) errors.push(`路线 ${route.id} 终点不存在: ${route.toRoomId}`);
      if (route.fromRoomId === route.toRoomId) errors.push(`路线 ${route.id} 是自环`);
    }
    return errors;
  }
}
