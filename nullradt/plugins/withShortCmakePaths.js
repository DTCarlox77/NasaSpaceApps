// Config plugin local: evita el límite de 260 caracteres de Windows al compilar C++ (CMake + ninja 1.10).
// Motivo: los archivos objeto de react-native-gesture-handler quedan en rutas de > 300 caracteres y
// ninja falla con "Filename longer than 260 characters". Con CMAKE_OBJECT_PATH_MAX bajo, CMake usa un
// hash corto como nombre de carpeta del objeto. No requiere activar LongPathsEnabled (admin).
// Uso en app.json: ["./plugins/withShortCmakePaths", { "max": 240 }]
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @nullradt short-cmake-paths';

module.exports = function withShortCmakePaths(config, { max = 240 } = {}) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    const block = `        ${MARKER}\n        externalNativeBuild {\n            cmake {\n                arguments "-DCMAKE_OBJECT_PATH_MAX=${max}"\n            }\n        }\n`;
    src = src.replace(/(defaultConfig \{\n)/, `$1${block}`);
    cfg.modResults.contents = src;
    return cfg;
  });
};
