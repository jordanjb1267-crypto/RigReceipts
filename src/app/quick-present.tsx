import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  AppStateStatus,
  Dimensions,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Card, ChoiceRow, Pill, RouteBand, Screen } from '@/components';
import { QuickPresentGate } from '@/components/roadWallet/QuickPresentGate';
import { shareErrorCopy } from '@/components/roadWallet/errorCopy';
import {
  activePresentationSession,
  buildQuickPresentSession,
  destroyPresentationSession,
  PresentationSetDeniedError,
  runPresentationPreflight,
  selectedIdsForCustomSet,
  systemSetIdentity,
} from '@/data/presentationSets';
import { ShareDeniedError, shareOperationalDocumentVersion } from '@/data/roadWallet';
import { restoreDocumentVersionToDevice } from '@/data/roadWalletRecovery';
import {
  canUseFeature,
  documentKindLabel,
  isQuickPresentEligibleDocument,
  PERSONAL_PRESENT_ACK_COPY,
  PRESENTATION_SET_CANDIDATE_COPY,
  PreflightItem,
  PreflightResult,
  PresentationSession,
  PresentationSet,
  preflightStateCopy,
  QUICK_PRESENT_DISCLAIMER,
  SHARE_CONFIRMATION_COPY,
  suggestSystemSetItems,
  SystemPresentationSetCode,
  systemSetLabel,
  VALIDITY_LABEL,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import {
  selectActiveVisiblePresentationSets,
  usePresentationSetsStore,
} from '@/store/presentationSets';
import { useRoadWalletStore } from '@/store/roadWallet';
import { useSubscriptionStore } from '@/store/subscription';
import { colors, spacing, Tone, type } from '@/theme';

/**
 * Quick Present — in-person presentation over Road Wallet. Does not create
 * legal authority, send files, email, portal-submit or sign. Flow:
 * SELECT SET → REVIEW → PREFLIGHT → READY/PARTIAL/EMPTY → explicit Present →
 * privacy-bounded IMAGE session → EXIT.
 */

type Stage = 'landing' | 'review' | 'preflight' | 'presenting';

export default function QuickPresentRoute() {
  return (
    <QuickPresentGate>
      <QuickPresentScreen />
    </QuickPresentGate>
  );
}

function QuickPresentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    set?: string;
    code?: string;
  }>();
  const userId = useAuthStore((s) => s.userId);
  const tier = useSubscriptionStore((s) => s.tier);
  const documents = useRoadWalletStore((s) => s.documents);
  const sets = usePresentationSetsStore((s) => s.sets);
  const items = usePresentationSetsStore((s) => s.items);
  const canSaveSets = canUseFeature(tier, 'savedPresentationSets');

  const [stage, setStage] = useState<Stage>('landing');
  const [code, setCode] = useState<SystemPresentationSetCode | null>(null);
  const [customSetId, setCustomSetId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [session, setSession] = useState<PresentationSession | null>(null);
  const [personalAck, setPersonalAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const customSets = useMemo(
    () => selectActiveVisiblePresentationSets({ sets, items }, userId),
    [sets, items, userId],
  );

  const eligibleWallet = useMemo(
    () => documents.filter((d) => isQuickPresentEligibleDocument(d, userId)),
    [documents, userId],
  );

  const openSystem = useCallback(
    (next: SystemPresentationSetCode) => {
      const suggested = suggestSystemSetItems(next, documents, userId).map((d) => d.id);
      setCode(next);
      setCustomSetId(null);
      setSelectedIds(suggested);
      setPersonalAck(false);
      setPreflight(null);
      setSession(null);
      setStage('review');
    },
    [documents, userId],
  );

  const openCustom = useCallback(
    (id: string) => {
      if (!canSaveSets) {
        router.push({ pathname: '/paywall', params: { trigger: 'saved_presentation_sets' } });
        return;
      }
      const live = usePresentationSetsStore.getState().sets.find((s) => s.id === id);
      if (!live || live.accountOwnerId !== userId || live.lifecycle !== 'ACTIVE') {
        setNotice('This saved set is archived and cannot be presented.');
        setStage('landing');
        return;
      }
      setCustomSetId(id);
      setCode(null);
      setSelectedIds(selectedIdsForCustomSet(id));
      setPersonalAck(false);
      setPreflight(null);
      setSession(null);
      setStage('review');
    },
    [canSaveSets, router, userId],
  );

  useFocusEffect(
    useCallback(() => {
      if (params.code === 'ROADSIDE' || params.code === 'SHIPPER') {
        openSystem(params.code);
      } else if (params.set) {
        openCustom(params.set);
      }
      return () => {
        if (activePresentationSession()) {
          destroyPresentationSession();
        }
      };
    }, [params.code, params.set, openSystem, openCustom]),
  );

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') return;
      destroyPresentationSession();
      setSession(null);
      if (stage === 'presenting') {
        setStage('landing');
        setNotice('Presentation ended when the app left the foreground. Rebuild to present again.');
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [stage]);

  const setIdentity = (): { id: string; setKind: PresentationSet['setKind']; name: string } => {
    if (customSetId) {
      const set = customSets.find((s) => s.id === customSetId);
      return {
        id: customSetId,
        setKind: 'CUSTOM',
        name: set?.name ?? 'Custom set',
      };
    }
    return systemSetIdentity(code ?? 'ROADSIDE');
  };

  const runPreflight = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await runPresentationPreflight(selectedIds);
      setPreflight(result);
      setStage('preflight');
    } catch (err) {
      if (err instanceof PresentationSetDeniedError && err.reason === 'PREFLIGHT_SESSION_CHANGED') {
        setNotice('Account changed. Check these copies again in this session.');
        setPreflight(null);
      } else {
        setNotice('Could not check these copies. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const presentReady = async () => {
    if (!preflight || preflight.readyCount === 0) return;
    if (AppState.currentState !== 'active') {
      destroyPresentationSession();
      setNotice('Presentation is only available while the app is in the foreground.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const identity = setIdentity();
      const built = await buildQuickPresentSession({
        setId: identity.id,
        setKind: identity.setKind,
        setName: identity.name,
        documentIds: preflight.items.filter((i) => i.state === 'READY').map((i) => i.logicalDocumentId),
        personalAcknowledged: personalAck,
      });
      if (AppState.currentState !== 'active') {
        destroyPresentationSession();
        setNotice('Presentation ended when the app left the foreground. Rebuild to present again.');
        return;
      }
      setSession(built);
      setStage('presenting');
    } catch (err) {
      destroyPresentationSession();
      if (err instanceof PresentationSetDeniedError && err.reason === 'PERSONAL_ACK_REQUIRED') {
        setNotice(PERSONAL_PRESENT_ACK_COPY.body);
      } else if (err instanceof PresentationSetDeniedError && err.reason === 'NOT_ENTITLED') {
        router.push({ pathname: '/paywall', params: { trigger: 'saved_presentation_sets' } });
      } else if (err instanceof PresentationSetDeniedError && err.reason === 'SET_ARCHIVED') {
        setNotice('This saved set is archived and cannot be presented.');
      } else if (err instanceof PresentationSetDeniedError && err.reason === 'APP_BACKGROUNDED') {
        setNotice('Presentation ended when the app left the foreground. Rebuild to present again.');
      } else {
        setNotice('Could not start presentation. Check the files on this device and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const exitPresent = () => {
    destroyPresentationSession();
    setSession(null);
    setStage('landing');
  };

  const toggleId = (id: string) => {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  if (stage === 'presenting' && session) {
    return <PresentationPager session={session} onExit={exitPresent} />;
  }

  if (stage === 'preflight' && preflight) {
    return (
      <Screen kicker="Quick Present" title="Check these copies first.">
        <Text style={styles.disclaimer}>{QUICK_PRESENT_DISCLAIMER}</Text>
        <Card
          label="Preflight"
          labelRight={
            preflight.overall === 'READY'
              ? 'Ready'
              : preflight.overall === 'PARTIAL'
                ? 'Partial'
                : 'Nothing ready'
          }
          style={styles.block}
        >
          <Text style={styles.body}>
            {preflight.readyCount} ready / {preflight.notReadyCount} not ready
          </Text>
          <Text style={styles.muted}>
            READY means every selected item is a freshly verified image on this device. Cached
            status is never trusted.
          </Text>
        </Card>
        {preflight.items.map((item) => (
          <PreflightRow
            key={item.logicalDocumentId}
            item={item}
            onRestore={async () => {
              setBusy(true);
              try {
                await restoreDocumentVersionToDevice(item.logicalDocumentId);
                const next = await runPresentationPreflight(selectedIds);
                setPreflight(next);
              } catch {
                setNotice('Restore failed. The file stays on your account; try again on a better connection.');
              } finally {
                setBusy(false);
              }
            }}
            onSharePdf={async (confirmation) => {
              try {
                await shareOperationalDocumentVersion({
                  documentId: item.logicalDocumentId,
                  sensitiveConfirmation: confirmation,
                });
              } catch (err) {
                if (err instanceof ShareDeniedError && err.reason === 'NOT_ENTITLED') {
                  router.push({ pathname: '/paywall', params: { trigger: 'document_share_export' } });
                } else {
                  setNotice(shareErrorCopy(err).body);
                }
              }
            }}
            canShare={canUseFeature(tier, 'documentShareExport')}
          />
        ))}
        {preflight.needsPersonalAck && (
          <Card label="Personal-sensitive" style={styles.block}>
            <Text style={styles.body}>{PERSONAL_PRESENT_ACK_COPY.body}</Text>
            <View style={styles.rowGap}>
              <Button
                label={personalAck ? 'Acknowledged' : PERSONAL_PRESENT_ACK_COPY.confirm}
                variant={personalAck ? 'secondary' : 'primary'}
                onPress={() => setPersonalAck(true)}
              />
            </View>
          </Card>
        )}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <View style={styles.rowGap}>
          {preflight.overall === 'READY' && (
            <Button
              label="Present"
              onPress={() => void presentReady()}
              loading={busy}
              disabled={preflight.needsPersonalAck && !personalAck}
            />
          )}
          {preflight.overall === 'PARTIAL' && preflight.readyCount > 0 && (
            <Button
              label={`Present ${preflight.readyCount} ready ${preflight.readyCount === 1 ? 'image' : 'images'}`}
              onPress={() => void presentReady()}
              loading={busy}
              disabled={preflight.needsPersonalAck && !personalAck}
            />
          )}
          <Button label="Back to review" variant="secondary" onPress={() => setStage('review')} />
        </View>
      </Screen>
    );
  }

  if (stage === 'review') {
    const identity = setIdentity();
    const extras = eligibleWallet.filter((d) => !selectedIds.includes(d.id));
    return (
      <Screen kicker="Quick Present" title={identity.name}>
        <Text style={styles.disclaimer}>{QUICK_PRESENT_DISCLAIMER}</Text>
        <Text style={styles.muted}>{PRESENTATION_SET_CANDIDATE_COPY}</Text>
        {selectedIds.length === 0 ? (
          <Card style={styles.block}>
            <Text style={styles.emptyTitle}>Nothing selected.</Text>
            <Text style={styles.muted}>
              Add an active, non-financial document from your wallet to review it for presentation.
            </Text>
          </Card>
        ) : (
          selectedIds.map((id) => {
            const doc = documents.find((d) => d.id === id);
            if (!doc) return null;
            return (
              <RouteBand
                key={id}
                marker="✓"
                markerTone="green"
                title={doc.title}
                subtitle={documentKindLabel(doc.documentKind)}
                onPress={() => toggleId(id)}
              />
            );
          })
        )}
        {extras.length > 0 && (
          <Card label="Add from your wallet" style={styles.block}>
            {extras.map((doc) => (
              <ChoiceRow
                key={doc.id}
                title={doc.title}
                subtitle={documentKindLabel(doc.documentKind)}
                selected={false}
                onPress={() => toggleId(doc.id)}
              />
            ))}
          </Card>
        )}
        <View style={styles.rowGap}>
          <Button label="Check these copies" onPress={() => void runPreflight()} loading={busy} />
          {identity.setKind !== 'CUSTOM' && (
            <Button
              label="Save as custom set"
              variant="secondary"
              onPress={() => {
                if (!canSaveSets) {
                  router.push({ pathname: '/paywall', params: { trigger: 'saved_presentation_sets' } });
                  return;
                }
                router.push({
                  pathname: '/presentation-set-edit',
                  params: { seed: selectedIds.join(',') },
                });
              }}
            />
          )}
          {identity.setKind === 'CUSTOM' && canSaveSets && (
            <Button
              label="Edit this set"
              variant="secondary"
              onPress={() =>
                router.push({ pathname: '/presentation-set-edit', params: { id: identity.id } })
              }
            />
          )}
          <Button label="Back" variant="secondary" onPress={() => setStage('landing')} />
        </View>
        <Text style={styles.hint}>
          Temporary changes here are not saved unless you explicitly save a custom set.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      kicker="Quick Present"
      title="Show copies in person."
      headerRight={<Pill label="In person" tone="neutral" />}
    >
      <Text style={styles.disclaimer}>{QUICK_PRESENT_DISCLAIMER}</Text>
      <Text style={styles.body}>
        Pick a set, review what will be shown, then present verified images one at a time. Nothing
        is emailed, submitted or signed.
      </Text>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.block}>
        <ChoiceRow
          title={systemSetLabel('ROADSIDE')}
          subtitle={PRESENTATION_SET_CANDIDATE_COPY}
          onPress={() => openSystem('ROADSIDE')}
        />
        <ChoiceRow
          title={systemSetLabel('SHIPPER')}
          subtitle={PRESENTATION_SET_CANDIDATE_COPY}
          onPress={() => openSystem('SHIPPER')}
        />
      </View>

      {canSaveSets ? (
        <Card label="Your saved sets" style={styles.block}>
          {customSets.length === 0 ? (
            <Text style={styles.muted}>No saved sets yet.</Text>
          ) : (
            customSets.map((set) => (
              <ChoiceRow
                key={set.id}
                title={set.name}
                subtitle={`${selectedIdsForCustomSet(set.id).length} documents`}
                onPress={() => openCustom(set.id)}
              />
            ))
          )}
          <View style={styles.rowGap}>
            <Button
              label="Create a custom set"
              variant="secondary"
              onPress={() => router.push('/presentation-set-edit')}
            />
          </View>
        </Card>
      ) : (
        <Card label="Saved sets" style={styles.block}>
          <Text style={styles.body}>
            Driver Pro lets you build and save custom Quick Present sets beyond Roadside and
            Shipper.
          </Text>
          <View style={styles.rowGap}>
            <Button
              label="See Driver Pro"
              variant="secondary"
              onPress={() =>
                router.push({ pathname: '/paywall', params: { trigger: 'saved_presentation_sets' } })
              }
            />
          </View>
        </Card>
      )}

    </Screen>
  );
}

function PreflightRow({
  item,
  onRestore,
  onSharePdf,
  canShare,
}: {
  item: PreflightItem;
  onRestore: () => void;
  onSharePdf: (confirmation: 'NONE' | 'PERSONAL_ACKNOWLEDGED') => void;
  canShare: boolean;
}) {
  const [shareAck, setShareAck] = useState(false);
  const tone: Tone =
    item.state === 'READY' ? 'green' : item.state === 'FINANCIAL_BLOCKED' ? 'rust' : 'amber';
  const personalShare = SHARE_CONFIRMATION_COPY.PERSONAL_ACKNOWLEDGED;
  return (
    <Card style={styles.block}>
      <View style={styles.preflightHead}>
        <Text style={styles.h2}>{item.title}</Text>
        <Pill label={preflightStateCopy(item.state)} tone={tone} />
      </View>
      <Text style={styles.muted}>{documentKindLabel(item.documentKind)}</Text>
      {item.canRestore &&
        (item.state === 'MISSING_FILE' || item.state === 'NOT_CACHED' || item.state === 'NO_VERSION') && (
          <View style={styles.rowGap}>
            <Button label="Restore to this device" variant="secondary" onPress={onRestore} />
            <Button label="Prepare offline" variant="secondary" onPress={onRestore} />
          </View>
        )}
      {item.state === 'PDF_EXTERNAL_ONLY' && canShare && item.personalSensitive && !shareAck && (
        <View style={styles.rowGap}>
          <Text style={styles.muted}>{personalShare.body}</Text>
          <Button label={personalShare.confirm} variant="secondary" onPress={() => setShareAck(true)} />
        </View>
      )}
      {item.state === 'PDF_EXTERNAL_ONLY' &&
        canShare &&
        (!item.personalSensitive || shareAck) && (
          <View style={styles.rowGap}>
            <Button
              label="Share / Export this PDF"
              variant="secondary"
              onPress={() =>
                onSharePdf(item.personalSensitive ? 'PERSONAL_ACKNOWLEDGED' : 'NONE')
              }
            />
          </View>
        )}
      {item.state === 'PDF_EXTERNAL_ONLY' && !canShare && (
        <Text style={styles.muted}>
          This PDF cannot be shown in a swipe session. Other ready images can still be presented.
        </Text>
      )}
    </Card>
  );
}

function PresentationPager({
  session,
  onExit,
}: {
  session: PresentationSession;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const width = Dimensions.get('window').width;
  const list = useRef<FlatList<(typeof session.items)[number]>>(null);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index && next >= 0 && next < session.items.length) setIndex(next);
  };
  const current = session.items[index];
  return (
    <View style={styles.presentRoot} accessibilityViewIsModal>
      <View style={styles.presentBar}>
        <Text style={styles.presentKicker}>
          {index + 1} / {session.items.length}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit presentation" onPress={onExit}>
          <Text style={styles.exit}>Exit</Text>
        </Pressable>
      </View>
      <FlatList
        ref={list}
        data={session.items}
        keyExtractor={(item) => item.exactVersionId}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <View style={[styles.page, { width }]}>
            <Image
              source={{ uri: item.privateUri }}
              style={styles.image}
              resizeMode="contain"
              accessibilityLabel={item.title}
            />
          </View>
        )}
      />
      {current && (
        <View style={styles.presentMeta}>
          <Text style={styles.presentTitle}>{current.title}</Text>
          <Text style={styles.presentSub}>
            {current.kindLabel}
            {current.expiresAt
              ? ` · ${VALIDITY_LABEL[current.validity]} · ${current.expiresAt}`
              : ` · ${VALIDITY_LABEL.NO_EXPIRATION}`}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disclaimer: { ...type.bodySmall, color: colors.textFaint, marginBottom: spacing.md },
  body: { ...type.body, color: colors.text },
  muted: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.sm },
  hint: { ...type.bodySmall, color: colors.textFaint, marginTop: spacing.md },
  notice: { ...type.bodySmall, color: colors.warning, marginTop: spacing.md },
  block: { marginTop: spacing.md },
  rowGap: { marginTop: spacing.md, gap: spacing.sm },
  emptyTitle: { ...type.h2, color: colors.text },
  h2: { ...type.h2, color: colors.text, flex: 1, paddingRight: spacing.sm },
  preflightHead: { flexDirection: 'row', alignItems: 'center' },
  presentRoot: { flex: 1, backgroundColor: colors.background },
  presentBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  presentKicker: { ...type.label, color: colors.textMuted },
  exit: { ...type.h2, color: colors.action },
  page: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '70%' },
  presentMeta: { padding: spacing.lg, paddingBottom: spacing.xxl },
  presentTitle: { ...type.h2, color: colors.text },
  presentSub: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.xs },
});
