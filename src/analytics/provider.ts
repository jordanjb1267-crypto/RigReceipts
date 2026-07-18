import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuthStore } from '@/store/auth';

import { setAnalyticsSink } from './index';
import { createPostHogSink } from './posthog';

/**
 * Wires the PostHog sink behind the analytics facade when a project key is
 * configured. With no key (local dev / no `.env`) the facade keeps its dev
 * logger and nothing leaves the device. Idempotent.
 */

const ANON_ID_KEY = 'rigreceipts.analytics.anon_id';

let started = false;

function randomAnonId(): string {
  // Non-crypto pseudonymous id for anonymous analytics attribution.
  const chunk = () =>
    Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0');
  return `anon_${chunk()}${chunk()}`;
}

export async function initAnalytics(): Promise<void> {
  if (started) return;
  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;
  started = true;

  let anonId = await AsyncStorage.getItem(ANON_ID_KEY);
  if (!anonId) {
    anonId = randomAnonId();
    await AsyncStorage.setItem(ANON_ID_KEY, anonId);
  }

  let distinctId = useAuthStore.getState().userId ?? anonId;

  const posthog = createPostHogSink({
    apiKey,
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
    getDistinctId: () => distinctId,
  });
  setAnalyticsSink((event, props) => posthog.capture(event, props));

  // On sign-in, alias the anonymous id to the user id so events recorded before
  // the account existed stay attached; on sign-out, revert to the anonymous id.
  useAuthStore.subscribe((state) => {
    const next = state.userId;
    if (next && next !== distinctId) {
      const previous = distinctId;
      distinctId = next;
      posthog.identify(next, previous);
    } else if (!next) {
      distinctId = anonId as string;
    }
  });
}
