import BluetoothConnection from "./bluetoothConnection";
import { MICROBIT_DFU_SERVICE, NORDIC_DFU_SERVICE } from "./flashingConstants";

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
  connection: BluetoothConnection,
  desiredServiceUuid: string
) => {
  const isV1 =
    (await connection.hasService(MICROBIT_DFU_SERVICE)) ||
    (await connection.hasService(NORDIC_DFU_SERVICE));
  console.log("isV1", isV1);
  if (isV1) {
    const hasService = await connection.hasService(desiredServiceUuid);
    if (!hasService) {
      console.log("Missing service, clearing cache and refreshing services");
      await connection.refreshAndDiscoverServices();
    }
  }
};
