/**
 * Trello GraphQL Resolvers
 *
 * Implements Query and Mutation resolvers for Trello entities.
 * Uses the TrelloClient via resolver context injection.
 *
 * Context shape (injected by EntitySchemaRegistry):
 *   ctx.integrations.trello.client — TrelloClient instance
 *   ctx.logger — scoped logger
 */

// Helper: get Trello client from context
function getClient(ctx: any): any | null {
  return ctx.integrations?.trello?.client ?? null;
}

// Helper: map raw Trello card REST response to GraphQL TrelloCard shape
function cardToGQL(card: any, listName?: string, boardName?: string): any {
  const labels = card.labels ?? [];
  const members = card.members ?? [];
  const checklists = card.checklists ?? [];

  const labelNames = labels.filter((l: any) => l.name).map((l: any) => l.name).join(', ');
  const memberNames = members.map((m: any) => m.fullName ?? m.username ?? m.id).join(', ');

  const checkItemsTotal = card.badges?.checkItems ??
    checklists.reduce((s: number, cl: any) => s + (cl.checkItems?.length ?? 0), 0);
  const checkItemsChecked = card.badges?.checkItemsChecked ??
    checklists.reduce((s: number, cl: any) =>
      s + (cl.checkItems?.filter((i: any) => i.state === 'complete').length ?? 0), 0);

  return {
    id: card.id,
    type: 'trello_card',
    uri: `@drift//trello_card/${card.id}`,
    title: card.name ?? '(Untitled)',
    desc: card.desc || null,
    idList: card.idList,
    listName: listName ?? card.list?.name ?? null,
    idBoard: card.idBoard,
    boardName: boardName ?? card.board?.name ?? null,
    idMembers: card.idMembers ?? [],
    memberNames: memberNames || null,
    members: members.map((m: any) => ({
      id: m.id,
      username: m.username ?? '',
      fullName: m.fullName ?? m.username ?? m.id,
      initials: m.initials ?? null,
      avatarUrl: m.avatarUrl ?? null,
    })),
    labels: labels.map((l: any) => ({
      id: l.id,
      name: l.name ?? null,
      color: l.color ?? null,
      idBoard: card.idBoard,
    })),
    labelNames: labelNames || null,
    due: card.due ?? null,
    dueComplete: card.dueComplete ?? false,
    start: card.start ?? null,
    closed: card.closed ?? false,
    url: card.url ?? null,
    shortUrl: card.shortUrl ?? null,
    shortLink: card.shortLink ?? null,
    pos: card.pos ?? null,
    checkItemsTotal: checkItemsTotal || null,
    checkItemsChecked: checkItemsChecked || null,
    checklistCount: checklists.length || null,
    checklists: checklists.map((cl: any) => ({
      id: cl.id,
      name: cl.name,
      pos: cl.pos ?? null,
      checkItems: (cl.checkItems ?? []).map((item: any) => ({
        id: item.id,
        name: item.name,
        state: item.state ?? 'incomplete',
        pos: item.pos ?? null,
      })),
    })),
    commentCount: card.badges?.comments ?? null,
    dateLastActivity: card.dateLastActivity ?? null,
  };
}

// Helper: fetch a full card with checklists and members
async function fetchCardFull(client: any, id: string): Promise<any | null> {
  try {
    const card = await client.cards.getCard({ id, checklists: 'all', members: true, fields: 'all' });
    return cardToGQL(card);
  } catch {
    return null;
  }
}

