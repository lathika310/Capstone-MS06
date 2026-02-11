import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BleManager, type Device } from 'react-native-ble-plx';

export type BleDeviceReading = {
  id: string;
  name: string | null;
  rssi: number;
  lastSeen: number;
};

type BleScannerOptions = {
  onDeviceSeen?: (device: BleDeviceReading) => void;
};

export const useBleScanner = (options: BleScannerOptions = {}) => {
  const manager = useMemo(() => new BleManager(), []);
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<Record<string, BleDeviceReading>>({});
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    return () => {
      manager.destroy();
    };
  }, [manager]);

  const handleDevice = useCallback(
    (device: Device) => {
      if (device.rssi == null) {
        return;
      }
      const reading: BleDeviceReading = {
        id: device.id,
        name: device.name ?? device.localName ?? null,
        rssi: device.rssi,
        lastSeen: Date.now(),
      };
      setDevices((current) => ({
        ...current,
        [device.id]: reading,
      }));
      optionsRef.current.onDeviceSeen?.(reading);
    },
    []
  );

  const startScan = useCallback(() => {
    if (isScanning) {
      return;
    }
    setIsScanning(true);
    manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error) {
        setIsScanning(false);
        return;
      }
      if (device) {
        handleDevice(device);
      }
    });
  }, [handleDevice, isScanning, manager]);

  const stopScan = useCallback(() => {
    if (!isScanning) {
      return;
    }
    manager.stopDeviceScan();
    setIsScanning(false);
  }, [isScanning, manager]);

  const resetDevices = useCallback(() => {
    setDevices({});
  }, []);

  return {
    devices,
    isScanning,
    startScan,
    stopScan,
    resetDevices,
  };
};
