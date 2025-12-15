import { BleClient } from "@capacitor-community/bluetooth-le";
import { Device } from "./bluetooth";
import { DeviceVersion } from "./model";

// Device Information Service
export const DEVICE_INFORMATION_SERVICE =
  "0000180a-0000-1000-8000-00805f9b34fb";
export const MODEL_NUMBER_CHARACTERISTIC =
  "00002a24-0000-1000-8000-00805f9b34fb";

export class DeviceInformationService {
  constructor(private device: Device) {}

  async getDeviceVersion(): Promise<DeviceVersion> {
    // Read model number from Device Information Service to determine version
    const modelNumber = await BleClient.read(
      this.device.deviceId,
      DEVICE_INFORMATION_SERVICE,
      MODEL_NUMBER_CHARACTERISTIC
    );
    const decoder = new TextDecoder();
    const modelString = decoder.decode(modelNumber);
    this.device.log(`Model number from Device Information Service: ${modelString}`);
    if (modelString.includes("V2")) {
      return DeviceVersion.V2;
    }
    return DeviceVersion.V1;
  }
}
