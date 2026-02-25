/**
 * Trello Integration — Shared auth + client + discovery/mutation methods.
 *
 * Owns the TrelloClient lifecycle and exposes discovery and mutation operations
 * that any Trello entity can call.
 *
 * Auth (in priority order):
 * 1. Atlassian OAuth 2.0 3LO (preferred) — authorization_code + PKCE via
 *    id.atlassian.com. The access token is passed as a Bearer token to the
 *    Trello REST API (supported since Atlassian unified auth).
 * 2. API key + token fallback — users obtain from:
 *    https://trello.com/power-ups/admin (API key)
 *    https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key={KEY}
 */

import { z } from 'zod';
import { defineIntegration } from '@drift/entity-sdk';
import { TrelloClient } from 'trello.js';

// ---------- Input schemas ----------

const listListsInput = z.object({
  boardId: z.string().describe('Board ID. Call list_boards first to get a valid boardId.'),
});

const listMembersInput = z.object({
  boardId: z.string().optional().describe('Board ID to list members for. Omit to return only the authenticated user info.'),
});

const listLabelsInput = z.object({
  boardId: z.string().describe('Board ID. Call list_boards first to get a valid boardId.'),
});

const listChecklistsInput = z.object({
  cardId: z.string().describe('Card ID. Call search_cards or use a known trello_card entity ID.'),
});

const addChecklistInput = z.object({
  cardId: z.string().describe('Card ID to add the checklist to.'),
  name: z.string().describe('Checklist name (e.g. "Steps", "Acceptance Criteria").'),
  pos: z.enum(['top', 'bottom']).optional().describe('Position on the card. Default: bottom.'),
});

const addChecklistItemInput = z.object({
  checklistId: z.string().describe('Checklist ID. Call list_checklists to find checklist IDs.'),
  name: z.string().describe('Check item label/name.'),
  pos: z.enum(['top', 'bottom']).optional().describe('Position in the checklist. Default: bottom.'),
});

const completeChecklistItemInput = z.object({
  cardId: z.string().describe('Card ID that contains the checklist item.'),
  checkItemId: z.string().describe('Check item ID. Call list_checklists to find check item IDs.'),
  complete: z.boolean().describe('true to mark complete, false to mark incomplete.'),
});

const searchCardsInput = z.object({
  query: z.string().describe(
    'Trello search query. Supports operators: @me (assigned to me), @username, ' +
    'label:"Bug", due:week, due:overdue, board:name, list:name, is:open, has:attachments. ' +
    'Example: "@me due:week label:P1"',
  ),
  boardId: z.string().optional().describe('Restrict search to a specific board ID. Call list_boards to find IDs.'),
  limit: z.number().int().min(1).max(100).optional().describe('Max cards to return (default 20, max 100).'),
});

const listActionsInput = z.object({
  cardId: z.string().describe('Card ID to list activity for.'),
  filter: z
    .string()
    .optional()
    .describe(
      'Comma-separated action types to filter. Default: "commentCard". ' +
      'Other types: updateCard, addMemberToCard, removeMemberFromCard, ' +
      'addLabelToCard, removeLabelFromCard, updateCheckItemStateOnCard.',
    ),
});

// ---------- Integration definition ----------

