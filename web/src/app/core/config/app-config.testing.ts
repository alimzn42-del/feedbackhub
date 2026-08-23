import { computed, signal, type Provider } from '@angular/core';
import { AppConfig } from './app-config';
import type { Capabilities, ResolvedSetting, TaxonomyRef } from '../api/api.types';

/**
 * A configured application, without the request that configures one.
 *
 * Every screen now reads the taxonomy, the capabilities and the board's
 * defaults from AppConfig, so a component test that did not provide this would
 * issue GET /api/bootstrap and then have to flush it — in every test, in every
 * spec, describing nothing about the component under test.
 *
 * The stub is deliberately not a partial: it answers every question AppConfig
 * answers, so a test never renders against undefined and a new member on the
 * service fails to compile here rather than silently at runtime.
 */
export interface ConfigStub {
  categories: TaxonomyRef[];
  statuses: TaxonomyRef[];
  capabilities: Partial<Capabilities>;
  /** Null unless a test is about the moderation indicator. */
  pendingComments: number | null;
  settings: Record<string, ResolvedSetting>;
  user: { id: number; email: string; displayName: string } | null;
}

const DEFAULTS: ConfigStub = {
  categories: [
    { id: 1, name: 'Bug', slug: 'bug' },
    { id: 2, name: 'Feature', slug: 'feature' },
  ],
  statuses: [
    { id: 1, name: 'New', slug: 'new' },
    { id: 2, name: 'Planned', slug: 'planned' },
  ],
  capabilities: {},
  pendingComments: null,
  settings: {},
  user: { id: 2, email: 'dana@feedbackhub.local', displayName: 'Dana Okafor' },
};

export function provideStubbedConfig(overrides: Partial<ConfigStub> = {}): Provider {
  const stub = { ...DEFAULTS, ...overrides };

  const setting = <T>(key: string): ResolvedSetting<T> | null =>
    (stub.settings[key] as ResolvedSetting<T> | undefined) ?? null;

  const value = <T>(key: string, fallback: T): T => setting<T>(key)?.value ?? fallback;

  return {
    provide: AppConfig,
    useValue: {
      isStarting: signal(false),
      isReady: signal(true),
      failure: signal(null),
      retry: () => undefined,
      reload: () => undefined,

      user: signal(stub.user),
      pendingComments: signal(stub.pendingComments),
      categories: signal(stub.categories),
      statuses: signal(stub.statuses),

      capabilities: computed(() => ({
        canManageCategories: false,
        canManageStatuses: false,
        canManageSettings: false,
        ...stub.capabilities,
      })),

      setting,
      defaultSort: computed(() => value('board.defaultSort', 'newest')),
      defaultStatuses: computed(() => value<string[]>('board.defaultStatuses', [])),
      defaultCategories: computed(() => value<string[]>('board.defaultCategories', [])),
      theme: computed(() => value('profile.theme', 'system')),
      language: computed(() => value('profile.language', 'en')),
    } satisfies Record<keyof AppConfig, unknown>,
  };
}
