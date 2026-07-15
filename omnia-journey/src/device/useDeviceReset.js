import { useContext } from "react";
import { DeviceResetContext } from "./DeviceResetProvider.jsx";

export function useDeviceReset() {
  return useContext(DeviceResetContext);
}

export default useDeviceReset;
