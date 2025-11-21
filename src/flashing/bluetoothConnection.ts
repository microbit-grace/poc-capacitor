import { BleClient, BleDevice } from "@capacitor-community/bluetooth-le";

export enum WriteType {
  NoResponse = "NoResponse",
  Default = "Default",
}

export type Characteristic = { serviceId: string; characteristicId: string };

type BluetoothResult = {
  status: boolean;
  value: Uint8Array | null;
};

export interface BleConnection {
  hasService(uuid: string): Promise<boolean>;

  refreshAndDiscoverServices(): Promise<void>;

  /**
   * Partial flashing writes to characteristics and expects a notification in response.
   */
  characteristicWriteNotificationWait(
    characteristic: Characteristic,
    value: DataView,
    writeType: WriteType,
    notificationId: number | null,
    isFinalNotification: (p: Uint8Array) => boolean
  ): Promise<BluetoothResult>;

  getCharacteristic(
    serviceId: string,
    characteristicId: string
  ): Promise<Characteristic | null>;

  setCharacteristicNotification(
    characteristic: Characteristic,
    enabled: boolean
  ): Promise<boolean>;

  disconnect(): Promise<void>;

  connect(): Promise<void>;
}

class BluetoothConnection implements BleConnection {
  device;

  constructor(device: BleDevice) {
    this.device = device;
  }
  async hasService(uuid: string) {
    // The iOS app does this differently, via the device information service
    // Perhaps that would let us make a more positive V1 ID.
    const services = await BleClient.getServices(this.device.deviceId);
    const foundService = services.find((s) => s.uuid === uuid);
    return !!foundService;
  }
  async refreshAndDiscoverServices(): Promise<void> {
    // The plugin discoverServices method includes clearing of internal cache
    // and refreshes the services.
    return BleClient.discoverServices(this.device.deviceId);
  }
  async getCharacteristic(
    serviceId: string,
    characteristicId: string
  ): Promise<Characteristic | null> {
    await this.refreshAndDiscoverServices();
    const services = await BleClient.getServices(this.device.deviceId);
    const foundService = services.find((s) => s.uuid === serviceId);
    if (!foundService) {
      return null;
    }
    const foundCharacteristic = foundService.characteristics.find(
      (c) => c.uuid === characteristicId
    );
    if (!foundCharacteristic) {
      return null;
    }
    return { serviceId, characteristicId };
  }
  async setCharacteristicNotification(
    characteristic: Characteristic,
    enabled: boolean
  ): Promise<boolean> {
    // If the specified characteristic's configuration allows both notifications
    // and indications, calling this method enables notifications only.
    const result = await new Promise<boolean>((resolve) => {
      const operation = enabled
        ? BleClient.startNotifications(
            this.device.deviceId,
            characteristic.serviceId,
            characteristic.characteristicId,
            (value: DataView) => {
              console.log("Notification", value);
              // This callback is for actual notification values, not state changes
              // You might want to store this callback elsewhere if needed
            }
          )
        : BleClient.stopNotifications(
            this.device.deviceId,
            characteristic.serviceId,
            characteristic.characteristicId
          );

      operation
        .then(() => {
          resolve(true);
        })
        .catch((error) => {
          console.error(`setNotification failed: ${error}`);
          resolve(false);
        });
    });
    return result;
  }
  async disconnect(): Promise<void> {
    return BleClient.disconnect(this.device.deviceId);
  }
  async connect(): Promise<void> {
    return BleClient.connect(this.device.deviceId);
  }

  async characteristicWriteNotificationWait(
    characteristic: Characteristic,
    value: DataView,
    writeType: WriteType,
    notificationId: number | null = null,
    isFinalNotification: (p: Uint8Array) => boolean = () => true
  ): Promise<BluetoothResult> {
    let cleanup: (() => void) | null = null;

    // eslint-disable-next-line no-async-promise-executor
    const result = await new Promise<BluetoothResult>(async (resolve) => {
      let writeStatus: boolean | null =
        writeType === WriteType.NoResponse ? true : null;
      let notificationValue: Uint8Array | null = null;

      const resumeIfPossible = () => {
        const writeStatusLocal = writeStatus;
        const notificationValueLocal = notificationValue;
        console.log(
          `Considering resume for writeStatus: ${writeStatusLocal} notificationValue: ${
            notificationValueLocal !== null
          }`
        );

        if (writeStatusLocal !== null) {
          if (writeStatusLocal === false) {
            resolve({ status: false, value: null });
          } else if (
            notificationId === null ||
            (notificationValueLocal !== null &&
              isFinalNotification(notificationValueLocal))
          ) {
            resolve({
              status: writeStatusLocal,
              value: notificationValueLocal,
            });
          }
        }
      };

      // Set up notification listener if needed
      if (notificationId !== null) {
        try {
          await BleClient.startNotifications(
            this.device.deviceId,
            characteristic.serviceId,
            characteristic.characteristicId,
            (value: DataView) => {
              console.log("characteristicChanged received");
              const bytes = new Uint8Array(value.buffer);
              if (notificationId === null || bytes[0] === notificationId) {
                notificationValue = bytes;
                resumeIfPossible();
              }
            }
          );
        } catch (error) {
          console.error("Failed to start notifications:", error);
          resolve({ status: false, value: null });
          return;
        }
      }

      cleanup = async () => {
        if (notificationId !== null) {
          try {
            await BleClient.stopNotifications(
              this.device.deviceId,
              characteristic.serviceId,
              characteristic.characteristicId
            );
          } catch (error) {
            console.error("Failed to stop notifications:", error);
          }
        }
      };

      // Perform the write operation
      try {
        if (writeType === WriteType.Default) {
          await BleClient.write(
            this.device.deviceId,
            characteristic.serviceId,
            characteristic.characteristicId,
            value
          );
        } else {
          await BleClient.writeWithoutResponse(
            this.device.deviceId,
            characteristic.serviceId,
            characteristic.characteristicId,
            value
          );
        }
        console.log("write completed successfully");
        writeStatus = true;
        resumeIfPossible();
      } catch (error) {
        console.log(`write failed: ${error}`);
        writeStatus = false;
        resumeIfPossible();
      }
    }).finally(async () => {
      if (cleanup) {
        cleanup();
      }
    });

    return result;
  }
}

export default BluetoothConnection;
