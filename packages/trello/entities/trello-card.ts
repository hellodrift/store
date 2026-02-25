/**
 * trello_card entity — Full Trello card integration with actions.
 *
 * Uses the `trello` integration for auth and discovery.
 * Primary entity for the Trello plugin — maps to Trello cards,
 * which are the core work items (equivalent to Linear issues).
 *
 * Actions: create_card, update_card, move_card, archive_card, delete_card,
 * add_comment, assign_member, unassign_member, add_label, remove_label,
 * set_due_date, complete_due_date.
 */

import { z } from 'zod';
import { defineEntity } from '@drift/entity-sdk';
import type { EntityResolverContext, EntityActionParams, EntityActionResult } from '@drift/entity-sdk';
import type { TrelloClient } from 'trello.js';

// ---------- Color token map ----------

const COLOR_TOKEN_MAP: Record<string, string> = {
  red: 'error',
  orange: 'warning',
  yellow: 'warning',
  green: 'success',
  blue: 'brand',
  purple: 'ai',
  pink: 'error',
  sky: 'info',
  lime: 'success',
  black: 'muted',
};

function colorToToken(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  return COLOR_TOKEN_MAP[color];
}

// ---------- Schema ----------

const trelloCheckItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(['complete', 'incomplete']),
  pos: z.number().optional(),
});

const trelloChecklistSchema = z.object({
  id: z.string(),
  name: z.string(),
  pos: z.number().optional(),
  checkItems: z.array(trelloCheckItemSchema),
});

const trelloMemberSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  initials: z.string().optional(),
});

const trelloLabelSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
});

