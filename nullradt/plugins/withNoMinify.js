// Config plugin local: desactiva R8/minify en release.
// Motivo: con minify activo, R8 elimina el constructor de androidx.work.impl.WorkDatabase_Impl
// (WorkManager lo instancia por reflexión) y la app se cierra al abrir:
// "NoSuchMethodException: androidx.work.impl.WorkDatabase_Impl.<init>".
const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withNoMinify(config) {
  return withGradleProperties(config, (cfg) => {
    const set = (key, value) => {
      const item = cfg.modResults.find((p) => p.type === 'property' && p.key === key);
      if (item) item.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    };
    set('android.enableMinifyInReleaseBuilds', 'false');
    set('android.enableShrinkResourcesInReleaseBuilds', 'false');
    return cfg;
  });
};
