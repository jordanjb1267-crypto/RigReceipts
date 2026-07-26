import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Pill } from '@/components';
import {
  deriveLoadRate,
  DocumentType,
  documentTypeForScanType,
  documentTypeLabel,
  estimateAllMileTargets,
  isRecognizedDocScanType,
  loadMileage,
  loadRateStatusLabel,
  loadRateStatusTone,
  ReceivableType,
  receivableOutstanding,
  receivableStatusLabel,
  receivableTypeLabel,
  RECEIVABLE_TYPES,
  requiredDocsForLoad,
} from '@/domain';
import { useCapturesStore } from '@/store/captures';
import { useCostProfileStore } from '@/store/costProfile';
import { useLoadDocsStore } from '@/store/loadDocs';
import { normalizeLoad, useLoadsStore } from '@/store/loads';
import { useMileageStore } from '@/store/mileage';
import { useReceivablesStore } from '@/store/receivables';
import { colors, palette, radii, spacing, type } from '@/theme';

const num = (v: string): number | null => {
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Load detail: revenue + miles, documents, and receivables — the grade inputs. */
export default function LoadDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const rawLoad = useLoadsStore((s) => s.loads.find((l) => l.id === id));
  const updateLoad = useLoadsStore((s) => s.updateLoad);
  const profile = useCostProfileStore((s) => s.profile);

  const docs = useLoadDocsStore((s) => s.docs);
  const setDoc = useLoadDocsStore((s) => s.setDoc);
  const removeDoc = useLoadDocsStore((s) => s.removeDoc);

  const receivables = useReceivablesStore((s) => s.receivables);
  const addReceivable = useReceivablesStore((s) => s.addReceivable);
  const removeReceivable = useReceivablesStore((s) => s.removeReceivable);

  const captures = useCapturesStore((s) => s.captures);
  const assignCaptureToLoad = useCapturesStore((s) => s.assignCaptureToLoad);
  const segments = useMileageStore((s) => s.segments);

  const load = rawLoad ? normalizeLoad(rawLoad) : null;

  const [gross, setGross] = useState(load?.grossRate != null ? String(load.grossRate) : '');
  const [fsc, setFsc] = useState(load?.fuelSurcharge != null ? String(load.fuelSurcharge) : '');
  const [loaded, setLoaded] = useState(load?.loadedMiles != null ? String(load.loadedMiles) : '');
  const [deadhead, setDeadhead] = useState(
    load?.deadheadMiles != null ? String(load.deadheadMiles) : '',
  );

  const [rcvType, setRcvType] = useState<ReceivableType>('detention');
  const [rcvAmount, setRcvAmount] = useState('');

  const targets = useMemo(() => (profile ? estimateAllMileTargets(profile) : null), [profile]);

  if (!load) {
    return (
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.headerRow}>
            <Text style={styles.kicker}>Load Packets</Text>
            <Pressable
              accessibilityLabel="Close"
              onPress={() => router.back()}
              style={styles.closeBtn}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.title}>Load not found</Text>
        </View>
      </View>
    );
  }

  const presentTypes = docs
    .filter((d) => d.loadId === load.id && d.status !== 'missing')
    .map((d) => d.docType);

  const rate = deriveLoadRate(
    {
      grossRate: num(gross),
      fuelSurcharge: num(fsc),
      loadedMiles: num(loaded),
      deadheadMiles: num(deadhead),
      completed: false,
      bolRequired: load.bolRequired,
      presentDocTypes: [],
    },
    targets,
    profile?.variableCostPerMile,
  );

  const saveRevenue = () =>
    updateLoad(load.id, {
      grossRate: num(gross),
      fuelSurcharge: num(fsc),
      loadedMiles: num(loaded),
      deadheadMiles: num(deadhead),
    });

  const toggleDoc = (t: DocumentType, present: boolean) => {
    if (present) removeDoc(load.id, t);
    else setDoc(load.id, t, 'captured');
  };

  const actual = loadMileage(segments, load.id);
  const hasActual = actual.totalMiles > 0;
  const revenueNow = (num(gross) ?? 0) + (num(fsc) ?? 0);
  const actualAllMileRpm = hasActual && revenueNow > 0 ? revenueNow / actual.totalMiles : null;
  const actualEmpty = round1(actual.deadheadMiles + actual.otherBusinessMiles);
  const useActualMiles = () => {
    setLoaded(String(actual.loadedMiles));
    setDeadhead(String(actualEmpty));
    updateLoad(load.id, { loadedMiles: actual.loadedMiles, deadheadMiles: actualEmpty });
  };

  const required = requiredDocsForLoad(load.bolRequired);
  const docTypes: DocumentType[] = [
    'rate_confirmation',
    'bol',
    'pod',
    'scale_ticket',
    'lumper_receipt',
  ];
  const attachedScans = captures.filter((c) => c.loadId === load.id);
  const availableScans = captures.filter((c) => !c.loadId && isRecognizedDocScanType(c.scanType));
  const scannedTypes = new Set(attachedScans.map((c) => documentTypeForScanType(c.scanType)));
  const loadReceivables = receivables.filter((r) => r.loadId === load.id);

  const addRcv = () => {
    const amount = num(rcvAmount);
    if (!amount) return;
    addReceivable({
      loadId: load.id,
      type: rcvType,
      description: null,
      amountExpected: amount,
      status: 'submitted',
      dateIncurred: todayIso(),
      dateSubmitted: todayIso(),
    });
    setRcvAmount('');
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>Load Packets</Text>
          <Pressable
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>Load {load.loadNumber}</Text>
        {(load.origin || load.destination) && (
          <Text style={styles.subtitle}>
            {load.origin ?? '—'} → {load.destination ?? '—'}
          </Text>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Revenue & miles */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Revenue &amp; miles</Text>
            <Pill
              label={loadRateStatusLabel(rate.rateStatus)}
              tone={loadRateStatusTone(rate.rateStatus)}
            />
          </View>
          <View style={styles.grid}>
            <Field label="Gross rate" prefix="$" value={gross} onChange={setGross} />
            <Field label="Fuel surcharge" prefix="$" value={fsc} onChange={setFsc} />
            <Field label="Loaded miles" value={loaded} onChange={setLoaded} />
            <Field label="Deadhead miles" value={deadhead} onChange={setDeadhead} />
          </View>
          {rate.allMileRpm !== null && (
            <Text style={styles.derived}>
              {usd(rate.revenue ?? 0)} over {rate.totalMiles} mi · {rate.loadedRpm?.toFixed(2)}
              /loaded mi · {rate.allMileRpm.toFixed(2)}/all mi
              {rate.estimatedContribution !== null
                ? ` · est. contribution ${usd(rate.estimatedContribution)}`
                : ''}
            </Text>
          )}
          {!targets && (
            <Text style={styles.hint}>Set your costs in RPM Coach to see a rate status.</Text>
          )}
          <Button label="Save revenue" onPress={saveRevenue} />
        </View>

        {/* Actual miles from Live Mileage */}
        {hasActual && (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Actual miles · Live Mileage</Text>
              {actualAllMileRpm !== null && (
                <Pill label={`${actualAllMileRpm.toFixed(2)}/mi`} tone="green" />
              )}
            </View>
            <Text style={styles.derived}>
              {actual.loadedMiles} loaded · {actual.deadheadMiles} deadhead
              {actual.otherBusinessMiles > 0
                ? ` · ${actual.otherBusinessMiles} other business`
                : ''}{' '}
              · {actual.totalMiles} total
            </Text>
            {rate.allMileRpm !== null && actualAllMileRpm !== null && (
              <Text style={styles.hint}>
                Estimated all-mile RPM {rate.allMileRpm.toFixed(2)} → actual{' '}
                {actualAllMileRpm.toFixed(2)}.
              </Text>
            )}
            <Button label="Use actual miles" variant="secondary" onPress={useActualMiles} />
          </View>
        )}

        {/* Documents */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Documents</Text>
          <View style={styles.bolRow}>
            <Text style={styles.bolLabel}>BOL required for this load</Text>
            <Switch
              value={load.bolRequired}
              onValueChange={(v) => updateLoad(load.id, { bolRequired: v })}
              trackColor={{ true: palette.routeGreen, false: '#c9c5bc' }}
            />
          </View>
          {docTypes.map((t) => {
            const present = presentTypes.includes(t);
            const isRequired = required.includes(t);
            return (
              <View key={t} style={styles.docRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docLabel}>
                    {documentTypeLabel(t)}
                    {scannedTypes.has(t) ? <Text style={styles.scanned}> · scanned</Text> : null}
                  </Text>
                  {isRequired && <Text style={styles.docReq}>Required for completed loads</Text>}
                </View>
                <Switch
                  value={present || scannedTypes.has(t)}
                  disabled={scannedTypes.has(t)}
                  onValueChange={() => toggleDoc(t, present)}
                  trackColor={{ true: palette.routeGreen, false: '#c9c5bc' }}
                />
              </View>
            );
          })}
        </View>

        {/* Attached scans */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Attached scans</Text>
          {attachedScans.length === 0 && availableScans.length === 0 ? (
            <Text style={styles.hint}>
              Scans you capture on the Scan tab can be filed here — a BOL or POD then counts toward
              this load&apos;s paperwork automatically.
            </Text>
          ) : (
            <>
              {attachedScans.map((c) => (
                <View key={c.id} style={styles.docRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docLabel}>
                      {documentTypeLabel(documentTypeForScanType(c.scanType))}
                    </Text>
                    {c.vendor && <Text style={styles.docReq}>{c.vendor}</Text>}
                  </View>
                  <Pressable
                    accessibilityLabel="Detach scan"
                    hitSlop={8}
                    onPress={() => assignCaptureToLoad(c.id, null)}
                  >
                    <Text style={styles.remove}>Detach</Text>
                  </Pressable>
                </View>
              ))}
              {availableScans.length > 0 && <Text style={styles.attachHeading}>Attach a scan</Text>}
              {availableScans.map((c) => (
                <View key={c.id} style={styles.docRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docLabel}>
                      {documentTypeLabel(documentTypeForScanType(c.scanType))}
                    </Text>
                    <Text style={styles.docReq}>
                      {c.vendor ?? c.date ?? new Date(c.createdAt).toISOString().slice(0, 10)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Attach scan"
                    hitSlop={8}
                    onPress={() => assignCaptureToLoad(c.id, load.id)}
                  >
                    <Text style={styles.attach}>Attach</Text>
                  </Pressable>
                </View>
              ))}
            </>
          )}
        </View>

        {/* Receivables */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Money owed</Text>
          {loadReceivables.length === 0 ? (
            <Text style={styles.hint}>No detention, lumper, or reimbursements logged yet.</Text>
          ) : (
            loadReceivables.map((r) => (
              <View key={r.id} style={styles.rcvRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rcvType}>{receivableTypeLabel(r.type)}</Text>
                  <Text style={styles.rcvMeta}>
                    {usd(r.amountExpected)} · {receivableStatusLabel(r.status)}
                    {receivableOutstanding(r) > 0
                      ? ` · ${usd(receivableOutstanding(r))} outstanding`
                      : ''}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Remove"
                  hitSlop={8}
                  onPress={() => removeReceivable(r.id)}
                >
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            ))
          )}
          <View style={styles.addRcv}>
            <Pressable
              accessibilityLabel="Change type"
              onPress={() => {
                const i = RECEIVABLE_TYPES.indexOf(rcvType);
                setRcvType(RECEIVABLE_TYPES[(i + 1) % RECEIVABLE_TYPES.length]);
              }}
              style={styles.typeChip}
            >
              <Text style={styles.typeChipText}>{receivableTypeLabel(rcvType)}</Text>
            </Pressable>
            <TextInput
              value={rcvAmount}
              onChangeText={(v) => setRcvAmount(v.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="Amount owed"
              placeholderTextColor="rgba(244,241,232,0.3)"
              style={styles.rcvInput}
              accessibilityLabel="Amount owed"
            />
            <Button label="Add" variant="secondary" disabled={!num(rcvAmount)} onPress={addRcv} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  prefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputRow}>
        {prefix && <Text style={styles.prefix}>{prefix}</Text>}
        <TextInput
          value={value}
          onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="rgba(244,241,232,0.3)"
          style={styles.fieldInput}
          accessibilityLabel={label}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: spacing.xl },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  kicker: { ...type.label, color: colors.textMuted },
  closeBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(244, 241, 232, 0.06)',
    borderRadius: radii.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  closeText: { color: colors.text, fontSize: 15 },
  title: { ...type.h1, color: colors.text, marginTop: spacing.sm },
  subtitle: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  cardHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  cardTitle: { ...type.h2, color: colors.text, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  field: { flexBasis: '46%', flexGrow: 1, marginBottom: spacing.sm },
  fieldLabel: { ...type.labelTiny, color: colors.textMuted, marginBottom: 4 },
  fieldInputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  prefix: { ...type.body, color: colors.textMuted, marginRight: 2 },
  fieldInput: { ...type.body, color: colors.text, flex: 1, paddingVertical: spacing.sm },
  derived: { ...type.bodySmall, color: colors.text, marginBottom: spacing.md, marginTop: 4 },
  hint: { ...type.bodySmall, color: colors.textMuted, marginBottom: spacing.md },
  bolRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  bolLabel: { ...type.body, color: colors.text },
  docRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: spacing.sm + 2,
  },
  docLabel: { ...type.body, color: colors.text },
  docReq: { ...type.labelTiny, color: colors.textMuted, marginTop: 2 },
  scanned: { ...type.labelTiny, color: palette.routeGreen },
  attach: { ...type.labelTiny, color: palette.highwayBlue },
  attachHeading: { ...type.labelTiny, color: colors.textMuted, marginTop: spacing.md },
  rcvRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: spacing.sm + 2,
  },
  rcvType: { ...type.emphasis, color: colors.text },
  rcvMeta: { ...type.bodySmall, color: colors.textMuted, marginTop: 2 },
  remove: { ...type.labelTiny, color: palette.clayRust },
  addRcv: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  typeChip: {
    backgroundColor: 'rgba(46, 107, 87, 0.10)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  typeChipText: { ...type.labelTiny, color: colors.cta },
  rcvInput: {
    ...type.body,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    color: colors.text,
    flex: 1,
    paddingVertical: spacing.sm,
  },
});
