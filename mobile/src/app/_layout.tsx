import { SplashScreen, Stack } from 'expo-router';
import { useEffect } from 'react';

import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

function Routes() {
  const { user, ready } = useSession();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  // Each screen exists only for the state that may see it; expo-router redirects when a guard flips.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={user?.role === 'DRIVER'}>
        <Stack.Screen name="driver" />
      </Stack.Protected>
      <Stack.Protected guard={user?.role === 'PASSENGER'}>
        <Stack.Screen name="passenger" />
      </Stack.Protected>
      <Stack.Protected guard={user?.role === 'AUTHORITY'}>
        <Stack.Screen name="authority" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}
