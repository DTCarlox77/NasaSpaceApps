// Config plugin local: fija la versión del NDK de Android.
// Motivo: Expo SDK 58 usa por defecto NDK 27.1.12297006; en esta máquina está
// instalado el 28.2.13676358 y descargar el otro (~700 MB) por hotspot falló.
// Expo solo pone su valor por defecto si `ext.ndkVersion` no existe ("setIfNotExist"),
// así que lo definimos antes de `apply plugin: "expo-root-project"`.
// Uso en app.json: ["./plugins/withNdkVersion", { "version": "28.2.13676358" }]
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// @nullradt ndkVersion';

module.exports = function withNdkVersion(config, { version } = {}) {
  if (!version) return config;
  return withProjectBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    // Quitar una inserción previa (idempotente).
    src = src.replace(new RegExp(`${MARKER}\\n.*\\n`, 'g'), '');
    const block = `${MARKER}\next.ndkVersion = "${version}"\n`;
    const anchor = 'apply plugin: "expo-root-project"';
    cfg.modResults.contents = src.includes(anchor) ? src.replace(anchor, `${block}${anchor}`) : `${src}\n${block}`;
    return cfg;
  });
};
