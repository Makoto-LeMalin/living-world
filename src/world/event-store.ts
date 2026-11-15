/**
 * 事件日志的唯一追加点。
 *
 * 它只负责“按顺序保存事件”，不解释事件、不更新投影。投影由 `Projection`
 * 单独消费；这样 EventStore 可以被回放、导出、替换存储（JSONL/SQLite）复用。
 */

export interface StoredEvent {
  id: string;
  tick: number;
}

export class EventStore<E extends StoredEvent = StoredEvent> {
  readonly #events: E[];

  constructor(events: E[] = []) {
    this.#events = events;
  }

  append(event: E): E {
    this.#events.push(event);
    return event;
  }

  all(): readonly E[] {
    return this.#events;
  }

  get length(): number {
    return this.#events.length;
  }

  last(): E | undefined {
    return this.#events[this.#events.length - 1];
  }

  find(id: string): E | undefined {
    return this.#events.find((event) => event.id === id);
  }

  ids(): Set<string> {
    return new Set(this.#events.map((event) => event.id));
  }
}
