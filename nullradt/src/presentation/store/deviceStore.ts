import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { randomId, sha256Hex } from '@/core/security/crypto';
import { onboardServer } from '@/data/onboard/onboardServer';

/**
 * Identidad de ESTA tableta.
 * - deviceId: público (línea base de la prueba de reacción por dispositivo, auditoría).
 * - credencial de dispositivo: secreto en el almacén cifrado; su huella la conoce el servidor a bordo.
 *   Una tableta registrada permite abrir el TRIAJE sin sesión (emergencia), y nada más.
 * La tableta principal de la demo viene registrada; el comandante puede registrar tabletas de repuesto.
 */
const SECRET_KEY = 'nullradt.deviceCredential';

interface DeviceState {
  deviceId: string;
  label: string;
  registered: boolean;
  registeredBy?: string;
  registeredAt?: string;
  ensure: () => Promise<void>;
  /** Registra esta tableta: guarda el secreto y devuelve su huella (la guarda el servidor a bordo). */
  register: (by: string, label: string) => Promise<string>;
  unregister: () => Promise<void>;
  /** Comprueba la credencial de dispositivo contra la huella registrada. */
  verifyCredential: (fingerprint: string | undefined) => Promise<boolean>;
}

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set, get) => ({
      deviceId: '',
      label: 'Tablet A',
      registered: false,
      ensure: async () => {
        if (!get().deviceId) set({ deviceId: `TAB-${randomId(6)}` });
        const secret = await SecureStore.getItemAsync(SECRET_KEY).catch(() => null);
        if (!secret && !get().registeredAt) {
          // Tableta principal: la registró control de misión antes del vuelo.
          const fingerprint = await get().register('NR-A-9001', 'Tablet A');
          onboardServer.provisionDevice({ deviceId: get().deviceId, label: 'Tablet A', fingerprint });
        }
      },
      register: async (by, label) => {
        const secret = randomId(32);
        await SecureStore.setItemAsync(SECRET_KEY, secret).catch(() => {});
        set({ registered: true, registeredBy: by, registeredAt: new Date().toISOString(), label });
        return sha256Hex(secret);
      },
      unregister: async () => {
        await SecureStore.deleteItemAsync(SECRET_KEY).catch(() => {});
        set({ registered: false, registeredBy: undefined, registeredAt: new Date().toISOString() });
      },
      verifyCredential: async (fingerprint) => {
        if (!get().registered || !fingerprint) return false;
        const secret = await SecureStore.getItemAsync(SECRET_KEY).catch(() => null);
        return !!secret && sha256Hex(secret) === fingerprint;
      },
    }),
    { name: 'nullradt-device', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
