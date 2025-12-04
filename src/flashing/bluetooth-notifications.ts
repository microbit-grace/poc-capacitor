import { BleClient } from "@capacitor-community/bluetooth-le";

/**
 * Manages shared notification listeners per characteristic.
 *
 * As recommended by the docs, we should only run `startNotifications` once per
 * characteristic and share the data.
 *
 * Doc: https://github.com/capacitor-community/bluetooth-le?tab=readme-ov-file#startnotifications
 */
class BluetoothNotificationManager {
  private listeners = new Map<string, Set<(data: Uint8Array) => void>>();

  private getKey(
    deviceId: string,
    serviceId: string,
    characteristicId: string
  ): string {
    return `${deviceId}:${serviceId}:${characteristicId}`;
  }

  async subscribe(
    deviceId: string,
    serviceId: string,
    characteristicId: string,
    callback: (data: Uint8Array) => void
  ): Promise<void> {
    const key = this.getKey(deviceId, serviceId, characteristicId);

    // Start notifications only if not already started.
    if (!this.listeners.has(key)) {
      await BleClient.startNotifications(
        deviceId,
        serviceId,
        characteristicId,
        (value: DataView) => {
          const bytes = new Uint8Array(value.buffer);
          // Notify all registered callbacks.
          this.listeners.get(key)?.forEach((cb) => cb(bytes));
        }
      );
    }

    // Add callback to listeners.
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
  }

  unsubscribe(
    deviceId: string,
    serviceId: string,
    characteristicId: string,
    callback: (data: Uint8Array) => void
  ): void {
    const key = this.getKey(deviceId, serviceId, characteristicId);
    this.listeners.get(key)?.delete(callback);
  }

  async cleanup(
    deviceId: string,
    serviceId: string,
    characteristicId: string
  ): Promise<void> {
    const key = this.getKey(deviceId, serviceId, characteristicId);

    if (this.listeners.has(key)) {
      await BleClient.stopNotifications(deviceId, serviceId, characteristicId);
      this.listeners.delete(key);
    }
  }

  async disconnectCleanup(): Promise<void> {
    this.listeners = new Map<string, Set<(data: Uint8Array) => void>>();
  }
}

export default BluetoothNotificationManager;
