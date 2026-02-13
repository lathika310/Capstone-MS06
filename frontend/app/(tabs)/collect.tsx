import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  createId,
  getDeviceInfo,
  type FingerprintReading,
  type FingerprintSample,
  useFingerprintStore,
} from '@/context/fingerprint-store';
import { useBleScanner } from '@/hooks/use-ble-scanner';

const OFFLINE_TIMEOUT_MS = 3000;
const TARGET_BEACON_UUID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

const median = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
};

export default function CollectScreen() {
  const {
    floorPlanId,
    sessionId,
    setSessionId,
    points,
    selectedPointId,
    samples,
    addSample,
    clearSamples,
    importSamples,
  } = useFingerprintStore();
  const [captureSeconds, setCaptureSeconds] = useState('8');
  const [isCapturing, setIsCapturing] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [windowMedians, setWindowMedians] = useState<Record<string, number>>({});
  const [captureCounts, setCaptureCounts] = useState<Record<string, number>>({});
  const [discarded, setDiscarded] = useState<Set<string>>(new Set());

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const samplesRef = useRef<Record<string, number[]>>({});
  const lastSeenRef = useRef<Record<string, number>>({});
  const discardRef = useRef<Set<string>>(new Set());

  const activePoint = useMemo(
    () => points.find((point) => point.id === selectedPointId) ?? null,
    [points, selectedPointId]
  );

  const { devices, isScanning, resetDevices, startScan, stopScan } = useBleScanner({
    targetUuid: TARGET_BEACON_UUID,
    onDeviceSeen: (reading) => {
      lastSeenRef.current[reading.id] = reading.lastSeen;
      if (!isCapturing || discardRef.current.has(reading.id)) {
        return;
      }
      const bucket = samplesRef.current[reading.id] ?? [];
      bucket.push(reading.rssi);
      samplesRef.current[reading.id] = bucket;
      setCaptureCounts((current) => ({
        ...current,
        [reading.id]: bucket.length,
      }));
    },
  });

  const deviceList = useMemo(
    () => Object.values(devices).sort((a, b) => a.id.localeCompare(b.id)),
    [devices]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const ensureActivePoint = () => {
    if (!activePoint) {
      Alert.alert('Select a point', 'Choose a point on the Points tab before capturing data.');
      return false;
    }
    return true;
  };

  const startCapture = () => {
    if (!ensureActivePoint()) {
      return;
    }
    const windowSeconds = Math.max(2, Math.min(30, Number(captureSeconds) || 8));
    setCaptureSeconds(String(windowSeconds));
    setIsCapturing(true);
    setSecondsLeft(windowSeconds);
    samplesRef.current = {};
    lastSeenRef.current = {};
    discardRef.current = new Set();
    setWindowMedians({});
    setCaptureCounts({});
    setDiscarded(new Set());

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          finishCapture();
          return 0;
        }
        const now = Date.now();
        Object.entries(lastSeenRef.current).forEach(([id, lastSeen]) => {
          if (now - lastSeen > OFFLINE_TIMEOUT_MS) {
            discardRef.current.add(id);
          }
        });
        setDiscarded(new Set(discardRef.current));
        return current - 1;
      });
    }, 1000);
  };

  const finishCapture = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsCapturing(false);
    const medians: Record<string, number> = {};
    Object.entries(samplesRef.current).forEach(([id, readings]) => {
      if (discardRef.current.has(id)) {
        return;
      }
      const med = median(readings);
      if (med != null) {
        medians[id] = med;
      }
    });
    setWindowMedians(medians);
  };

  const stopCapture = () => {
    if (!isCapturing) {
      return;
    }
    finishCapture();
  };

  const buildReadings = (entries: Array<[string, number]>): FingerprintReading[] =>
    entries.map(([deviceId, rssi]) => ({ deviceId, rssi }));

  const saveSample = (mode: string, readings: FingerprintReading[]) => {
    if (!ensureActivePoint()) {
      return;
    }
    const deviceInfo = getDeviceInfo();
    const sample: FingerprintSample = {
      id: createId(),
      timestamp: new Date().toISOString(),
      sessionId,
      floorPlanId,
      pointId: activePoint!.id,
      xMeters: activePoint!.xMeters,
      yMeters: activePoint!.yMeters,
      deviceModel: deviceInfo.deviceModel,
      osVersion: deviceInfo.osVersion,
      appVersion: deviceInfo.appVersion,
      mode,
      readings,
    };
    addSample(sample);
  };

  const captureSnapshot = () => {
    const entries = deviceList.map((device) => [device.id, device.rssi] as [string, number]);
    if (entries.length === 0) {
      Alert.alert('No devices', 'Start scanning and wait for BLE devices to appear.');
      return;
    }
    saveSample('live', buildReadings(entries));
  };

  const saveMedians = () => {
    const entries = Object.entries(windowMedians);
    if (entries.length === 0) {
      Alert.alert('No medians', 'Run a capture window first.');
      return;
    }
    const windowSeconds = Math.max(2, Math.min(30, Number(captureSeconds) || 8));
    saveSample(`median${windowSeconds}s`, buildReadings(entries));
  };

  const makeCsv = () => {
    const header =
      'timestamp,session_id,floor_plan_id,point_id,x_m,y_m,device_id,rssi,mode,device_model,os_version,app_version';
    const lines = [header];
    samples.forEach((sample) => {
      sample.readings.forEach((reading) => {
        lines.push(
          [
            sample.timestamp,
            sample.sessionId,
            sample.floorPlanId,
            sample.pointId,
            sample.xMeters,
            sample.yMeters,
            reading.deviceId,
            reading.rssi,
            sample.mode,
            sample.deviceModel,
            sample.osVersion,
            sample.appVersion,
          ]
            .map((value) => String(value).replace(/,/g, '_'))
            .join(',')
        );
      });
    });
    return lines.join('\n');
  };

  const exportFile = async (content: string, extension: string) => {
    if (!FileSystem.cacheDirectory) {
      Alert.alert('Export failed', 'File system cache directory is unavailable.');
      return;
    }
    const filename = `fingerprints-${Date.now()}.${extension}`;
    const uri = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
    await Share.share({
      message: `Fingerprint data file: ${uri}`,
      url: uri,
      title: 'Fingerprint data',
    });
  };

  const exportCsv = async () => {
    if (samples.length === 0) {
      Alert.alert('No samples', 'Capture samples before exporting.');
      return;
    }
    await exportFile(makeCsv(), 'csv');
  };

  const exportJsonl = async () => {
    if (samples.length === 0) {
      Alert.alert('No samples', 'Capture samples before exporting.');
      return;
    }
    const payload = samples.map((sample) => JSON.stringify(sample)).join('\n');
    await exportFile(payload, 'jsonl');
  };

  const importJsonl = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }
    const asset = result.assets[0];
    const contents = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
    const imported: FingerprintSample[] = [];
    contents
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        try {
          const parsed = JSON.parse(line) as FingerprintSample;
          if (parsed && parsed.readings) {
            imported.push(parsed);
          }
        } catch {
          // ignore invalid lines
        }
      });
    if (imported.length === 0) {
      Alert.alert('Import failed', 'No valid JSONL samples found.');
      return;
    }
    importSamples(imported);
  };

  const handleNewSession = () => {
    setSessionId(`session-${Date.now()}`);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Fingerprint collection</Text>
        <Text style={styles.subtitle}>Scan BLE, capture windows, and save fingerprint samples.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Session</Text>
          <TextInput value={sessionId} onChangeText={setSessionId} style={styles.input} />
          <TouchableOpacity style={styles.secondaryButton} onPress={handleNewSession}>
            <Text style={styles.secondaryButtonText}>Generate new session</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Active point</Text>
          {activePoint ? (
            <Text style={styles.value}>
              {activePoint.label} · x={activePoint.xMeters}m y={activePoint.yMeters}m
            </Text>
          ) : (
            <Text style={styles.value}>No point selected. Go to the Points tab.</Text>
          )}
          <Text style={styles.caption}>Floor plan: {floorPlanId}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>BLE scanning</Text>
          <Text style={styles.caption}>Filtering UUID: {TARGET_BEACON_UUID}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.button} onPress={startScan} disabled={isScanning}>
              <Text style={styles.buttonText}>{isScanning ? 'Scanning…' : 'Start scan'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonOutline} onPress={stopScan} disabled={!isScanning}>
              <Text style={styles.buttonOutlineText}>Stop</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonOutline} onPress={resetDevices}>
              <Text style={styles.buttonOutlineText}>Clear</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.caption}>{deviceList.length} devices seen</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Capture window</Text>
          <View style={styles.row}>
            <TextInput
              value={captureSeconds}
              onChangeText={setCaptureSeconds}
              keyboardType="numeric"
              style={[styles.input, styles.inputSmall]}
            />
            <TouchableOpacity style={styles.button} onPress={startCapture} disabled={isCapturing}>
              <Text style={styles.buttonText}>
                {isCapturing ? `Capturing ${secondsLeft}s` : 'Start capture'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonOutline} onPress={stopCapture} disabled={!isCapturing}>
              <Text style={styles.buttonOutlineText}>Stop</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.caption}>Offline timeout: {OFFLINE_TIMEOUT_MS / 1000}s</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Data actions</Text>
          <View style={styles.rowWrap}>
            <TouchableOpacity style={styles.button} onPress={captureSnapshot}>
              <Text style={styles.buttonText}>Capture snapshot</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={saveMedians}>
              <Text style={styles.buttonText}>Save medians</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonOutline} onPress={exportCsv}>
              <Text style={styles.buttonOutlineText}>Export CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonOutline} onPress={exportJsonl}>
              <Text style={styles.buttonOutlineText}>Export JSONL</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonOutline} onPress={importJsonl}>
              <Text style={styles.buttonOutlineText}>Import JSONL</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearButton} onPress={clearSamples}>
              <Text style={styles.clearButtonText}>Clear samples</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.caption}>Samples stored: {samples.length}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Live devices</Text>
          {deviceList.length === 0 ? (
            <Text style={styles.value}>No devices yet.</Text>
          ) : (
            deviceList.map((device) => {
              const isDiscarded = discarded.has(device.id);
              const samplesCount = captureCounts[device.id] ?? 0;
              const med = windowMedians[device.id];
              return (
                <View key={device.id} style={styles.deviceRow}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{device.name || device.id}</Text>
                    {isDiscarded ? (
                      <Text style={styles.discarded}>DISCARDED (offline &gt; 3s)</Text>
                    ) : isCapturing ? (
                      <Text style={styles.caption}>samples: {samplesCount}</Text>
                    ) : med != null ? (
                      <Text style={styles.caption}>median: {med} dBm</Text>
                    ) : null}
                  </View>
                  <Text style={styles.deviceRssi}>{device.rssi} dBm</Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#475569',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  label: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: '#64748B',
  },
  value: {
    color: '#0F172A',
  },
  caption: {
    color: '#64748B',
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  inputSmall: {
    minWidth: 70,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#1D4ED8',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: '#1D4ED8',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  buttonOutlineText: {
    color: '#1D4ED8',
    fontWeight: '600',
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  secondaryButtonText: {
    color: '#1D4ED8',
    fontWeight: '600',
  },
  clearButton: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  clearButtonText: {
    color: '#991B1B',
    fontWeight: '600',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  deviceInfo: {
    flex: 1,
    paddingRight: 8,
  },
  deviceName: {
    fontWeight: '600',
    color: '#0F172A',
  },
  deviceRssi: {
    color: '#0F172A',
  },
  discarded: {
    color: '#B91C1C',
    fontSize: 12,
  },
});
