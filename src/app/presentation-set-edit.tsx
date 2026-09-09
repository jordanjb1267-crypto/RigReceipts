import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card, ChoiceRow, Screen } from '@/components';
import { QuickPresentGate } from '@/components/roadWallet/QuickPresentGate';
import {
  archiveCustomPresentationSet,
  createCustomPresentationSet,
  PresentationSetDeniedError,
  setPresentationSetItems,
  updateCustomPresentationSet,
} from '@/data/presentationSets';
import {
  canUseFeature,
  documentKindLabel,
  includedItemsForSet,
  isQuickPresentEligibleDocument,
  PRESENTATION_SET_CANDIDATE_COPY,
  PRESENTATION_SET_NAME_MAX,
  QUICK_PRESENT_DISCLAIMER,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import { selectSetById, usePresentationSetsStore } from '@/store/presentationSets';
import { useRoadWalletStore } from '@/store/roadWallet';
import { useSubscriptionStore } from '@/store/subscription';
import { colors, radii, spacing, type } from '@/theme';

/**
 * Create / edit a custom Quick Present set. Entitlement is re-checked at the
 * effect boundary (`savedPresentationSets`). Free is sent to the soft paywall.
 */

export default function PresentationSetEditRoute() {
  return (
    <QuickPresentGate>
      <PresentationSetEditScreen />
    </QuickPresentGate>
  );
}

function PresentationSetEditScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; seed?: string }>();
  const userId = useAuthStore((s) => s.userId);
  const tier = useSubscriptionStore((s) => s.tier);
  const entitled = canUseFeature(tier, 'savedPresentationSets');
  const documents = useRoadWalletStore((s) => s.documents);
  const storeSets = usePresentationSetsStore((s) => s.sets);
  const storeItems = usePresentationSetsStore((s) => s.items);
  const existing = params.id ? selectSetById({ sets: storeSets, items: storeItems }, params.id, userId) : null;

  const seedIds = (params.seed ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const initialIds = existing
    ? includedItemsForSet(storeItems, existing.id).map((i) => i.operationalDocumentId)
    : seedIds;

  const [name, setName] = useState(existing?.name ?? '');
  const [selected, setSelected] = useState<string[]>(initialIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = useMemo(
    () => documents.filter((d) => isQuickPresentEligibleDocument(d, userId)),
    [documents, userId],
  );

  useEffect(() => {
    if (!entitled) {
      router.replace({ pathname: '/paywall', params: { trigger: 'saved_presentation_sets' } });
    }
  }, [entitled, router]);

  if (!entitled) {
    return null;
  }

  const toggle = (id: string) => {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      return [...cur, id];
    });
  };

  const move = (id: string, dir: -1 | 1) => {
    setSelected((cur) => {
      const i = cur.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        await Promise.resolve(updateCustomPresentationSet(existing.id, { name }));
        setPresentationSetItems(existing.id, selected);
        router.replace({ pathname: '/quick-present', params: { set: existing.id } });
      } else {
        const created = createCustomPresentationSet({ name, documentIds: selected });
        router.replace({ pathname: '/quick-present', params: { set: created.id } });
      }
    } catch (err) {
      if (err instanceof PresentationSetDeniedError && err.reason === 'NOT_ENTITLED') {
        router.replace({ pathname: '/paywall', params: { trigger: 'saved_presentation_sets' } });
        return;
      }
      if (err instanceof PresentationSetDeniedError && err.reason === 'FINANCIAL_BLOCKED') {
        setError('Financial documents stay out of Quick Present.');
      } else {
        setError('Could not save this set. Check the name and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      archiveCustomPresentationSet(existing.id);
      router.replace('/quick-present');
    } catch (err) {
      if (err instanceof PresentationSetDeniedError && err.reason === 'NOT_ENTITLED') {
        router.replace({ pathname: '/paywall', params: { trigger: 'saved_presentation_sets' } });
        return;
      }
      setError('Could not archive this set.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      kicker="Quick Present"
      title={existing ? 'Edit this set.' : 'Save a custom set.'}
    >
      <Text style={styles.disclaimer}>{QUICK_PRESENT_DISCLAIMER}</Text>
      <Text style={styles.muted}>{PRESENTATION_SET_CANDIDATE_COPY}</Text>
      <Card label="Name" style={styles.block}>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={PRESENTATION_SET_NAME_MAX}
          placeholder="Morning roadside"
          placeholderTextColor={colors.textGhost}
          style={styles.input}
          accessibilityLabel="Set name"
        />
      </Card>
      <Card label="Documents" style={styles.block}>
        {eligible.length === 0 ? (
          <Text style={styles.muted}>
            Add an active, non-financial document to your Road Wallet first.
          </Text>
        ) : (
          eligible.map((doc) => {
            const on = selected.includes(doc.id);
            const pos = selected.indexOf(doc.id);
            return (
              <View key={doc.id}>
                <ChoiceRow
                  title={doc.title}
                  subtitle={documentKindLabel(doc.documentKind)}
                  selected={on}
                  onPress={() => toggle(doc.id)}
                />
                {on && (
                  <View style={styles.reorder}>
                    <Button
                      label="Up"
                      variant="secondary"
                      onPress={() => move(doc.id, -1)}
                      disabled={pos <= 0}
                    />
                    <Button
                      label="Down"
                      variant="secondary"
                      onPress={() => move(doc.id, 1)}
                      disabled={pos === selected.length - 1}
                    />
                  </View>
                )}
              </View>
            );
          })
        )}
      </Card>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.rowGap}>
        <Button label={existing ? 'Save changes' : 'Save set'} onPress={() => void save()} loading={busy} />
        {existing && (
          <Button label="Archive set" variant="danger" onPress={() => void archive()} disabled={busy} />
        )}
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  disclaimer: { ...type.bodySmall, color: colors.textFaint, marginBottom: spacing.md },
  muted: { ...type.bodySmall, color: colors.textMuted },
  block: { marginTop: spacing.md },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.field,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  reorder: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  rowGap: { marginTop: spacing.lg, gap: spacing.sm },
  error: { ...type.bodySmall, color: colors.danger, marginTop: spacing.md },
});
