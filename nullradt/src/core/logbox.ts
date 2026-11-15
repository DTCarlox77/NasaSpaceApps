import { LogBox } from 'react-native';

/**
 * Advertencias conocidas e inofensivas en Expo Go.
 * Debe importarse ANTES que cualquier otro módulo (primera línea de src/app/_layout.tsx),
 * porque expo-notifications emite el aviso en cuanto se carga.
 * - Solo afectan a notificaciones PUSH remotas; las locales que usamos funcionan.
 */
LogBox.ignoreLogs([
  '`expo-notifications` functionality is not fully supported in Expo Go',
  '[expo-notifications] Push notifications (remote notifications) are unavailable in Expo Go',
]);
