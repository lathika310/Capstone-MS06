import Constants from 'expo-constants';
import React, { createContext, useContext, useMemo, useState } from 'react';
import { Platform } from 'react-native';

type FingerprintPoint = {
  id: string;
  label: string;
  floorPlanId: string;
  xPx: number;
  yPx: number;
  xMeters: number;
  yMeters: number;
};

type FingerprintReading = {
  deviceId: string;
  rssi: number;
};

type FingerprintSample = {
  id: string;
  timestamp: string;
  sessionId: string;
  floorPlanId: string;
  pointId: string;
  xMeters: number;
  yMeters: number;
  deviceModel: string;
  osVersion: string;
  appVersion: string;
  mode: string;
  readings: FingerprintReading[];
};

type FingerprintStore = {
  floorPlanId: string;
  pixelsPerMeter: number;
  sessionId: string;
  points: FingerprintPoint[];
  selectedPointId: string | null;
  samples: FingerprintSample[];
  setSelectedPointId: (id: string | null) => void;
  addPoint: (point: FingerprintPoint) => void;
  removePoint: (id: string) => void;
  addSample: (sample: FingerprintSample) => void;
  clearSamples: () => void;
  importSamples: (samples: FingerprintSample[]) => void;
  setSessionId: (sessionId: string) => void;
};

const DEFAULT_FLOOR_PLAN_ID = 'eng-1f';
const DEFAULT_PIXELS_PER_METER = 8;

const FingerprintStoreContext = createContext<FingerprintStore | null>(null);

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const getDeviceInfo = () => {
  const deviceModel =
    Constants.deviceName || Constants.expoConfig?.name || Constants.deviceYearClass?.toString() || 'unknown';
  const appVersion = Constants.expoConfig?.version || 'unknown';
  return {
    deviceModel,
    osVersion: `${Platform.OS} ${Platform.Version}`,
    appVersion,
  };
};

export function FingerprintStoreProvider({ children }: { children: React.ReactNode }) {
  const [points, setPoints] = useState<FingerprintPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [samples, setSamples] = useState<FingerprintSample[]>([]);
  const [sessionId, setSessionId] = useState(() => `session-${Date.now()}`);

  const addPoint = (point: FingerprintPoint) => {
    setPoints((current) => [...current, point]);
    setSelectedPointId(point.id);
  };

  const removePoint = (id: string) => {
    setPoints((current) => current.filter((point) => point.id !== id));
    setSelectedPointId((current) => (current === id ? null : current));
  };

  const addSample = (sample: FingerprintSample) => {
    setSamples((current) => [...current, sample]);
  };

  const clearSamples = () => {
    setSamples([]);
  };

  const importSamples = (imported: FingerprintSample[]) => {
    setSamples((current) => [...current, ...imported]);
  };

  const store = useMemo(
    () => ({
      floorPlanId: DEFAULT_FLOOR_PLAN_ID,
      pixelsPerMeter: DEFAULT_PIXELS_PER_METER,
      sessionId,
      points,
      selectedPointId,
      samples,
      setSelectedPointId,
      addPoint,
      removePoint,
      addSample,
      clearSamples,
      importSamples,
      setSessionId,
    }),
    [points, selectedPointId, samples, sessionId]
  );

  return <FingerprintStoreContext.Provider value={store}>{children}</FingerprintStoreContext.Provider>;
}

export const useFingerprintStore = () => {
  const context = useContext(FingerprintStoreContext);
  if (!context) {
    throw new Error('useFingerprintStore must be used within FingerprintStoreProvider');
  }
  return context;
};

export type { FingerprintPoint, FingerprintReading, FingerprintSample };
export { createId };
