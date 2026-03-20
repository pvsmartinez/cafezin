import { describe, expect, it } from 'vitest';

import { buildRetryMessages } from '../hooks/useAIStream';
import type { ChatMessage } from '../types';

describe('buildRetryMessages', () => {
  it('keeps the payload unchanged when there is no partial assistant output', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Write a summary.' },
    ];

    expect(buildRetryMessages(messages)).toEqual(messages);
  });

  it('appends retry instructions to the final user string message', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Write a summary.' },
    ];

    const retryMessages = buildRetryMessages(messages, { partialForRetry: 'First paragraph already started' });
    const lastMessage = retryMessages[retryMessages.length - 1];

    expect(lastMessage.role).toBe('user');
    expect(typeof lastMessage.content).toBe('string');
    expect(String(lastMessage.content)).toContain('Write a summary.');
    expect(String(lastMessage.content)).toContain('Continue from the partial assistant output below');
    expect(String(lastMessage.content)).toContain('First paragraph already started');
  });

  it('appends retry instructions as a text part for multipart user messages', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          { type: 'text', text: 'Describe this screenshot.' },
        ],
      },
    ];

    const retryMessages = buildRetryMessages(messages, { partialForRetry: 'The layout has a broken button' });
    const lastMessage = retryMessages[retryMessages.length - 1];

    expect(lastMessage.role).toBe('user');
    expect(Array.isArray(lastMessage.content)).toBe(true);
    const parts = lastMessage.content as Array<{ type: string; text?: string }>;
    expect(parts.at(-1)?.type).toBe('text');
    expect(parts.at(-1)?.text).toContain('The layout has a broken button');
  });

  it('falls back to adding a user continuation message when the payload does not end with user', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Open the file.' },
      { role: 'assistant', content: 'Partial response' },
    ];

    const retryMessages = buildRetryMessages(messages, { partialForRetry: 'Continue here' });
    const lastMessage = retryMessages[retryMessages.length - 1];

    expect(lastMessage.role).toBe('user');
    expect(String(lastMessage.content)).toContain('Continue here');
  });

  it('injects previous error details even when there is no partial assistant output', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Fix the professor panel.' },
    ];

    const retryMessages = buildRetryMessages(messages, {
      errorContextForRetry: 'Copilot API error 400: Invalid JSON format in tool call arguments',
    });
    const lastMessage = retryMessages[retryMessages.length - 1];

    expect(lastMessage.role).toBe('user');
    expect(String(lastMessage.content)).toContain('Your previous attempt failed');
    expect(String(lastMessage.content)).toContain('Invalid JSON format in tool call arguments');
  });
});