// Helper: map board to GQL shape
function boardToGQL(board: any): any {
  const lists = board.lists ?? [];
  const labels = board.labels ?? [];
  const members = board.members ?? board.memberships ?? [];

  return {
    id: board.id,
    type: 'trello_board',
    uri: `@drift//trello_board/${board.id}`,
    title: board.name ?? '(Untitled board)',
    desc: board.desc || null,
    closed: board.closed ?? false,
    idOrganization: board.idOrganization ?? null,
    url: board.url ?? null,
    shortUrl: board.shortUrl ?? null,
    memberCount: members.length || null,
    listCount: lists.length || null,
    lists: lists
      .filter((l: any) => !l.closed)
      .sort((a: any, b: any) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((l: any) => ({
        id: l.id,
        name: l.name,
        pos: l.pos ?? null,
        closed: l.closed ?? false,
      })),
    labels: labels
      .filter((l: any) => l.name || l.color)
      .map((l: any) => ({
        id: l.id,
        name: l.name ?? null,
        color: l.color ?? null,
        idBoard: board.id,
      })),
  };
}

// Helper: map list to GQL shape
function listToGQL(list: any, boardName?: string, cardCount?: number): any {
  return {
    id: list.id,
    type: 'trello_list',
    uri: `@drift//trello_list/${list.id}`,
    title: list.name ?? '(Untitled list)',
    idBoard: list.idBoard,
    boardName: boardName ?? null,
    closed: list.closed ?? false,
    pos: list.pos ?? null,
    cardCount: cardCount ?? null,
  };
}

// GraphQL Resolvers
export default {
  TrelloCard: {
    linkedContext: async (parent: any, _args: unknown, ctx: any) => {
      const client = getClient(ctx);
      if (!client || !parent.id) return null;

      try {
        const card = await client.cards.getCard({ id: parent.id, members: true, fields: 'all' });
        const labels = (card.labels ?? []).filter((l: any) => l.name).map((l: any) => l.name).join(', ');
        const members = (card.members ?? []).map((m: any) => m.fullName ?? m.username).join(', ');

        const lines = [
          `## Trello Card: ${card.name}`,
          `- **Board**: ${parent.boardName ?? card.idBoard}`,
          `- **List**: ${parent.listName ?? card.idList}`,
        ];

        if (members) lines.push(`- **Members**: ${members}`);
        if (labels) lines.push(`- **Labels**: ${labels}`);
        if (card.due) {
          lines.push(`- **Due**: ${card.due}${card.dueComplete ? ' ✓' : ''}`);
        }
        if (parent.checkItemsTotal) {
          lines.push(`- **Checklists**: ${parent.checkItemsChecked ?? 0}/${parent.checkItemsTotal} items complete`);
        }
        if (card.desc) {
          lines.push('', `### Description`, card.desc);
        }

        return lines.join('\n');
      } catch (err: any) {
        ctx.logger.error('Failed to resolve linkedContext for TrelloCard', {
          cardId: parent.id,
          error: err?.message ?? String(err),
        });
        return null;
      }
    },
  },

  TrelloBoard: {
    linkedContext: async (parent: any, _args: unknown, ctx: any) => {
      if (!parent.id) return null;

      const lines = [
        `## Trello Board: ${parent.title}`,
        `- **Lists**: ${parent.listCount ?? 0}`,
        `- **Members**: ${parent.memberCount ?? 0}`,
      ];

      if (parent.lists?.length) {
        lines.push(`- **Columns**: ${parent.lists.map((l: any) => l.name).join(', ')}`);
      }

      if (parent.url) lines.push(`- **URL**: ${parent.url}`);
      if (parent.desc) lines.push('', `### Description`, parent.desc);

      return lines.join('\n');
    },
  },

  TrelloList: {
    linkedContext: async (parent: any, _args: unknown, _ctx: any) => {
      if (!parent.id) return null;

      const lines = [
        `## Trello List: ${parent.title}`,
        `- **Board**: ${parent.boardName ?? parent.idBoard}`,
      ];
      if (parent.cardCount != null) lines.push(`- **Open Cards**: ${parent.cardCount}`);

      return lines.join('\n');
    },
  },

  Query: {
    trelloCard: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return null;

      ctx.logger.info('Resolving Trello card via GraphQL', { cardId: id });
      try {
        return await fetchCardFull(client, id);
      } catch (err: any) {
        ctx.logger.error('Failed to resolve Trello card', { cardId: id, error: err?.message ?? String(err) });
        return null;
      }
    },

    trelloCards: async (
      _: unknown,
      { query, boardId, listId, limit }: { query?: string; boardId?: string; listId?: string; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const searchQuery = query || 'is:open';
        const results = await client.search.search({
          query: searchQuery,
          modelTypes: 'cards',
          cards_limit: limit ?? 20,
          ...(boardId ? { idBoards: boardId } : {}),
        });

        let cards = (results.cards ?? []) as any[];
        if (listId) {
          cards = cards.filter((c: any) => c.idList === listId);
        }
        return cards.map((c: any) => cardToGQL(c));
      } catch (err: any) {
        ctx.logger.error('Failed to search Trello cards', { query, error: err?.message ?? String(err) });
        return [];
      }
    },

    trelloMyCards: async (_: unknown, { limit }: { limit?: number }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      ctx.logger.info('Fetching my Trello cards', { limit: limit ?? 20 });

      try {
        const cards = await client.members.getMemberCards({ id: 'me', filter: 'open', limit: limit ?? 20 });
        return (cards as any[]).map((c: any) => cardToGQL(c));
      } catch (err: any) {
        ctx.logger.error('Failed to fetch my Trello cards', { error: err?.message ?? String(err) });
        return [];
      }
    },

    trelloBoardCards: async (
      _: unknown,
      { boardId, listId, limit }: { boardId: string; listId?: string; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      ctx.logger.info('Fetching Trello board cards', { boardId, listId, limit });

      try {
        // Fetch lists for name resolution
        let listMap: Record<string, string> = {};
        try {
          const lists = await client.boards.getBoardLists({ id: boardId, filter: 'open' });
          listMap = Object.fromEntries((lists as any[]).map((l: any) => [l.id, l.name]));
        } catch {
          // list names are optional
        }

        const cards = await client.boards.getBoardCards({ id: boardId, filter: 'open' });
        let result = cards as any[];

        if (listId) {
          result = result.filter((c: any) => c.idList === listId);
        }

        if (limit) {
          result = result.slice(0, limit);
        }

        return result.map((c: any) => cardToGQL(c, listMap[c.idList]));
      } catch (err: any) {
        ctx.logger.error('Failed to fetch board cards', { boardId, error: err?.message ?? String(err) });
        return [];
      }
    },

    trelloBoard: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return null;

      ctx.logger.info('Resolving Trello board via GraphQL', { boardId: id });
      try {
        const board = await client.boards.getBoard({ id, lists: 'open', members: 'all', labels: 'all' });
        return boardToGQL(board);
      } catch (err: any) {
        ctx.logger.error('Failed to resolve Trello board', { boardId: id, error: err?.message ?? String(err) });
        return null;
      }
    },

    trelloBoards: async (_: unknown, { filter }: { filter?: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const boards = await client.members.getMemberBoards({ id: 'me', filter: filter ?? 'open' });
        return (boards as any[]).map(boardToGQL);
      } catch (err: any) {
        ctx.logger.error('Failed to fetch Trello boards', { error: err?.message ?? String(err) });
        return [];
      }
    },

    trelloList: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return null;

      try {
        const list = await client.lists.getList({ id, cards: 'open' });
        const cards = (list as any).cards ?? [];
        return listToGQL(list, undefined, cards.length);
      } catch (err: any) {
        ctx.logger.error('Failed to resolve Trello list', { listId: id, error: err?.message ?? String(err) });
        return null;
      }
    },

    trelloLists: async (_: unknown, { boardId }: { boardId: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const lists = await client.boards.getBoardLists({ id: boardId, filter: 'open' });
        return (lists as any[])
          .sort((a: any, b: any) => (a.pos ?? 0) - (b.pos ?? 0))
          .map((l: any) => listToGQL(l));
      } catch (err: any) {
        ctx.logger.error('Failed to fetch Trello lists', { boardId, error: err?.message ?? String(err) });
        return [];
      }
    },

    trelloMembers: async (_: unknown, { boardId }: { boardId?: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        if (boardId) {
          const members = await client.boards.getBoardMembers({ id: boardId });
          return (members as any[]).map((m: any) => ({
            id: m.id,
            username: m.username ?? '',
            fullName: m.fullName ?? m.username ?? m.id,
            initials: m.initials ?? null,
            avatarUrl: m.avatarUrl ?? null,
          }));
        }
        const me = await client.members.getMember({ id: 'me' });
        return [{
          id: (me as any).id,
          username: (me as any).username ?? '',
          fullName: (me as any).fullName ?? '',
          initials: (me as any).initials ?? null,
          avatarUrl: (me as any).avatarUrl ?? null,
        }];
      } catch (err: any) {
        ctx.logger.error('Failed to fetch Trello members', { boardId, error: err?.message ?? String(err) });
        return [];
      }
    },

    trelloLabels: async (_: unknown, { boardId }: { boardId: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const labels = await client.boards.getBoardLabels({ id: boardId });
        return (labels as any[])
          .filter((l: any) => l.name || l.color)
          .map((l: any) => ({
            id: l.id,
            name: l.name ?? null,
            color: l.color ?? null,
            idBoard: boardId,
          }));
      } catch (err: any) {
        ctx.logger.error('Failed to fetch Trello labels', { boardId, error: err?.message ?? String(err) });
        return [];
      }
    },

    trelloChecklists: async (_: unknown, { cardId }: { cardId: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const card = await client.cards.getCard({ id: cardId, checklists: 'all' });
        return ((card as any).checklists ?? []).map((cl: any) => ({
          id: cl.id,
          name: cl.name,
          pos: cl.pos ?? null,
          checkItems: (cl.checkItems ?? []).map((item: any) => ({
            id: item.id,
            name: item.name,
            state: item.state ?? 'incomplete',
            pos: item.pos ?? null,
          })),
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to fetch Trello checklists', { cardId, error: err?.message ?? String(err) });
        return [];
      }
    },

    trelloActions: async (
      _: unknown,
      { cardId, filter }: { cardId: string; filter?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return [];

      try {
        const actions = await client.cards.getCardActions({
          id: cardId,
          filter: filter ?? 'commentCard',
        });
        return (actions as any[]).map((a: any) => ({
          id: a.id,
          type: a.type,
          date: a.date,
          text: a.data?.text ?? null,
          memberCreatorName: a.memberCreator?.fullName ?? a.memberCreator?.username ?? null,
        }));
      } catch (err: any) {
        ctx.logger.error('Failed to fetch Trello card actions', { cardId, error: err?.message ?? String(err) });
        return [];
      }
    },
  },

  Mutation: {
    createTrelloCard: async (_: unknown, { input }: { input: any }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      ctx.logger.info('Creating Trello card via GraphQL', { name: input.name, idList: input.idList });

      try {
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
        });
        const entity = await fetchCardFull(client, (card as any).id);
        return {
          success: true,
          message: `Created card "${(card as any).name}"`,
          entity,
        };
      } catch (err: any) {
        return { success: false, message: `Failed to create card: ${err?.message ?? String(err)}` };
      }
    },

    updateTrelloCard: async (_: unknown, { id, input }: { id: string; input: any }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      ctx.logger.info('Updating Trello card via GraphQL', { cardId: id });

      try {
        const updateData: Record<string, unknown> = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.desc !== undefined) updateData.desc = input.desc;
        if (input.due !== undefined) updateData.due = input.due;
        if (input.dueComplete !== undefined) updateData.dueComplete = input.dueComplete;
        if (input.start !== undefined) updateData.start = input.start;
        if (input.closed !== undefined) updateData.closed = input.closed;
        if (input.pos !== undefined) updateData.pos = input.pos;

        await client.cards.updateCard({ id, ...updateData });
        const entity = await fetchCardFull(client, id);
        return { success: true, message: `Updated card`, entity };
      } catch (err: any) {
        return { success: false, message: `Failed to update card: ${err?.message ?? String(err)}` };
      }
    },

    archiveTrelloCard: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      try {
        await client.cards.updateCard({ id, closed: true });
        return { success: true, message: `Archived card` };
      } catch (err: any) {
        return { success: false, message: `Failed to archive card: ${err?.message ?? String(err)}` };
      }
    },

    deleteTrelloCard: async (_: unknown, { id }: { id: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      try {
        await client.cards.deleteCard({ id });
        return { success: true, message: `Deleted card` };
      } catch (err: any) {
        return { success: false, message: `Failed to delete card: ${err?.message ?? String(err)}` };
      }
    },

    moveTrelloCard: async (_: unknown, { id, idList, pos }: { id: string; idList: string; pos?: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      try {
        await client.cards.updateCard({ id, idList, pos: pos ?? 'bottom' });
        const entity = await fetchCardFull(client, id);
        return { success: true, message: `Moved card`, entity };
      } catch (err: any) {
        return { success: false, message: `Failed to move card: ${err?.message ?? String(err)}` };
      }
    },

    addTrelloCardComment: async (_: unknown, { cardId, text }: { cardId: string; text: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      try {
        await (client.cards as any).createCardComment({ id: cardId, text });
        return { success: true, message: `Added comment` };
      } catch (err: any) {
        return { success: false, message: `Failed to add comment: ${err?.message ?? String(err)}` };
      }
    },

    addTrelloChecklist: async (_: unknown, { cardId, name }: { cardId: string; name: string }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      try {
        const checklist = await client.checklists.createChecklist({ idCard: cardId, name, pos: 'bottom' });
        return {
          success: true,
          message: `Created checklist "${name}"`,
          data: { checklistId: (checklist as any).id },
        };
      } catch (err: any) {
        return { success: false, message: `Failed to create checklist: ${err?.message ?? String(err)}` };
      }
    },

    completeTrelloCheckItem: async (
      _: unknown,
      { cardId, checkItemId, complete }: { cardId: string; checkItemId: string; complete: boolean },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      try {
        await client.cards.updateCardCheckItem({
          id: cardId,
          idCheckItem: checkItemId,
          state: complete ? 'complete' : 'incomplete',
        });
        return {
          success: true,
          message: complete ? `Marked item as complete` : `Marked item as incomplete`,
        };
      } catch (err: any) {
        return { success: false, message: `Failed to update check item: ${err?.message ?? String(err)}` };
      }
    },

    createTrelloBoard: async (_: unknown, { input }: { input: any }, ctx: any) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      ctx.logger.info('Creating Trello board via GraphQL', { name: input.name });

      try {
        const board = await client.boards.createBoard({
          name: input.name,
          desc: input.desc,
          idOrganization: input.idOrganization,
          defaultLists: input.defaultLists !== false,
        });
        return {
          success: true,
          message: `Created board "${(board as any).name}"`,
          entity: boardToGQL(board),
        };
      } catch (err: any) {
        return { success: false, message: `Failed to create board: ${err?.message ?? String(err)}` };
      }
    },

    createTrelloList: async (
      _: unknown,
      { boardId, name, pos }: { boardId: string; name: string; pos?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      try {
        const list = await client.lists.createList({ name, idBoard: boardId, pos: pos ?? 'bottom' });
        return {
          success: true,
          message: `Created list "${name}"`,
          entity: listToGQL(list),
        };
      } catch (err: any) {
        return { success: false, message: `Failed to create list: ${err?.message ?? String(err)}` };
      }
    },

    updateTrelloList: async (
      _: unknown,
      { id, name, closed, pos }: { id: string; name?: string; closed?: boolean; pos?: string },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) return { success: false, message: 'No API key or token configured' };

      try {
        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = name;
        if (closed !== undefined) updateData.closed = closed;
        if (pos !== undefined) updateData.pos = pos;
        const list = await client.lists.updateList({ id, ...updateData });
        return {
          success: true,
          message: `Updated list`,
          entity: listToGQL(list),
        };
      } catch (err: any) {
        return { success: false, message: `Failed to update list: ${err?.message ?? String(err)}` };
      }
    },
  },
};
