/**
 * Wyze Cameras GraphQL Resolvers
 *
 * Provides Query resolvers for WyzeCam entities.
 * Camera data is fetched from the Wyze bridge server.
 */

const DEFAULT_BRIDGE_URL = 'http://localhost:5050';

async function fetchFromBridge(path: string): Promise<any> {
  try {
    const resp = await fetch(`${DEFAULT_BRIDGE_URL}${path}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export default {
  WyzeCam: {
    linkedContext: (parent: { cameraNameUri: string; nickname: string; online: boolean; model_name?: string }) => {
      return [
        `## Wyze Camera: ${parent.nickname}`,
        `- **Camera ID**: ${parent.cameraNameUri}`,
        `- **Status**: ${parent.online ? 'Online' : 'Offline'}`,
        parent.model_name ? `- **Model**: ${parent.model_name}` : '',
        '',
        'This is a live camera stream from Wyze.',
      ].filter(Boolean).join('\n');
    },
  },

  Query: {
    wyzeCam: async (
      _: unknown,
      { cameraNameUri }: { cameraNameUri: string },
      ctx: any,
    ) => {
      ctx.logger?.info('Resolving Wyze camera via GraphQL', { cameraNameUri });
      const data = await fetchFromBridge(`/api/${cameraNameUri}`);
      if (!data) {
        return {
          id: cameraNameUri,
          cameraNameUri,
          nickname: cameraNameUri,
          online: false,
        };
      }
      return {
        id: data.name_uri || data.mac || cameraNameUri,
        cameraNameUri: data.name_uri || cameraNameUri,
        nickname: data.nickname || cameraNameUri,
        online: data.online ?? false,
        model_name: data.model_name,
      };
    },

    wyzeCams: async (_: unknown, __: unknown, ctx: any) => {
      ctx.logger?.info('Listing Wyze cameras via GraphQL');
      const data = await fetchFromBridge('/api');
      if (!Array.isArray(data)) return [];
      return data.map((cam: any) => ({
        id: cam.name_uri || cam.mac,
        cameraNameUri: cam.name_uri || cam.mac,
        nickname: cam.nickname || cam.name_uri || cam.mac,
        online: cam.online ?? false,
        model_name: cam.model_name,
      }));
    },
  },
};
