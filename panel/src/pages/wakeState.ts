/** El servidor ya respondió /health en esta carga de la página (WakeGate no repite). */
let awake = false;

export const isAwake = (): boolean => awake;

export function markAwake(): void {
  awake = true;
}

/** Solo para pruebas: vuelve a pedir /health como en una carga nueva. */
export function resetWakeState(): void {
  awake = false;
}
