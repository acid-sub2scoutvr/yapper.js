// Raw payload shapes as the Yapper bot API sends them (snake_case).
// Fields marked optional or typed loosely are not confirmed by the docs: check
// https://www.yapin.gg/developers and tighten these as you verify them.

export type Snowflake = string;

export interface Serializable { toJSON(): unknown }

export interface RawUser {
  id: Snowflake;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  bot?: boolean;
  [key: string]: unknown;
}

export interface RawMessage {
  id: Snowflake;
  channel_id: Snowflake;
  server_id?: Snowflake;
  author_id: Snowflake;
  author_bot?: boolean;
  author?: RawUser | null;
  content: string;
  mentioned?: boolean;
  command?: string;
  args?: string;
  command_for?: Snowflake[];
  [key: string]: unknown;
}

export interface RawChannel {
  id: Snowflake;
  name: string;
  type: 'text' | 'voice';
  server_id?: Snowflake;
  position?: number;
  private?: boolean;
  read_only?: boolean;
  slowmode?: number;
  category?: { id: Snowflake; name: string; position: number } | null;
  [key: string]: unknown;
}

export interface RawServer {
  id: Snowflake;
  name: string;
  icon_url?: string | null;
  owner_id?: Snowflake;
  [key: string]: unknown;
}

export interface RawMember {
  id?: Snowflake;
  user_id?: Snowflake;
  username?: string;
  display_name?: string | null;
  nickname?: string | null;
  role_ids?: Snowflake[];
  timeout_until?: string | null;
  [key: string]: unknown;
}

export interface RawRole {
  id: Snowflake;
  name: string;
  [key: string]: unknown;
}

export interface RawEvent {
  id: number;
  type: string;
  data: Record<string, any>;
}

export interface RawInteraction {
  id: string;
  token: string;
  custom_id: string;
  user_id: Snowflake;
  username?: string;
  message_id: Snowflake;
  channel_id: Snowflake;
  server_id?: Snowflake;
  [key: string]: unknown;
}

export type Buildable<T = unknown> = T | Serializable;

export interface SendOptions {
  /** Message id to quote. */
  replyTo?: Snowflake;
  /** Up to 5 embeds (plain objects or `new Embed()`). */
  embeds?: Buildable | Buildable[];
  /** Up to 5 rows of up to 5 buttons (plain objects or `new Row(...)`). */
  components?: Buildable | Buildable[];
}

export interface EditOptions {
  /** New embeds, or null to remove them. */
  embeds?: Buildable | Buildable[] | null;
  /** New components, or null to remove them. */
  components?: Buildable | Buildable[] | null;
}

export type GatewayPayload = { type: string; [key: string]: any };
