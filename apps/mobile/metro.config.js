// Expo's default Metro config detects the pnpm monorepo (workspace root, watch folders)
// automatically since SDK 52. Shared @hrm/* packages are consumed from their built `dist`.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
