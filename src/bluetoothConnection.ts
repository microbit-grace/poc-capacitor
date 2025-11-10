import { BleClient, BleDevice } from "@capacitor-community/bluetooth-le";

export enum WriteType {
  NoResponse = "NoResponse",
  Default = "Default",
}

type Characteristic = { serviceId: string; characteristicId: string };

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

    const result = await new Promise<BluetoothResult>((resolve) => {
      // Assumption: all the BT callbacks happen on the same thread
      // Write callback isn't called when writing without response
      let writeStatus: boolean | null =
        writeType === WriteType.NoResponse ? true : null;
      let notificationValue: Uint8Array | null = null;

      const resumeIfPossible = async () => {
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
        BleClient.startNotifications(
          this.device.deviceId,
          characteristic.serviceId,
          characteristic.characteristicId,
          (value: DataView) => {
            console.log("characteristicChanged received");
            // Convert DataView to Uint8Array
            notificationValue = new Uint8Array(value.buffer);
            resumeIfPossible();
          }
        );
      }

      cleanup = async () => {
        await BleClient.stopNotifications(
          this.device.deviceId,
          characteristic.serviceId,
          characteristic.characteristicId
        );
      };

      // Perform the write operation
      const write =
        writeType === WriteType.Default
          ? BleClient.write
          : BleClient.writeWithoutResponse;

      write(
        this.device.deviceId,
        characteristic.serviceId,
        characteristic.characteristicId,
        value
      )
        .then(() => {
          console.log("write completed successfully");
          writeStatus = true;
          resumeIfPossible();
        })
        .catch((error) => {
          console.log(`write failed: ${error}`);
          writeStatus = false;
          resumeIfPossible();
        });

      resumeIfPossible();
    }).finally(() => {
      if (cleanup) {
        cleanup();
      }
    });

    return result;
  }
}

export default BluetoothConnection;
