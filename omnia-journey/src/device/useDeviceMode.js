import { useContext } from "react";
import { DeviceModeContext } from "./DeviceModeProvider.jsx";

export function useDeviceMode() {
  return useContext(DeviceModeContext);
}

export default useDeviceMode;

