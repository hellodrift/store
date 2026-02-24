/**
 * trello_board entity — Trello boards as linkable Drift entities.
 *
 * Actions: create_board (type-scope), update_board, archive_board,
 * create_list (instance-scope).
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';
import type { TrelloClient } from 'trello.js';

// ---------- Schema ----------

const trelloListSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  pos: z.number().optional(),
  closed: z.boolean().optional(),
});

const trelloLabelSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
});

const trelloBoardSchema = z.object({
  id: z.string(),
  type: z.literal('trello_board'),
  uri: z.string(),
  title: z.string(),
  desc: z.string().optional(),
  closed: z.boolean().optional(),
  idOrganization: z.string().optional(),
  url: z.string().optional(),
  shortUrl: z.string().optional(),
  memberCount: z.number().optional(),
  listCount: z.number().optional(),
  lists: z.array(trelloListSummarySchema).optional(),
  labels: z.array(trelloLabelSummarySchema).optional(),
  prefs: z.object({
    background: z.string().optional(),
    backgroundColor: z.string().nullable().optional(),
  }).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

type TrelloBoard = z.infer<typeof trelloBoardSchema>;

// ---------- Helpers ----------

function getClient(ctx: EntityResolverContext): TrelloClient | null {
  return (ctx as any).integrations?.trello?.client ?? null;
}

function boardToEntity(board: any): TrelloBoard {
  const lists = (board.lists ?? []) as any[];
  const labels = (board.labels ?? []) as any[];
  const members = (board.members ?? []) as any[];

  return {
    id: board.id,
    type: 'trello_board',
    uri: `@drift//trello_board/${board.id}`,
    title: board.name ?? '(Untitled board)',
    desc: board.desc || undefined,
    closed: board.closed ?? false,
    idOrganization: board.idOrganization ?? undefined,
    url: board.url,
    shortUrl: board.shortUrl,
    memberCount: members.length || board.memberships?.length || undefined,
    listCount: lists.length || undefined,
    lists: lists
      .filter((l: any) => !l.closed)
      .sort((a: any, b: any) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((l: any) => ({
        id: l.id,
        name: l.name,
        pos: l.pos ?? undefined,
        closed: l.closed ?? false,
      })),
    labels: labels
      .filter((l: any) => l.name || l.color)
      .map((l: any) => ({
        id: l.id,
        name: l.name ?? null,
        color: l.color ?? null,
      })),
    prefs: board.prefs ? {
      background: board.prefs.background ?? undefined,
      backgroundColor: board.prefs.backgroundColor ?? null,
    } : undefined,
  };
}

// ---------- Action input schemas ----------

const createBoardInput = z.object({
  name: z.string().describe('Board name.'),
  desc: z.string().optional().describe('Board description.'),
  idOrganization: z.string().optional().describe('Workspace/organization ID to create the board in.'),
  defaultLists: z.boolean().optional().describe('Create default lists (To Do, Doing, Done). Default: true.'),
});

const createListInput = z.object({
  name: z.string().describe('List name (e.g. "Backlog", "In Progress", "Done").'),
  pos: z.enum(['top', 'bottom']).optional().describe('Position on the board. Default: bottom.'),
});

const updateBoardInput = z.object({
  name: z.string().optional().describe('New board name.'),
  desc: z.string().optional().describe('New board description.'),
});

// ---------- Entity definition ----------

const TrelloBoardEntity = defineEntity({
  type: 'trello_board',
  displayName: 'Trello Board',
  description: 'A Trello board containing lists and cards',
  icon: 'layout',

  schema: trelloBoardSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '\u{1F4CB}',
    colors: {
      bg: '#026AA7',
      text: '#FFFFFF',
      border: '#004F7C',
    },
    description: 'Trello boards',
    outputFields: [
      { key: 'lists', label: 'Lists', metadataPath: 'listCount', format: 'number' },
      { key: 'members', label: 'Members', metadataPath: 'memberCount', format: 'number' },
      { key: 'url', label: 'URL', metadataPath: 'url', format: 'string' },
    ],
  },

  integrations: { trello: 'trello' },

  cache: {
    ttl: 60_000,
    maxSize: 50,
  },

  actions: [
    {
      id: 'create_board',
      label: 'Create Board',
      description: 'Create a new Trello board',
      icon: 'plus',
      scope: 'type',
      aiHint:
        'Use when the user wants to create a new Trello board. ' +
        'By default, creates three lists: To Do, Doing, Done (set defaultLists: false to skip).',
      inputSchema: createBoardInput,
      handler: async (
        params: EntityActionParams<TrelloBoard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };

        const input = params.input as z.infer<typeof createBoardInput>;
        ctx.logger.info('Creating Trello board', { name: input.name });

        const board = await client.boards.createBoard({
          name: input.name,
          desc: input.desc,
          idOrganization: input.idOrganization,
          defaultLists: input.defaultLists !== false,
        } as any);

        return {
          success: true,
          message: `Created board "${(board as any).name}"`,
          entity: boardToEntity(board),
        };
      },
    },

    {
      id: 'update_board',
      label: 'Update Board',
      description: 'Update board name or description',
      icon: 'edit',
      scope: 'instance',
      aiHint: 'Use when the user wants to rename a board or update its description.',
      inputSchema: updateBoardInput,
      handler: async (
        params: EntityActionParams<TrelloBoard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof updateBoardInput>;
        ctx.logger.info('Updating Trello board', { boardId: params.entity.id });

        const updateData: Record<string, unknown> = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.desc !== undefined) updateData.desc = input.desc;

        const board = await client.boards.updateBoard({ id: params.entity.id, ...updateData } as any);
        return {
          success: true,
          message: `Updated board "${input.name ?? params.entity.title}"`,
          entity: boardToEntity(board),
        };
      },
    },

    {
      id: 'archive_board',
      label: 'Archive Board',
      description: 'Archive (close) a Trello board',
      icon: 'archive',
      scope: 'instance',
      aiHint: 'Use when the user wants to archive a board. This is reversible.',
      handler: async (
        params: EntityActionParams<TrelloBoard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        ctx.logger.info('Archiving Trello board', { boardId: params.entity.id });
        await client.boards.updateBoard({ id: params.entity.id, closed: true } as any);
        return {
          success: true,
          message: `Archived board "${params.entity.title}"`,
        };
      },
    },

    {
      id: 'create_list',
      label: 'Create List',
      description: 'Create a new list (column) on this board',
      icon: 'columns',
      scope: 'instance',
      aiHint: 'Use when the user wants to add a new column/list to a board.',
      inputSchema: createListInput,
      handler: async (
        params: EntityActionParams<TrelloBoard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof createListInput>;
        ctx.logger.info('Creating Trello list', { boardId: params.entity.id, name: input.name });

        const list = await client.lists.createList({
          name: input.name,
          idBoard: params.entity.id,
          pos: input.pos ?? 'bottom',
        } as any);

        return {
          success: true,
          message: `Created list "${input.name}" on board "${params.entity.title}"`,
          data: {
            listId: (list as any).id,
            listName: (list as any).name,
            boardId: params.entity.id,
          },
        };
      },
    },
  ],

  resolve: async ({ id }: { id: string }, ctx) => {
    const client = getClient(ctx);
    if (!client) return null;

    ctx.logger.info('Resolving Trello board', { boardId: id });
    try {
      const board = await client.boards.getBoard({
        id,
        lists: 'open',
        members: 'all',
        labels: 'all',
      } as any);
      return boardToEntity(board);
    } catch (err) {
      ctx.logger.error('Failed to resolve Trello board', {
        boardId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  search: async (query: string, options, ctx) => {
    const client = getClient(ctx);
    if (!client) return [];

    const limit = options?.limit ?? 10;
    ctx.logger.info('Searching Trello boards', { query, limit });

    try {
      const boards = await client.members.getMemberBoards({ id: 'me', filter: 'open' } as any);
      const lowerQuery = query.toLowerCase();
      return (boards as any[])
        .filter((b: any) => !query || b.name?.toLowerCase().includes(lowerQuery))
        .slice(0, limit)
        .map(boardToEntity);
    } catch (err) {
      ctx.logger.error('Failed to search Trello boards', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});

export default TrelloBoardEntity;
