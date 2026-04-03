import { vi } from 'vitest';

export const Bot = vi.fn().mockImplementation((_token: string) => ({
  api: {
    config: { use: vi.fn() },
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendChatAction: vi.fn().mockResolvedValue({}),
    getMe: vi.fn().mockResolvedValue({ username: 'test_bot' }),
  },
  use: vi.fn(),
  catch: vi.fn(),
  on: vi.fn(),
  start: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
}));

export type Context = Record<string, unknown>;
