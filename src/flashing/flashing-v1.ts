import { BleClient } from "@capacitor-community/bluetooth-le";
import { MICROBIT_DFU_SERVICE, NORDIC_DFU_SERVICE } from "./constants";

/**
 * V1 changes the service it offers in application/bootloader mode.
 *
 * We don't trust Android to have an up-to-date copy of services so will fall back
 * to calling internal API via reflection if the desired/expected service is not
 * listed.
 *
 * It might be that this is only needed for older versions of Android where we
 * can't get service changed indications.
 */
export const refreshServicesForV1IfDesiredServiceMissing = async (
  deviceId: string,
  desiredServiceUuid: string
) => {
  const services = await BleClient.getServices(deviceId);
  const isV1 = services.some(
    (s) => s.uuid === MICROBIT_DFU_SERVICE || s.uuid === NORDIC_DFU_SERVICE
  );
  console.log("isV1", isV1);
  if (isV1) {
    const deviceHasService = services.some(
      (s) => s.uuid === desiredServiceUuid
    );
    if (!deviceHasService) {
      await BleClient.discoverServices(deviceId);
    }
  }
};
