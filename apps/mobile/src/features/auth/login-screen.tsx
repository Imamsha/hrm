import { emailSchema, totpCodeSchema } from '@hrm/validation';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Text } from '@/components/primitives';
import { errorMessage } from '@/lib/api';
import { useTheme } from '@/theme/theme';
import { signIn, verifyMfa } from './session';

function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'email-address' | 'number-pad' | 'default';
  autoComplete?: 'email' | 'password' | 'one-time-code';
}) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text variant="label">{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secureTextEntry ?? false}
        keyboardType={props.keyboardType ?? 'default'}
        autoComplete={props.autoComplete ?? 'off'}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          {
            borderColor: t.colors.input,
            color: t.colors.foreground,
            backgroundColor: t.colors.background,
          },
        ]}
        placeholderTextColor={t.colors.mutedForeground}
      />
    </View>
  );
}

export function LoginScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (mfaToken) {
      const parsed = totpCodeSchema.safeParse(code);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Invalid code');
        return;
      }
      setBusy(true);
      try {
        await verifyMfa(mfaToken, parsed.data);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success || password.length === 0) {
      setError('Enter your e-mail and password');
      return;
    }
    setBusy(true);
    try {
      const challenge = await signIn(parsedEmail.data, password);
      if (challenge) setMfaToken(challenge.mfaToken);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: t.colors.subtle, paddingTop: insets.top + 48 }]}
    >
      <Text variant="title">{mfaToken ? 'Two-factor verification' : 'Sign in'}</Text>
      <Text muted>{mfaToken ? 'Enter the code from your authenticator app.' : 'HRM Platform'}</Text>
      <Card style={styles.card}>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: t.colors.destructive }}>
            {error}
          </Text>
        ) : null}
        {mfaToken ? (
          <Field
            label="Authentication code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
          />
        ) : (
          <>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
            />
          </>
        )}
        <Button
          label={mfaToken ? 'Verify' : 'Sign in'}
          onPress={() => void submit()}
          loading={busy}
        />
      </Card>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, gap: 8 },
  card: { marginTop: 16 },
  field: { gap: 6 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 15 },
});
