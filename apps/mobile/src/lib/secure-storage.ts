import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'hrm.auth.refreshToken';

/**
 * Only the refresh token is persisted, and only in the OS keystore (Keychain / Android Keystore),
 * never in AsyncStorage. Access tokens stay in memory.
 */
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureTokens = {
  getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY, options);
  },

  setRefreshToken(token: string): Promise<void> {
    return SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, options);
  },

  clear(): Promise<void> {
    return SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, options);
  },
};
