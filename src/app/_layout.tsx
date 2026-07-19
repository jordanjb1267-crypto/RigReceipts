import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
  useFonts,
} from '@expo-google-fonts/inter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initAnalytics } from '@/analytics/provider';
import { initCaptureSync } from '@/data/captureSync';
import { initSentry } from '@/lib/sentry';
import { useAuthStore } from '@/store/auth';
import { useOnboardingStore } from '@/store/onboarding';

SplashScreen.preventAutoHideAsync();
initSentry();
// Loads the persisted Supabase session and subscribes to auth changes.
// No-op when Supabase is not configured (device-only mode).
useAuthStore.getState().init();
// Wires the PostHog sink behind track() when a project key is configured;
// no-op (dev logger) otherwise. Subscribes to auth for the distinct id.
void initAnalytics();
// Backfills the offline capture queue to Supabase whenever a user is signed in.
initCaptureSync();

const queryClient = new QueryClient();

/** Routes between the onboarding flow and the tab app based on persisted state. */
function useOnboardingGate(ready: boolean) {
  const hydrated = useOnboardingStore((s) => s.hydrated);
  const onboardingComplete = useOnboardingStore((s) => s.onboardingComplete);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !hydrated) return;
    // Gate only the tab app vs the onboarding flow. Shared overlays (e.g. the
    // rate-card modal) belong to neither group and must not trigger a redirect.
    const inTabs = segments[0] === '(tabs)';
    const inOnboarding = segments[0] === '(onboarding)';
    if (!onboardingComplete && inTabs) {
      router.replace('/(onboarding)/splash');
    } else if (onboardingComplete && inOnboarding) {
      router.replace('/(tabs)');
    }
  }, [ready, hydrated, onboardingComplete, segments, router]);

  return hydrated;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });

  const hydrated = useOnboardingGate(fontsLoaded);
  const ready = fontsLoaded && hydrated;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="rate-card" options={{ presentation: 'modal' }} />
          <Stack.Screen name="rate-board" />
          <Stack.Screen name="community-terms" options={{ presentation: 'modal' }} />
          <Stack.Screen name="lane-detail" />
          <Stack.Screen name="compare" options={{ presentation: 'modal' }} />
          <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
          <Stack.Screen name="account-settings" options={{ presentation: 'modal' }} />
          <Stack.Screen name="rpm-coach" options={{ presentation: 'modal' }} />
          <Stack.Screen name="broker-check" options={{ presentation: 'modal' }} />
          <Stack.Screen name="monthly-closeout" options={{ presentation: 'modal' }} />
          <Stack.Screen name="add-trip" options={{ presentation: 'modal' }} />
          <Stack.Screen name="add-load" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
