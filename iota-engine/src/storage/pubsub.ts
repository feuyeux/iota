import IoRedis from "ioredis";
import type { BackendName } from "../event/types.js";

type RedisClient = InstanceType<typeof IoRedis.default>;

export interface PubSubConfig {
  sentinels?: Array<{ host: string; port: number }>;
  masterName?: string;
  password?: string;
  host?: string;
  port?: number;
}

export type PubSubChannel =
  | "iota:config:changes"
  | "iota:session:updates"
  | "iota:execution:events";

export interface ConfigChangeEvent {
  type: "config_change";
  key: string;
  value: unknown;
  scope: "global" | "backend" | "session" | "user";
  scopeId?: string;
  timestamp: number;
}

export interface SessionUpdateEvent {
  type: "session_update";
  sessionId: string;
  action: "created" | "updated" | "deleted" | "backend_switched";
  backend?: BackendName;
  timestamp: number;
}

export interface ExecutionEvent {
  type: "execution_event";
  executionId: string;
  sessionId: string;
  action: "started" | "completed" | "failed" | "interrupted";
  backend: BackendName;
  timestamp: number;
}

export type PubSubMessage =
  | ConfigChangeEvent
  | SessionUpdateEvent
  | ExecutionEvent;

export type MessageHandler = (message: PubSubMessage) => void | Promise<void>;

/**
 * Redis Pub/Sub manager for real-time event distribution across instances.
 * Supports config changes, session updates, and execution events.
 */
export class RedisPubSub {
  private publisher!: RedisClient;
  private subscriber!: RedisClient;
  private handlers = new Map<PubSubChannel, Set<MessageHandler>>();
  private initialized = false;

  constructor(private readonly config: PubSubConfig) {}

  async init(): Promise<void> {
    if (this.initialized) return;

    // Create separate clients for pub and sub
    const clientConfig = this.config.sentinels?.length
      ? {
          sentinels: this.config.sentinels,
          name: this.config.masterName ?? "mymaster",
          password: this.config.password,
          lazyConnect: true,
        }
      : {
          host: this.config.host ?? "localhost",
          port: this.config.port ?? 6379,
          password: this.config.password,
          lazyConnect: true,
        };

    this.publisher = new IoRedis.default(clientConfig);
    this.subscriber = new IoRedis.default(clientConfig);

    await this.publisher.connect();
    await this.subscriber.connect();

    // Set up message handler
    this.subscriber.on("message", (channel: string, message: string) => {
      this.handleMessage(channel as PubSubChannel, message);
    });

    this.initialized = true;
  }

  /**
   * Publish a config change event
   */
  async publishConfigChange(
    event: Omit<ConfigChangeEvent, "type">,
  ): Promise<void> {
    const message: ConfigChangeEvent = {
      type: "config_change",
      ...event,
    };
    await this.publish("iota:config:changes", message);
  }

  /**
   * Publish a session update event
   */
  async publishSessionUpdate(
    event: Omit<SessionUpdateEvent, "type">,
  ): Promise<void> {
    const message: SessionUpdateEvent = {
      type: "session_update",
      ...event,
    };
    await this.publish("iota:session:updates", message);
  }

  /**
   * Publish an execution event
   */
  async publishExecutionEvent(
    event: Omit<ExecutionEvent, "type">,
  ): Promise<void> {
    const message: ExecutionEvent = {
      type: "execution_event",
      ...event,
    };
    await this.publish("iota:execution:events", message);
  }

  /**
   * Subscribe to a channel with a handler
   */
  async subscribe(
    channel: PubSubChannel,
    handler: MessageHandler,
  ): Promise<() => Promise<void>> {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      await this.subscriber.subscribe(channel);
    }

    const handlers = this.handlers.get(channel)!;
    handlers.add(handler);

    // Return unsubscribe function
    return async () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(channel);
        await this.subscriber.unsubscribe(channel);
      }
    };
  }

  /**
   * Unsubscribe from all channels
   */
  async unsubscribeAll(): Promise<void> {
    await this.subscriber.unsubscribe();
    this.handlers.clear();
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.unsubscribeAll();
    await this.publisher?.quit();
    await this.subscriber?.quit();
    this.initialized = false;
  }

  /**
   * Publish a message to a channel
   */
  private async publish(
    channel: PubSubChannel,
    message: PubSubMessage,
  ): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  /**
   * Handle incoming message
   */
  private handleMessage(channel: PubSubChannel, messageStr: string): void {
    const handlers = this.handlers.get(channel);
    if (!handlers || handlers.size === 0) return;

    try {
      const message = JSON.parse(messageStr) as PubSubMessage;
      for (const handler of handlers) {
        // Fire and forget, catch errors per handler
        Promise.resolve(handler(message)).catch((error) => {
          console.error(
            `Error in pub/sub handler for channel ${channel}:`,
            error,
          );
        });
      }
    } catch (error) {
      console.error(`Failed to parse pub/sub message on ${channel}:`, error);
    }
  }
}