export const trelloIntegration = defineIntegration<TrelloClient>({
  id: 'trello',
  displayName: 'Trello',
  description: 'Trello project management API',
  icon: 'layout',

  secureKeys: ['api_key', 'token'],

  createClient: async (ctx) => {
    // Authenticate using API key + token
    const apiKey = await ctx.storage.get('api_key');
    const token = await ctx.storage.get('token');

    if (apiKey && token) {
      ctx.logger.info('Trello: authenticated via API key + token', {
        apiKeyLength: apiKey.length,
        tokenLength: token.length,
        apiKeyPrefix: apiKey.slice(0, 6) + '...',
      });
      return new TrelloClient({ key: apiKey, token });
    }

    // Specific warnings to help diagnose partial config
    if (apiKey && !token) {
      ctx.logger.warn('Trello: API key found but token missing — generate a token at https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=' + apiKey);
    } else if (!apiKey && token) {
      ctx.logger.warn('Trello: token found but API key missing — get your key at https://trello.com/power-ups/admin');
    } else {
      ctx.logger.warn('Trello: no credentials configured — add your API key + token in settings');
    }

    return null;
  },

  methods: [
    {
      id: 'list_boards',
      description: "Discover the authenticated user's accessible Trello boards",
      aiHint:
        'Use to discover available boards and their IDs. Call this BEFORE creating cards or lists to find the correct boardId. ' +
        'Returns board id, name, url, and closed status.',
      handler: async (client) => {
        const boards = await client.members.getMemberBoards({ id: 'me', filter: 'open' });
        return {
          boards: (boards as any[]).map((b: any) => ({
            id: b.id,
            name: b.name,
            url: b.url,
            shortUrl: b.shortUrl,
            idOrganization: b.idOrganization ?? undefined,
          })),
        };
      },
    },

    {
      id: 'list_lists',
      description: 'List all open lists (columns) on a Trello board',
      aiHint:
        'Use to find list IDs and names for a board. Provides idList values needed for create_card and move_card. ' +
        'Call list_boards first to get a boardId.',
      inputSchema: listListsInput,
      handler: async (client, input) => {
        const { boardId } = input as z.infer<typeof listListsInput>;
        const lists = await client.boards.getBoardLists({ id: boardId, filter: 'open' });
        return {
          lists: (lists as any[])
            .sort((a: any, b: any) => (a.pos ?? 0) - (b.pos ?? 0))
            .map((l: any) => ({
              id: l.id,
              name: l.name,
              pos: l.pos ?? 0,
            })),
        };
      },
    },

    {
      id: 'list_members',
      description: 'List members of a Trello board',
      aiHint:
        'Use to find board members and their IDs for assigning cards. ' +
        'Provides memberId values needed for assign_member and unassign_member. ' +
        'Pass boardId to list members of a specific board, or omit for the authenticated user only.',
      inputSchema: listMembersInput,
      handler: async (client, input) => {
        const { boardId } = input as z.infer<typeof listMembersInput>;
        if (boardId) {
          const members = await client.boards.getBoardMembers({ id: boardId });
          return {
            members: (members as any[]).map((m: any) => ({
              id: m.id,
              username: m.username,
              fullName: m.fullName,
              initials: m.initials ?? undefined,
            })),
          };
        }
        const me = await client.members.getMember({ id: 'me' });
        return {
          members: [{
            id: (me as any).id,
            username: (me as any).username,
            fullName: (me as any).fullName,
            initials: (me as any).initials ?? undefined,
          }],
        };
      },
    },

    {
      id: 'list_labels',
      description: 'List labels defined on a Trello board',
      aiHint:
        'Use to find label IDs and names for a board. ' +
        'Provides labelId values needed for add_label and remove_label actions. ' +
        'Call list_boards first to get a boardId.',
      inputSchema: listLabelsInput,
      handler: async (client, input) => {
        const { boardId } = input as z.infer<typeof listLabelsInput>;
        const labels = await client.boards.getBoardLabels({ id: boardId });
        return {
          labels: (labels as any[])
            .filter((l: any) => l.name || l.color)
            .map((l: any) => ({
              id: l.id,
              name: l.name ?? '',
              color: l.color ?? null,
            })),
        };
      },
    },

    {
      id: 'list_checklists',
      description: 'List all checklists and their items on a Trello card',
      aiHint:
        'Use to view checklist progress on a card. Returns checklist IDs (for add_checklist_item) ' +
        'and check item IDs (for complete_checklist_item). Requires a cardId.',
      inputSchema: listChecklistsInput,
      handler: async (client, input) => {
        const { cardId } = input as z.infer<typeof listChecklistsInput>;
        const card = await client.cards.getCard({ id: cardId, checklists: 'all' });
        const checklists = (card as any).checklists ?? [];
        return {
          checklists: checklists.map((cl: any) => ({
            id: cl.id,
            name: cl.name,
            pos: cl.pos ?? 0,
            checkItems: (cl.checkItems ?? []).map((item: any) => ({
              id: item.id,
              name: item.name,
              state: item.state,
              pos: item.pos ?? 0,
            })),
          })),
        };
      },
    },

    {
      id: 'add_checklist',
      description: 'Add a new checklist to a Trello card',
      aiHint:
        'Use when the user wants to add a checklist to a card. ' +
        'After creating, use add_checklist_item to populate it with items.',
      inputSchema: addChecklistInput,
      mutation: true,
      handler: async (client, input) => {
        const { cardId, name, pos } = input as z.infer<typeof addChecklistInput>;
        const checklist = await client.checklists.createChecklist({
          idCard: cardId,
          name,
          pos: pos ?? 'bottom',
        });
        return {
          success: true,
          message: `Created checklist "${name}" on card`,
          checklist: {
            id: (checklist as any).id,
            name: (checklist as any).name,
          },
        };
      },
    },

    {
      id: 'add_checklist_item',
      description: 'Add a new item to an existing checklist on a Trello card',
      aiHint:
        'Use when the user wants to add a task/step to a checklist. ' +
        'Call list_checklists first to find the checklistId. ' +
        'Items are added as incomplete by default.',
      inputSchema: addChecklistItemInput,
      mutation: true,
      handler: async (client, input) => {
        const { checklistId, name, pos } = input as z.infer<typeof addChecklistItemInput>;
        const item = await client.checklists.createChecklistCheckItem({
          id: checklistId,
          name,
          pos: pos ?? 'bottom',
        });
        return {
          success: true,
          message: `Added check item "${name}" to checklist`,
          checkItem: {
            id: (item as any).id,
            name: (item as any).name,
            state: (item as any).state,
          },
        };
      },
    },

    {
      id: 'complete_checklist_item',
      description: 'Mark a checklist item as complete or incomplete',
      aiHint:
        'Use when the user wants to check off or uncheck a checklist item. ' +
        'Call list_checklists first to find the checkItemId. ' +
        'Set complete=true to mark done, false to mark incomplete.',
      inputSchema: completeChecklistItemInput,
      mutation: true,
      handler: async (client, input) => {
        const { cardId, checkItemId, complete } = input as z.infer<typeof completeChecklistItemInput>;
        await client.cards.updateCardCheckItem({
          id: cardId,
          idCheckItem: checkItemId,
          state: complete ? 'complete' : 'incomplete',
        });
        return {
          success: true,
          message: complete
            ? `Marked check item as complete`
            : `Marked check item as incomplete`,
        };
      },
    },

    {
      id: 'search_cards',
      description: 'Full-text search for Trello cards',
      aiHint:
        'Use for powerful search across card titles, descriptions, comments, and metadata. ' +
        'Supports operators: @me (assigned to me), @username, label:"Bug", ' +
        'due:week, due:overdue, board:name, list:name, is:open. ' +
        'Example queries: "@me due:week", "label:P1 is:open", "login bug".',
      inputSchema: searchCardsInput,
      handler: async (client, input) => {
        const { query, boardId, limit } = input as z.infer<typeof searchCardsInput>;
        const results = await client.search.search({
          query,
          modelTypes: 'cards',
          cards_limit: limit ?? 20,
          ...(boardId ? { idBoards: boardId } : {}),
        });
        const cards = (results as any).cards ?? [];
        return {
          cards: cards.map((c: any) => ({
            id: c.id,
            name: c.name,
            shortLink: c.shortLink,
            shortUrl: c.shortUrl,
            url: c.url,
            idList: c.idList,
            idBoard: c.idBoard,
            due: c.due ?? null,
            dueComplete: c.dueComplete ?? false,
            closed: c.closed ?? false,
          })),
        };
      },
    },

    {
      id: 'list_actions',
      description: 'List recent activity and comments on a Trello card',
      aiHint:
        'Use to read card activity history, comments, or see who did what. ' +
        'Filter by action type using the filter param. ' +
        'Default filter shows comments only (commentCard). ' +
        'Other useful filters: updateCard, addMemberToCard, addLabelToCard.',
      inputSchema: listActionsInput,
      handler: async (client, input) => {
        const { cardId, filter } = input as z.infer<typeof listActionsInput>;
        const actions = await client.cards.getCardActions({
          id: cardId,
          filter: filter ?? 'commentCard',
        });
        return {
          actions: (actions as any[]).map((a: any) => ({
            id: a.id,
            type: a.type,
            date: a.date,
            text: a.data?.text ?? null,
            memberCreatorName: a.memberCreator?.fullName ?? a.memberCreator?.username ?? null,
          })),
        };
      },
    },
  ],
});

export default trelloIntegration;
