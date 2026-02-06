import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import FloorPlanView from '@/components/floor-plan-view';
import { useFingerprintStore } from '@/context/fingerprint-store';

const FLOOR_PLAN_IMAGE = require('@/assets/images/CampusMapEng1stFloor.png');

export default function NavigateScreen() {
  const { points, samples, selectedPointId } = useFingerprintStore();

  const lastSample = samples[samples.length - 1];
  const activePointId = lastSample?.pointId || selectedPointId;
  const activePoint = useMemo(
    () => points.find((point) => point.id === activePointId) ?? null,
    [points, activePointId]
  );

  return (
    <View style={styles.container}>
      <View style={styles.mapCard}>
        <FloorPlanView imageSource={FLOOR_PLAN_IMAGE} points={points} activePointId={activePointId} />
      </View>
      <ScrollView contentContainerStyle={styles.panel}>
        <Text style={styles.title}>Navigation view</Text>
        <Text style={styles.subtitle}>Shows the most recent fingerprint point as your position.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Current estimate</Text>
          {activePoint ? (
            <Text style={styles.value}>
              {activePoint.label} · x={activePoint.xMeters}m y={activePoint.yMeters}m
            </Text>
          ) : (
            <Text style={styles.value}>Capture a fingerprint sample to set a position.</Text>
          )}
          <Text style={styles.caption}>Last sample: {lastSample?.timestamp ?? 'none'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Points loaded</Text>
          <Text style={styles.value}>{points.length} points on the floor plan.</Text>
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
  mapCard: {
    height: 300,
    padding: 12,
  },
  panel: {
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
  },
  label: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: '#64748B',
    marginBottom: 6,
  },
  value: {
    color: '#0F172A',
  },
  caption: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 6,
  },
});
