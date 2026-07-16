import { Stack } from 'expo-router';

/** Onboarding activation flow (Master Build Prompt Loop 1, screens O1–O7). */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: false,
      }}
    >
      <Stack.Screen name="splash" options={{ animation: 'fade' }} />
    </Stack>
  );
}
