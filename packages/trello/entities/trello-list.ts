/**
 * trello_list entity — Trello lists (columns) as linkable Drift entities.
 *
 * Actions: create_list (type-scope), update_list, archive_list (instance-scope).
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';
import type { TrelloClient } from 'trello.js';

// ---------- Schema ----------

const trelloListSchema = z.object({
  id: z.string(),
  type: z.literal('trello_list'),
  uri: z.string(),
  title: z.string(),
  idBoard: z.string(),
  boardName: z.string().optional(),
  closed: z.boolean().optional(),
  pos: z.number().optional(),
  cardCount: z.number().optional(),
  createdAt: z.date().optional(),
});

type TrelloList = z.infer<typeof trelloListSchema>;

// ---------- Helpers ----------

function getClient(ctx: EntityResolverContext): TrelloClient | null {
  return (ctx as any).integrations?.trello?.client ?? null;
}

function listToEntity(list: any, boardName?: string, cardCount?: number): TrelloList {
  return {
    id: list.id,
    type: 'trello_list',
    uri: `@drift//trello_list/${list.id}`,
    title: list.name ?? '(Untitled list)',
    idBoard: list.idBoard,
    boardName: boardName ?? list.board?.name ?? undefined,
    closed: list.closed ?? false,
    pos: list.pos ?? undefined,
    cardCount,
  };
}

// ---------- Action input schemas ----------

const createListInput = z.object({
  boardId: z.string().describe('Board ID to create the list on. Call list_boards to find valid boardIds.'),
  name: z.string().describe('List name (e.g. "Backlog", "In Progress", "Done").'),
  pos: z.enum(['top', 'bottom']).optional().describe('Position on the board. Default: bottom.'),
});

const updateListInput = z.object({
  name: z.string().optional().describe('New list name.'),
  pos: z.union([z.number(), z.enum(['top', 'bottom'])]).optional().describe('New position on the board.'),
});

// ---------- Entity definition ----------

const TrelloListEntity = defineEntity({
  type: 'trello_list',
  displayName: 'Trello List',
  description: 'A list (column) on a Trello board',
  icon: 'layout',

  schema: trelloListSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '\u{1F4C4}',
    colors: {
      bg: '#0079BF',
      text: '#FFFFFF',
      border: '#0065A3',
    },
    description: 'Trello board lists (columns)',
    outputFields: [
      { key: 'board', label: 'Board', metadataPath: 'boardName', format: 'string' },
      { key: 'cards', label: 'Card Count', metadataPath: 'cardCount', format: 'number' },
    ],
  },

  integrations: { trello: 'trello' },

  cache: {
    ttl: 60_000,
    maxSize: 200,
  },

  actions: [
    {
      id: 'create_list',
      label: 'Create List',
      description: 'Create a new list on a Trello board',
      icon: 'plus',
      scope: 'type',
      aiHint:
        'Use when the user wants to create a new column/list on a board. ' +
        'Call list_boards first to find a valid boardId.',
      inputSchema: createListInput,
      handler: async (
        params: EntityActionParams<TrelloList>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };

        const input = params.input as z.infer<typeof createListInput>;
        ctx.logger.info('Creating Trello list', { boardId: input.boardId, name: input.name });

        const list = await client.lists.createList({
          name: input.name,
          idBoard: input.boardId,
          pos: input.pos ?? 'bottom',
        } as any);

        return {
          success: true,
          message: `Created list "${input.name}"`,
          entity: listToEntity(list as any),
        };
      },
    },

    {
      id: 'update_list',
      label: 'Update List',
      description: 'Rename or reposition a list',
      icon: 'edit',
      scope: 'instance',
      aiHint: 'Use when the user wants to rename a list or change its position on the board.',
      inputSchema: updateListInput,
      handler: async (
        params: EntityActionParams<TrelloList>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof updateListInput>;
        ctx.logger.info('Updating Trello list', { listId: params.entity.id });

        const updateData: Record<string, unknown> = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.pos !== undefined) updateData.pos = input.pos;

        const list = await client.lists.updateList({ id: params.entity.id, ...updateData } as any);
        return {
          success: true,
          message: `Updated list "${input.name ?? params.entity.title}"`,
          entity: listToEntity(list as any, params.entity.boardName),
        };
      },
    },

    {
      id: 'archive_list',
      label: 'Archive List',
      description: 'Archive (close) a list and all its cards',
      icon: 'archive',
      scope: 'instance',
      aiHint:
        'Use when the user wants to archive a list. ' +
        'This hides the list and all its cards from the board view.',
      handler: async (
        params: EntityActionParams<TrelloList>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        ctx.logger.info('Archiving Trello list', { listId: params.entity.id });
        await client.lists.updateList({ id: params.entity.id, closed: true } as any);
        return {
          success: true,
          message: `Archived list "${params.entity.title}"`,
        };
      },
    },
  ],

  resolve: async ({ id }: { id: string }, ctx) => {
    const client = getClient(ctx);
    if (!client) return null;

    ctx.logger.info('Resolving Trello list', { listId: id });
    try {
      const list = await client.lists.getList({ id, cards: 'open' } as any);
      const cards = (list as any).cards ?? [];
      return listToEntity(list as any, undefined, cards.length);
    } catch (err) {
      ctx.logger.error('Failed to resolve Trello list', {
        listId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  search: async (query: string, options, ctx) => {
    const client = getClient(ctx);
    if (!client) return [];

    const limit = options?.limit ?? 10;
    ctx.logger.info('Searching Trello lists', { query, limit });

    try {
      // Lists don't have a direct search API; we scan the user's first few boards
      const boards = await client.members.getMemberBoards({ id: 'me', filter: 'open' } as any);
      const firstBoards = (boards as any[]).slice(0, 5);
      const lowerQuery = query.toLowerCase();

      const allLists: TrelloList[] = [];
      for (const board of firstBoards) {
        if (allLists.length >= limit) break;
        try {
          const lists = await client.boards.getBoardLists({ id: board.id, filter: 'open' } as any);
          for (const list of lists as any[]) {
            if (!query || list.name?.toLowerCase().includes(lowerQuery)) {
              allLists.push(listToEntity(list, board.name));
              if (allLists.length >= limit) break;
            }
          }
        } catch {
          // Skip boards we can't access
        }
      }
      return allLists;
    } catch (err) {
      ctx.logger.error('Failed to search Trello lists', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});

export default TrelloListEntity;
