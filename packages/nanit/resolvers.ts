/**
 * Nanit GraphQL Resolvers
 *
 * Implements Query resolvers for NanitCam.
 * The widget components don't use GraphQL for data — they read auth tokens
 * from plugin storage and stream HLS directly. The GraphQL layer exists
 * so the entity system can resolve camera metadata for card rendering.
 */

export default {
  NanitCam: {
    linkedContext: (parent: { babyUid: string; name: string; status: string }) => {
      return [
        `## Nanit Camera: ${parent.name}`,
        `- **Baby UID**: ${parent.babyUid}`,
        `- **Status**: ${parent.status}`,
        '',
        'This is a live baby camera stream from Nanit.',
      ].join('\n');
    },
  },

  Query: {
    nanitCam: async (
      _: unknown,
      { babyUid }: { babyUid: string },
      ctx: any,
    ) => {
      ctx.logger?.info('Resolving Nanit camera', { babyUid });

      return {
        id: babyUid,
        babyUid,
        name: 'Nanit Camera',
        status: 'online',
      };
    },
  },
};
