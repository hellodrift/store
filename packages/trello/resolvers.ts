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
  const client = ctx.integrations?.trello?.client ?? null;
  if (!client) {
    ctx.logger?.warn('Trello: no client available — credentials may not be configured or are invalid. Open Trello settings to configure.');
  }
  return client;
}

// Helper: classify errors
function isAuthError(err: any): boolean {
  const status = err?.response?.status ?? err?.status ?? err?.statusCode;
  const msg = err?.message ?? '';
  return status === 401 || msg.includes('401') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid token');
}

function isNotFoundError(err: any): boolean {
  const status = err?.response?.status ?? err?.status ?? err?.statusCode;
  return status === 404;
}

// Helper: format error for logging with full context
function errCtx(err: any): Record<string, unknown> {
  return {
    error: err?.message ?? String(err),
    status: err?.response?.status ?? err?.status ?? err?.statusCode ?? null,
    responseBody: err?.response?.data ?? err?.responseBody ?? null,
  };
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

// Helper: fetch a full card with checklists and members, enriched with board/list names
async function fetchCardFull(client: any, id: string, ctx?: any): Promise<any | null> {
  try {
    const card = await client.cards.getCard({ id, checklists: 'all', members: true, fields: 'all' });

    // Enrich with board/list names (not in raw card response)
    let boardName: string | undefined;
    let listName: string | undefined;
    if (card.idBoard) {
      try {
        const board = await client.boards.getBoard({ id: card.idBoard, lists: 'open', fields: 'name' });
        boardName = board.name;
        listName = (board.lists ?? []).find((l: any) => l.id === card.idList)?.name;
      } catch { /* Board fetch failed, IDs used as fallback */ }
    }

    return cardToGQL(card, listName, boardName);
  } catch (err: any) {
    ctx?.logger?.error('Trello: fetchCardFull failed', { cardId: id, ...errCtx(err) });
    return null;
  }
}

// Helper: enrich raw card list with board/list names via parallel board fetches
async function enrichCardsWithNames(client: any, rawCards: any[], ctx: any): Promise<any[]> {
  if (rawCards.length === 0) return [];

  const boardIdSet = new Set(rawCards.map((c: any) => c.idBoard).filter(Boolean));
  const boardMap: Record<string, { name: string; lists: Record<string, string> }> = {};

  await Promise.all(
    Array.from(boardIdSet).map(async (boardId) => {
      try {
        const board = await client.boards.getBoard({ id: boardId, lists: 'open', fields: 'name' });
        const lists = (board as any).lists ?? [];
        boardMap[boardId as string] = {
          name: (board as any).name ?? (boardId as string),
          lists: Object.fromEntries(lists.map((l: any) => [l.id, l.name])),
        };
      } catch {
        boardMap[boardId as string] = { name: boardId as string, lists: {} };
      }
    }),
  );

  return rawCards.map((c: any) => {
    const info = boardMap[c.idBoard] ?? { name: c.idBoard, lists: {} };
    return cardToGQL(c, info.lists[c.idList], info.name);
  });
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
        const card = await fetchCardFull(client, id, ctx);
        if (!card) ctx.logger.warn('Trello card not found or failed to load', { cardId: id });
        return card;
      } catch (err: any) {
        ctx.logger.error('Failed to resolve Trello card', { cardId: id, ...errCtx(err) });
        if (isAuthError(err)) throw new Error('Trello authentication failed (401). Check your credentials in Trello settings.');
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
        const results = await client.search.getSearch({
          query: searchQuery,
          modelTypes: 'cards',
          cards: { limit: limit ?? 20 },
          ...(boardId ? { idBoards: [boardId] } : {}),
        });

        let cards = ((results as any).cards ?? []) as any[];
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
      if (!client) throw new Error('Trello is not configured. Open Trello settings to add your API key and token.');

      const maxCards = limit ?? 20;

      // Log who we're authenticated as — helps diagnose credential issues
      try {
        const me = await client.members.getMember({ id: 'me' });
        ctx.logger.info('Trello: authenticated as', {
          id: (me as any).id,
          username: (me as any).username,
          fullName: (me as any).fullName,
        });
      } catch (meErr: any) {
        ctx.logger.warn('Trello: could not fetch member info', errCtx(meErr));
        if (isAuthError(meErr)) {
          throw new Error('Trello authentication failed (401). Your API key or token is invalid or expired. Open Trello settings to update your credentials.');
        }
      }

      ctx.logger.info('Fetching my Trello cards', { limit: maxCards });

      try {
        // getMemberCards returns cards where the user is in idMembers (explicitly assigned)
        const cards = await client.members.getMemberCards({ id: 'me', filter: 'open', limit: maxCards });
        const cardList = cards as any[];
        ctx.logger.info('Fetched assigned Trello cards', { count: cardList.length });

        if (cardList.length > 0) {
          return cardList.map((c: any) => cardToGQL(c));
        }

        // Fallback: search for @me — finds cards the user is involved in (assigned, mentioned, etc.)
        ctx.logger.info('No assigned cards found, falling back to @me search');
        try {
          const results = await client.search.getSearch({
            query: '@me is:open',
            modelTypes: 'cards',
            cards: { limit: maxCards },
          });
          const searchCards = ((results as any).cards ?? []) as any[];
          ctx.logger.info('Fetched @me search cards', { count: searchCards.length });
          return searchCards.map((c: any) => cardToGQL(c));
        } catch (searchErr: any) {
          ctx.logger.warn('Trello @me search fallback failed', errCtx(searchErr));
          return [];
        }
      } catch (err: any) {
        ctx.logger.error('Failed to fetch my Trello cards', errCtx(err));
        if (isAuthError(err)) {
          throw new Error('Trello authentication failed (401). Your API key or token is invalid or expired. Open Trello settings to update your credentials.');
        }
        throw err;
      }
    },

    trelloNavCards: async (
      _: unknown,
      { boardIds, showAll, limit }: { boardIds?: string[]; showAll?: boolean; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) throw new Error('Trello is not configured. Open Trello settings to add your API key and token.');

      const maxCards = limit ?? 50;

      if (!showAll) {
        // "Mine" mode — assigned cards, enriched with board/list names
        ctx.logger.info('Trello nav: fetching my cards', { limit: maxCards });
        try {
          let rawCards: any[] = [];
          try {
            const assigned = await client.members.getMemberCards({ id: 'me', filter: 'open', limit: maxCards });
            rawCards = assigned as any[];
          } catch (err: any) {
            if (isAuthError(err)) throw err;
          }
          if (rawCards.length === 0) {
            ctx.logger.info('Trello nav: no assigned cards, falling back to @me search');
            const results = await client.search.getSearch({ query: '@me is:open', modelTypes: 'cards', cards: { limit: maxCards } });
            rawCards = ((results as any).cards ?? []) as any[];
          }
          ctx.logger.info('Trello nav: raw cards fetched', { count: rawCards.length });
          return await enrichCardsWithNames(client, rawCards, ctx);
        } catch (err: any) {
          ctx.logger.error('Trello nav: failed to fetch my cards', errCtx(err));
          if (isAuthError(err)) throw new Error('Trello authentication failed (401). Check your credentials in settings.');
          throw err;
        }
      }

      // "All" mode — fetch from specified boards (or all accessible boards)
      let targetBoardIds = boardIds?.filter(Boolean) ?? [];
      if (targetBoardIds.length === 0) {
        ctx.logger.info('Trello nav: fetching all accessible boards');
        try {
          const boards = await client.members.getMemberBoards({ id: 'me', filter: 'open' });
          targetBoardIds = (boards as any[]).slice(0, 10).map((b: any) => b.id);
          ctx.logger.info('Trello nav: found boards', { count: targetBoardIds.length });
        } catch (err: any) {
          if (isAuthError(err)) throw new Error('Trello authentication failed (401). Check your credentials in settings.');
          throw err;
        }
      }

      ctx.logger.info('Trello nav: fetching cards from boards', { boardCount: targetBoardIds.length });
      const allCards: any[] = [];
      await Promise.all(
        targetBoardIds.map(async (boardId: string) => {
          try {
            const [boardData, cards] = await Promise.all([
              client.boards.getBoard({ id: boardId, lists: 'open', fields: 'name' }),
              client.boards.getBoardCards({ id: boardId, filter: 'open' }),
            ]);
            const boardName = (boardData as any).name;
            const lists = (boardData as any).lists ?? [];
            const listMap = Object.fromEntries(lists.map((l: any) => [l.id, l.name]));
            (cards as any[]).forEach((c: any) => allCards.push(cardToGQL(c, listMap[c.idList], boardName)));
          } catch (err: any) {
            ctx.logger.warn('Trello nav: failed to fetch cards for board', { boardId, ...errCtx(err) });
          }
        }),
      );

      ctx.logger.info('Trello nav: all cards fetched', { total: allCards.length });
      return allCards.slice(0, maxCards);
    },

    trelloBoardCards: async (
      _: unknown,
      { boardId, listId, limit }: { boardId: string; listId?: string; limit?: number },
      ctx: any,
    ) => {
      const client = getClient(ctx);
      if (!client) throw new Error('Trello is not configured. Open Trello settings to add your API key and token.');

      ctx.logger.info('Fetching Trello board cards', { boardId, listId, limit });

      try {
        // Fetch lists for name resolution
        let listMap: Record<string, string> = {};
        try {
          const lists = await client.boards.getBoardLists({ id: boardId, filter: 'open' });
          listMap = Object.fromEntries((lists as any[]).map((l: any) => [l.id, l.name]));
        } catch (listErr: any) {
          ctx.logger.warn('Trello: could not fetch list names for board', { boardId, ...errCtx(listErr) });
        }

        const cards = await client.boards.getBoardCards({ id: boardId, filter: 'open' });
        let result = cards as any[];

        if (listId) result = result.filter((c: any) => c.idList === listId);
        if (limit) result = result.slice(0, limit);

        ctx.logger.info('Fetched Trello board cards', { boardId, count: result.length });
        return result.map((c: any) => cardToGQL(c, listMap[c.idList]));
      } catch (err: any) {
        ctx.logger.error('Failed to fetch board cards', { boardId, ...errCtx(err) });
        if (isAuthError(err)) {
          throw new Error('Trello authentication failed (401). Your API key or token is invalid or expired. Open Trello settings to update your credentials.');
        }
        throw err;
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
      if (!client) throw new Error('Trello is not configured. Open Trello settings to add your API key and token.');

      try {
        const boards = await client.members.getMemberBoards({ id: 'me', filter: filter ?? 'open' });
        ctx.logger.info('Fetched Trello boards', { count: (boards as any[]).length });
        return (boards as any[]).map(boardToGQL);
      } catch (err: any) {
        ctx.logger.error('Failed to fetch Trello boards', errCtx(err));
        if (isAuthError(err)) {
          throw new Error('Trello authentication failed (401). Your API key or token is invalid or expired. Open Trello settings to update your credentials.');
        }
        throw err;
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
        await client.cards.addCardComment({ id: cardId, text });
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
