import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Card, Text } from '@/components/primitives';
import { useTheme } from '@/theme/theme';
import { useAuth } from './auth-store';
import { signOut } from './session';

export function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const session = useAuth((s) => s.session);
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  const org = session.activeOrganization;

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={styles.content}
    >
      <Text variant="title">Hello, {session.user.fullName.split(' ')[0]}</Text>
      <Card>
        <Text variant="caption" muted>
          Organization
        </Text>
        <Text variant="heading">{org?.organizationName ?? 'No organization'}</Text>
        {org?.roles.length ? <Text muted>{org.roles.map((r) => r.name).join(', ')}</Text> : null}
      </Card>
      <Card>
        <Text variant="caption" muted>
          Signed in as
        </Text>
        <Text>{session.user.email}</Text>
        <Text muted>Two-factor authentication: {session.user.mfaEnabled ? 'on' : 'off'}</Text>
      </Card>
      {session.permissions.includes('attendance.self.use') ? (
        <Button
          label="Attendance"
          onPress={() => {
            router.push('/attendance');
          }}
        />
      ) : null}
      {session.permissions.includes('employees.self.access') ? (
        <Button
          label="My profile"
          onPress={() => {
            router.push('/profile');
          }}
        />
      ) : null}
      <Button
        label="System status"
        variant="outline"
        onPress={() => {
          router.push('/status');
        }}
      />
      <Button
        label="Sign out"
        variant="outline"
        loading={busy}
        onPress={() => {
          setBusy(true);
          void signOut().finally(() => {
            setBusy(false);
          });
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ content: { padding: 16, gap: 12 } });
