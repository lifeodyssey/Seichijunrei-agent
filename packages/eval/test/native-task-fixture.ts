import { createModels, fauxProvider, type FauxResponseStep } from '@earendil-works/pi-ai';
import type { Session } from '@earendil-works/pi-agent-core';
import type { createPilgrimageHarness } from '@animichi/agent/harness';
import { createCatalogClient, type PilgrimageToolContext } from '@animichi/agent/tools';

export function optionsFor(session: Session, responses: FauxResponseStep[]): Parameters<typeof createPilgrimageHarness>[0] {
  const provider = fauxProvider({ api: 'faux', provider: 'faux', models: [{ id: 'faux-model' }] });
  provider.setResponses(responses);
  const models = createModels();
  models.setProvider(provider.provider);
  return { session, models, model: provider.getModel(), toolContext: toolsFor(session),
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 } };
}

export function toolsFor(session: Session): PilgrimageToolContext {
  return { session, branch: 'main', locale: 'en',
    catalog: createCatalogClient(() => Promise.reject(new Error('Unexpected catalog request'))),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve() };
}
