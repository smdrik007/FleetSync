import { Text } from 'react-native';

import { RoleScreen } from '@/components/role-screen';
import { useTheme } from '@/lib/theme';

export default function Authority() {
  const t = useTheme();
  return (
    <RoleScreen title="Use the web console">
      <Text style={{ color: t.textSecondary, fontSize: 17 }}>
        Fleet management lives in the FleetSync web console. This app is for drivers and passengers.
      </Text>
    </RoleScreen>
  );
}
