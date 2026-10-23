import { type Href, Redirect } from 'expo-router';

import { HOME, useSession } from '@/lib/session';

/** Entry point: sends the user to the screen for their role, or to login. */
export default function Index() {
  const { user } = useSession();
  return <Redirect href={(user ? HOME[user.role] : '/login') as Href} />;
}