const trelloCardSchema = z.object({
  id: z.string(),
  type: z.literal('trello_card'),
  uri: z.string(),
  title: z.string(),
  desc: z.string().optional(),
  idList: z.string(),
  listName: z.string().optional(),
  idBoard: z.string(),
  boardName: z.string().optional(),
  idMembers: z.array(z.string()).optional(),
  memberNames: z.string().optional(),
  members: z.array(trelloMemberSchema).optional(),
  labels: z.array(trelloLabelSchema).optional(),
  labelNames: z.string().optional(),
  due: z.string().nullable().optional(),
  dueComplete: z.boolean().optional(),
  start: z.string().nullable().optional(),
  closed: z.boolean().optional(),
  url: z.string().optional(),
  shortUrl: z.string().optional(),
  shortLink: z.string().optional(),
  pos: z.number().optional(),
  checkItemsTotal: z.number().optional(),
  checkItemsChecked: z.number().optional(),
  checklistCount: z.number().optional(),
  checklists: z.array(trelloChecklistSchema).optional(),
  commentCount: z.number().optional(),
  dateLastActivity: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

type TrelloCard = z.infer<typeof trelloCardSchema>;

// ---------- Helpers ----------

function getClient(ctx: EntityResolverContext): TrelloClient | null {
  return (ctx as any).integrations?.trello?.client ?? null;
}

function cardToEntity(card: any, listName?: string, boardName?: string): TrelloCard {
  const labels = (card.labels ?? []) as any[];
  const members = (card.members ?? []) as any[];
  const checklists = (card.checklists ?? []) as any[];

  const labelNames = labels
    .filter((l: any) => l.name)
    .map((l: any) => l.name)
    .join(', ');

  const memberNames = members
    .map((m: any) => m.fullName ?? m.username ?? m.id)
    .join(', ');

  // Checklist progress from either card.checklists or card.badges
  const checkItemsTotal =
    (card.badges?.checkItems ?? checklists.reduce((s: number, cl: any) => s + (cl.checkItems?.length ?? 0), 0));
  const checkItemsChecked =
    (card.badges?.checkItemsChecked ?? checklists.reduce((s: number, cl: any) =>
      s + (cl.checkItems?.filter((i: any) => i.state === 'complete').length ?? 0), 0));

  return {
    id: card.id,
    type: 'trello_card',
    uri: `@drift//trello_card/${card.id}`,
    title: card.name ?? '(Untitled)',
    desc: card.desc || undefined,
    idList: card.idList,
    listName: listName ?? card.list?.name ?? undefined,
    idBoard: card.idBoard,
    boardName: boardName ?? card.board?.name ?? undefined,
    idMembers: card.idMembers ?? [],
    memberNames: memberNames || undefined,
    members: members.map((m: any) => ({
      id: m.id,
      username: m.username ?? '',
      fullName: m.fullName ?? m.username ?? m.id,
      initials: m.initials ?? undefined,
    })),
    labels: labels.map((l: any) => ({
      id: l.id,
      name: l.name ?? null,
      color: l.color ?? null,
    })),
    labelNames: labelNames || undefined,
    due: card.due ?? null,
    dueComplete: card.dueComplete ?? false,
    start: card.start ?? null,
    closed: card.closed ?? false,
    url: card.url,
    shortUrl: card.shortUrl,
    shortLink: card.shortLink,
    pos: card.pos ?? undefined,
    checkItemsTotal: checkItemsTotal || undefined,
    checkItemsChecked: checkItemsChecked || undefined,
    checklistCount: checklists.length || (checkItemsTotal ? 1 : undefined),
    checklists: checklists.map((cl: any) => ({
      id: cl.id,
      name: cl.name,
      pos: cl.pos ?? undefined,
      checkItems: (cl.checkItems ?? []).map((item: any) => ({
        id: item.id,
        name: item.name,
        state: item.state === 'complete' ? 'complete' : 'incomplete',
        pos: item.pos ?? undefined,
      })),
    })),
    commentCount: card.badges?.comments ?? undefined,
    dateLastActivity: card.dateLastActivity ?? undefined,
    createdAt: card.dateLastActivity ? new Date(card.dateLastActivity) : undefined,
    updatedAt: card.dateLastActivity ? new Date(card.dateLastActivity) : undefined,
  };
}

async function fetchCardFull(client: TrelloClient, id: string): Promise<TrelloCard | null> {
  try {
    const card = await client.cards.getCard({ id, checklists: 'all', members: true, fields: 'all' } as any);

    // Enrich with board/list names (not included in raw card response)
    let boardName: string | undefined;
    let listName: string | undefined;
    if ((card as any).idBoard) {
      try {
        const board = await (client as any).boards.getBoard({ id: (card as any).idBoard, lists: 'open', fields: 'name' });
        boardName = board.name;
        listName = (board.lists ?? []).find((l: any) => l.id === (card as any).idList)?.name;
      } catch { /* Board fetch failed, IDs used as fallback */ }
    }

    return cardToEntity(card as any, listName, boardName);
  } catch {
    return null;
  }
}

// ---------- Action input schemas ----------

const createCardInput = z.object({
  idList: z.string().describe(
    'List ID to create the card in. Call list_boards then list_lists(boardId) to find a valid idList.',
  ),
  name: z.string().describe('Card title.'),
  desc: z.string().optional().describe('Card description (plain text or markdown).'),
  due: z.string().optional().describe('Due date in ISO 8601 format (e.g. "2025-06-30T17:00:00.000Z").'),
  dueReminder: z.number().int().optional().describe(
    'Minutes before due date to send reminder. Options: -1 (none), 0, 5, 10, 15, 30, 60, 120, 1440, 2880, 4320.',
  ),
  start: z.string().optional().describe('Start date in ISO 8601 format.'),
  idMembers: z.array(z.string()).optional().describe(
    'Member IDs to assign. Call list_members(boardId) to find valid IDs.',
  ),
  idLabels: z.array(z.string()).optional().describe(
    'Label IDs to apply. Call list_labels(boardId) to find valid IDs.',
  ),
  pos: z.enum(['top', 'bottom']).optional().describe('Position in the list. Default: bottom.'),
});

const updateCardInput = z.object({
  name: z.string().optional().describe('New card title.'),
  desc: z.string().optional().describe('New card description.'),
  pos: z.union([z.number(), z.enum(['top', 'bottom'])]).optional().describe('New position in the list.'),
});

const moveCardInput = z.object({
  idList: z.string().describe(
    'Target list ID to move the card to. Call list_boards then list_lists(boardId) to find a valid idList.',
  ),
  pos: z.enum(['top', 'bottom']).optional().describe('Position in the target list. Default: bottom.'),
});

const assignMemberInput = z.object({
  memberId: z.string().describe(
    'Member ID to add to the card. Call list_members(boardId) to find valid IDs.',
  ),
});

const unassignMemberInput = z.object({
  memberId: z.string().describe('Member ID to remove from the card.'),
});

const addLabelInput = z.object({
  labelId: z.string().describe(
    'Label ID to add to the card. Call list_labels(boardId) to find valid IDs.',
  ),
});

const removeLabelInput = z.object({
  labelId: z.string().describe('Label ID to remove from the card.'),
});

const setDueDateInput = z.object({
  due: z.string().nullable().describe(
    'Due date in ISO 8601 format, or null to clear the due date.',
  ),
  dueReminder: z.number().int().optional().describe(
    'Minutes before due date for reminder. Options: -1 (none), 0, 5, 10, 15, 30, 60, 120, 1440, 2880, 4320.',
  ),
});

const completeDueDateInput = z.object({
  complete: z.boolean().describe('true to mark the due date as complete, false to unmark.'),
});

const addCommentInput = z.object({
  text: z.string().describe('Comment text to add to the card.'),
});

const addChecklistInput = z.object({
  name: z.string().describe('Name for the new checklist.'),
});

const addChecklistItemInput = z.object({
  checklistId: z.string().describe(
    'ID of the checklist to add the item to. Call list_checklists(cardId) to find valid checklistIds.',
  ),
  name: z.string().describe('Text/name of the new checklist item.'),
  pos: z.enum(['top', 'bottom']).optional().describe('Position in the checklist. Default: bottom.'),
});

const completeChecklistItemInput = z.object({
  checkItemId: z.string().describe(
    'ID of the checklist item to update. Call list_checklists(cardId) and look inside checkItems to find the checkItemId.',
  ),
  complete: z.boolean().describe('true to mark the item as complete, false to mark it as incomplete.'),
});

// ---------- Entity definition ----------

const TrelloCardEntity = defineEntity({
  type: 'trello_card',
  displayName: 'Trello Card',
  description: 'A card from a Trello board',
  icon: 'layout',

  schema: trelloCardSchema,

  uriPath: {
    segments: ['id'] as const,
    parse: (segments: string[]) => ({ id: segments[0] }),
    format: ({ id }: { id: string }) => id,
  },

  display: {
    emoji: '\u{1F4CC}',
    colors: {
      bg: '#0079BF',
      text: '#FFFFFF',
      border: '#0065A3',
    },
    description: 'Trello board cards',
    filterDescriptions: [
      { name: 'listName', type: 'string', description: 'Filter by list/column name' },
      { name: 'labelNames', type: 'string', description: 'Filter by label name' },
      { name: 'memberNames', type: 'string', description: 'Filter by assigned member name or username' },
    ],
    outputFields: [
      { key: 'list', label: 'List', metadataPath: 'listName', format: 'string' },
      { key: 'board', label: 'Board', metadataPath: 'boardName', format: 'string' },
      { key: 'members', label: 'Members', metadataPath: 'memberNames', format: 'string' },
      { key: 'labels', label: 'Labels', metadataPath: 'labelNames', format: 'string' },
      { key: 'due', label: 'Due Date', metadataPath: 'due', format: 'string' },
      { key: 'dueComplete', label: 'Due Complete', metadataPath: 'dueComplete', format: 'boolean' },
      { key: 'url', label: 'URL', metadataPath: 'url', format: 'string' },
    ],
  },

  paletteFilters: [
    {
      key: 'listName',
      label: 'List',
      aliases: ['list', 'l'],
      values: [],
      fetchValues: async (ctx: EntityResolverContext) => {
        const client = getClient(ctx);
        const boardId = await ctx.storage.get('board_id');
        if (!client || !boardId) return [];
        try {
          const lists = await client.boards.getBoardLists({ id: boardId, filter: 'open' });
          return (lists as any[])
            .sort((a: any, b: any) => (a.pos ?? 0) - (b.pos ?? 0))
            .map((l: any) => ({
              id: l.name.toLowerCase().replace(/\s+/g, '-'),
              label: l.name,
            }));
        } catch {
          return [];
        }
      },
    },
    {
      key: 'labelNames',
      label: 'Label',
      aliases: ['label', 'tag'],
      values: [],
      fetchValues: async (ctx: EntityResolverContext) => {
        const client = getClient(ctx);
        const boardId = await ctx.storage.get('board_id');
        if (!client || !boardId) return [];
        try {
          const labels = await client.boards.getBoardLabels({ id: boardId });
          return (labels as any[])
            .filter((l: any) => l.name)
            .map((l: any) => ({
              id: l.name.toLowerCase().replace(/\s+/g, '-'),
              label: l.name,
              colorToken: colorToToken(l.color),
            }));
        } catch {
          return [];
        }
      },
    },
    {
      key: 'memberNames',
      label: 'Member',
      aliases: ['member', 'm', 'assigned'],
      values: [],
      fetchValues: async (ctx: EntityResolverContext) => {
        const client = getClient(ctx);
        const boardId = await ctx.storage.get('board_id');
        if (!client || !boardId) return [];
        try {
          const members = await client.boards.getBoardMembers({ id: boardId });
          return (members as any[]).map((m: any) => ({
            id: m.username,
            label: m.fullName,
          }));
        } catch {
          return [];
        }
      },
    },
  ],

  integrations: { trello: 'trello' },

  cache: {
    ttl: 30_000,
    maxSize: 100,
  },

  actions: [
    // ── Type-scope ────────────────────────────────────────────────────────────
    {
      id: 'create_card',
      label: 'Create Card',
      description: 'Create a new Trello card on a list',
      icon: 'plus',
      scope: 'type',
      aiHint:
        'Use when the user wants to create a new Trello card. ' +
        'IMPORTANT: First call list_boards to find a boardId, then call list_lists(boardId) to get a valid idList. ' +
        'Optionally call list_members(boardId) for idMembers and list_labels(boardId) for idLabels.',
      inputSchema: createCardInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };

        const input = params.input as z.infer<typeof createCardInput>;
        ctx.logger.info('Creating Trello card', { name: input.name, idList: input.idList });

        const card = await client.cards.createCard({
          idList: input.idList,
          name: input.name,
          desc: input.desc,
          due: input.due,
          dueReminder: input.dueReminder,
          start: input.start,
          idMembers: input.idMembers?.join(','),
          idLabels: input.idLabels?.join(','),
          pos: input.pos ?? 'bottom',
        } as any);

        const entity = await fetchCardFull(client, (card as any).id);
        return {
          success: true,
          message: `Created card "${(card as any).name}"`,
          entity: entity ?? undefined,
        };
      },
    },

    // ── Instance-scope ────────────────────────────────────────────────────────
    {
      id: 'update_card',
      label: 'Update Card',
      description: 'Update the title, description, or position of a card',
      icon: 'edit',
      scope: 'instance',
      aiHint: 'Use when the user wants to rename a card, update its description, or reorder it within its list.',
      inputSchema: updateCardInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof updateCardInput>;
        ctx.logger.info('Updating Trello card', { cardId: params.entity.id });

        const updateData: Record<string, unknown> = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.desc !== undefined) updateData.desc = input.desc;
        if (input.pos !== undefined) updateData.pos = input.pos;

        await client.cards.updateCard({ id: params.entity.id, ...updateData } as any);
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: `Updated card "${input.name ?? params.entity.title}"`,
          entity: entity ?? undefined,
        };
      },
    },

    {
      id: 'move_card',
      label: 'Move Card',
      description: 'Move card to a different list or board',
      icon: 'arrow-right',
      scope: 'instance',
      aiHint:
        'Use when the user wants to move a card to a different column/list (e.g. from "To Do" to "In Progress"). ' +
        'Call list_boards then list_lists(boardId) to find the target idList.',
      inputSchema: moveCardInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof moveCardInput>;
        ctx.logger.info('Moving Trello card', { cardId: params.entity.id, idList: input.idList });

        await client.cards.updateCard({
          id: params.entity.id,
          idList: input.idList,
          pos: input.pos ?? 'bottom',
        } as any);
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: `Moved card "${params.entity.title}"`,
          entity: entity ?? undefined,
        };
      },
    },

    {
      id: 'archive_card',
      label: 'Archive Card',
      description: 'Archive a card (reversible soft-delete)',
      icon: 'archive',
      scope: 'instance',
      aiHint:
        'Use when the user wants to archive/hide a card. This is reversible. ' +
        'Prefer this over delete_card for most use cases.',
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        ctx.logger.info('Archiving Trello card', { cardId: params.entity.id });
        await client.cards.updateCard({ id: params.entity.id, closed: true } as any);
        return {
          success: true,
          message: `Archived card "${params.entity.title}"`,
        };
      },
    },

    {
      id: 'delete_card',
      label: 'Delete Card',
      description: 'Permanently delete a Trello card',
      icon: 'trash',
      scope: 'instance',
      aiHint:
        'Use when the user wants to permanently delete a card. This action is irreversible. ' +
        'Prefer archive_card if the user just wants to hide it.',
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        ctx.logger.info('Deleting Trello card', { cardId: params.entity.id });
        await client.cards.deleteCard({ id: params.entity.id });
        return {
          success: true,
          message: `Deleted card "${params.entity.title}"`,
        };
      },
    },

    {
      id: 'add_comment',
      label: 'Add Comment',
      description: 'Add a comment to a Trello card',
      icon: 'message-circle',
      scope: 'instance',
      aiHint: 'Use when the user wants to comment on a card.',
      inputSchema: addCommentInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof addCommentInput>;
        ctx.logger.info('Adding comment to Trello card', { cardId: params.entity.id });
        await client.cards.addCardComment({ id: params.entity.id, text: input.text } as any);
        return {
          success: true,
          message: `Added comment to card "${params.entity.title}"`,
        };
      },
    },

    {
      id: 'assign_member',
      label: 'Assign Member',
      description: 'Add a member to a Trello card',
      icon: 'user-plus',
      scope: 'instance',
      aiHint: 'Use to assign a member to a card. Call list_members(boardId) to find the memberId.',
      inputSchema: assignMemberInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof assignMemberInput>;
        ctx.logger.info('Assigning member to Trello card', { cardId: params.entity.id, memberId: input.memberId });
        await (client.cards as any).addCardMemberIdMember({ id: params.entity.id, value: input.memberId });
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: `Assigned member to card "${params.entity.title}"`,
          entity: entity ?? undefined,
        };
      },
    },

    {
      id: 'unassign_member',
      label: 'Unassign Member',
      description: 'Remove a member from a Trello card',
      icon: 'user-minus',
      scope: 'instance',
      aiHint: 'Use to remove a member from a card. Call list_members(boardId) to find the memberId.',
      inputSchema: unassignMemberInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof unassignMemberInput>;
        ctx.logger.info('Unassigning member from Trello card', { cardId: params.entity.id, memberId: input.memberId });
        await (client.cards as any).deleteCardMemberIdMember({ id: params.entity.id, idMember: input.memberId });
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: `Removed member from card "${params.entity.title}"`,
          entity: entity ?? undefined,
        };
      },
    },

    {
      id: 'add_label',
      label: 'Add Label',
      description: 'Add a label to a card without removing existing labels',
      icon: 'tag',
      scope: 'instance',
      aiHint: 'Use to add a label to a card without removing existing labels. Call list_labels(boardId) to find labelId.',
      inputSchema: addLabelInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof addLabelInput>;
        ctx.logger.info('Adding label to Trello card', { cardId: params.entity.id, labelId: input.labelId });
        await (client.cards as any).addCardLabelIdLabel({ id: params.entity.id, value: input.labelId });
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: `Added label to card "${params.entity.title}"`,
          entity: entity ?? undefined,
        };
      },
    },

    {
      id: 'remove_label',
      label: 'Remove Label',
      description: 'Remove a label from a card without affecting other labels',
      icon: 'x',
      scope: 'instance',
      aiHint: 'Use to remove a label from a card without affecting other labels.',
      inputSchema: removeLabelInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof removeLabelInput>;
        ctx.logger.info('Removing label from Trello card', { cardId: params.entity.id, labelId: input.labelId });
        await (client.cards as any).deleteCardLabel({ id: params.entity.id, idLabel: input.labelId });
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: `Removed label from card "${params.entity.title}"`,
          entity: entity ?? undefined,
        };
      },
    },

    {
      id: 'set_due_date',
      label: 'Set Due Date',
      description: 'Set or clear the due date on a card',
      icon: 'calendar',
      scope: 'instance',
      aiHint:
        'Use to set a due date on a card. Pass due=null to clear the due date. ' +
        'dueReminder sets a reminder in minutes before the due date.',
      inputSchema: setDueDateInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof setDueDateInput>;
        ctx.logger.info('Setting due date on Trello card', { cardId: params.entity.id, due: input.due });
        const updateData: Record<string, unknown> = { due: input.due };
        if (input.dueReminder !== undefined) updateData.dueReminder = input.dueReminder;
        await client.cards.updateCard({ id: params.entity.id, ...updateData } as any);
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: input.due
            ? `Set due date on card "${params.entity.title}"`
            : `Cleared due date on card "${params.entity.title}"`,
          entity: entity ?? undefined,
        };
      },
    },

    {
      id: 'complete_due_date',
      label: 'Mark Due Complete',
      description: 'Toggle the due date completion state on a card',
      icon: 'check-circle',
      scope: 'instance',
      aiHint: 'Use to mark a card\'s due date as complete or incomplete.',
      inputSchema: completeDueDateInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof completeDueDateInput>;
        ctx.logger.info('Marking due date complete on Trello card', { cardId: params.entity.id, complete: input.complete });
        await client.cards.updateCard({ id: params.entity.id, dueComplete: input.complete } as any);
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: input.complete
            ? `Marked due date complete on card "${params.entity.title}"`
            : `Unmarked due date on card "${params.entity.title}"`,
          entity: entity ?? undefined,
        };
      },
    },

    {
      id: 'add_checklist',
      label: 'Add Checklist',
      description: 'Add a new checklist to a card',
      icon: 'check-square',
      scope: 'instance',
      aiHint: 'Use when the user wants to add a new checklist (todo list) to a card. Provide a name for the checklist.',
      inputSchema: addChecklistInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof addChecklistInput>;
        ctx.logger.info('Adding checklist to Trello card', { cardId: params.entity.id, name: input.name });
        await client.checklists.createChecklist({ idCard: params.entity.id, name: input.name, pos: 'bottom' } as any);
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: `Added checklist "${input.name}" to card "${params.entity.title}"`,
          entity: entity ?? undefined,
        };
      },
    },

    {
      id: 'add_checklist_item',
      label: 'Add Checklist Item',
      description: 'Add a new item to an existing checklist on a card',
      icon: 'plus-circle',
      scope: 'instance',
      aiHint:
        'Use when the user wants to add a new task or item to an existing checklist. ' +
        'Call list_checklists(cardId) to get the checklistId.',
      inputSchema: addChecklistItemInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof addChecklistItemInput>;
        ctx.logger.info('Adding checklist item', { cardId: params.entity.id, checklistId: input.checklistId, name: input.name });
        await client.checklists.createChecklistCheckItem({
          id: input.checklistId,
          name: input.name,
          pos: input.pos ?? 'bottom',
        } as any);
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: `Added "${input.name}" to checklist`,
          entity: entity ?? undefined,
        };
      },
    },

    {
      id: 'complete_checklist_item',
      label: 'Complete Checklist Item',
      description: 'Mark a checklist item as complete or incomplete',
      icon: 'check',
      scope: 'instance',
      aiHint:
        'Use when the user wants to check off or uncheck a checklist item. ' +
        'Call list_checklists(cardId) and look inside checkItems[] to find the checkItemId.',
      inputSchema: completeChecklistItemInput,
      handler: async (
        params: EntityActionParams<TrelloCard>,
        ctx: EntityResolverContext,
      ): Promise<EntityActionResult> => {
        const client = getClient(ctx);
        if (!client) return { success: false, message: 'No API key or token configured' };
        if (!params.entity) return { success: false, message: 'No entity provided' };

        const input = params.input as z.infer<typeof completeChecklistItemInput>;
        ctx.logger.info('Updating checklist item state', { cardId: params.entity.id, checkItemId: input.checkItemId, complete: input.complete });
        await client.cards.updateCardCheckItem({
          id: params.entity.id,
          idCheckItem: input.checkItemId,
          state: input.complete ? 'complete' : 'incomplete',
        } as any);
        const entity = await fetchCardFull(client, params.entity.id);
        return {
          success: true,
          message: input.complete ? 'Marked checklist item as complete' : 'Marked checklist item as incomplete',
          entity: entity ?? undefined,
        };
      },
    },
  ],

  resolve: async ({ id }: { id: string }, ctx) => {
    const client = getClient(ctx);
    if (!client) return null;

    ctx.logger.info('Resolving Trello card', { cardId: id });
    try {
      return await fetchCardFull(client, id);
    } catch (err) {
      ctx.logger.error('Failed to resolve Trello card', {
        cardId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  search: async (query: string, options, ctx) => {
    const client = getClient(ctx);
    if (!client) return [];

    const limit = options?.limit ?? 10;
    ctx.logger.info('Searching Trello cards', { query, limit });

    try {
      const results = await (client as any).search.getSearch({
        query: query || 'is:open',
        modelTypes: 'cards',
        cards: { limit },
      });

      const cards = (results as any).cards ?? [];
      return cards.map((c: any) => cardToEntity(c));
    } catch (err) {
      ctx.logger.error('Failed to search Trello cards', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },
});

export default TrelloCardEntity;
