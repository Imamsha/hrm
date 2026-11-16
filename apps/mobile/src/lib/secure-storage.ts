import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'hrm.auth.accessToken';
const REFRESH_TOKEN_KEY = 'hrm.auth.refreshToken';

/** Tokens live only in the OS keystore (Keychain / Android Keystore), never in AsyncStorage. */
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureTokens = {
  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY, options);
  },

  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY, options);
  },

  async setTokens(tokens: { accessToken: string; refreshToken: string }): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken, options);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken, options);
  },

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY, options);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, options);
  },
};
