import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '@/presentation/store/authStore';
import { setAssistantActive, useVoiceStore } from './voiceAssistant';
// Registra el ejecutor de comandos.
import './voiceCommands';

/** Enciende la escucha de "NullRadt" solo con la app al frente, habilitada y con sesión desbloqueada. */
export function useVoiceAssistant() {
  const enabled = useVoiceStore((s) => s.enabled);
  const unlocked = useAuthStore((s) => s.status === 'unlocked');
  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setAssistantActive(enabled && unlocked && foreground);
  }, [enabled, unlocked, foreground]);
}
