import type { z } from 'zod';

/** Provider-neutral contract. No network call is made by this module. */
export type AiTask = 'medical_document' | 'medical_labs' | 'food_photo' | 'food_label'
  | 'nutrition_assistant' | 'meal_generation' | 'workout_generation' | 'general_assistant';
export type AiDataClass = 'medical' | 'general';
export type AiProviderId = 'anthropic' | 'openrouter';

export interface AiRoute {
  provider: AiProviderId;
  model: string;
  dataClass: AiDataClass;
}

export interface AiUsage {
  provider: AiProviderId;
  model: string;
  input: number;
  output: number;
  cacheWrite?: number;
  cacheRead?: number;
}

export interface AiRequest<S extends z.ZodType> {
  task: AiTask;
  schema: S;
  system: string;
  content: string;
  maxTokens: number;
  /** Explicit permission to send sensitive content to this provider. */
  permittedProviders: readonly AiProviderId[];
}

export interface AiResult<T> {
  result: T | 'refused';
  usage: AiUsage;
}

export interface AiProvider {
  readonly id: AiProviderId;
  structured<S extends z.ZodType>(route: AiRoute, request: AiRequest<S>): Promise<AiResult<z.infer<S>>>;
}

export class AiRoutingError extends Error {}

export function chooseRoute(task: AiTask, routes: Readonly<Partial<Record<AiTask, AiRoute>>>,
  permittedProviders: readonly AiProviderId[]): AiRoute {
  const route = routes[task];
  if (!route) throw new AiRoutingError('No route configured');
  if (!permittedProviders.includes(route.provider)) throw new AiRoutingError('Provider not permitted for request');
  if ((task === 'medical_document' || task === 'medical_labs') && route.dataClass !== 'medical')
    throw new AiRoutingError('Medical task requires medical route');
  return route;
}

export class AiGateway {
  private readonly routes: Readonly<Partial<Record<AiTask, AiRoute>>>;
  private readonly providers: Readonly<Partial<Record<AiProviderId, AiProvider>>>;
  constructor(routes: Readonly<Partial<Record<AiTask, AiRoute>>>,
    providers: Readonly<Partial<Record<AiProviderId, AiProvider>>>) {
    this.routes = routes;
    this.providers = providers;
  }

  async structured<S extends z.ZodType>(request: AiRequest<S>): Promise<AiResult<z.infer<S>>> {
    const route = chooseRoute(request.task, this.routes, request.permittedProviders);
    const provider = this.providers[route.provider];
    if (!provider) throw new AiRoutingError('Provider unavailable');
    const response = await provider.structured(route, request);
    return { ...response, usage: { ...response.usage, provider: route.provider, model: response.usage.model } };
  }
}
