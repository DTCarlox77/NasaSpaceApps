// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * bcryptjs importa el módulo `crypto` de Node solo como respaldo. En React Native no existe:
 * lo resolvemos a un módulo vacío y bcryptjs usa la fuente aleatoria de expo-crypto
 * (ver src/core/security/crypto.ts → bcrypt.setRandomFallback).
 */
const emptyCrypto = path.resolve(__dirname, 'src/core/security/emptyNodeCrypto.js');
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'crypto') return { type: 'sourceFile', filePath: emptyCrypto };
  return defaultResolve ? defaultResolve(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
