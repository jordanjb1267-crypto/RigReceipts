import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card, ChoiceRow, Screen } from '@/components';
import { CarrierPacketGate } from '@/components/roadWallet/CarrierGates';
import {
  archiveCustomCarrierTemplate,
  CarrierPacketDeniedError,
  createCarrierPacketDraft,
  createCustomCarrierTemplate,
} from '@/data/carrierPackets';
import {
  canUseFeature,
  CARRIER_PACKET_REQUIREMENTS_VARY_COPY,
  DOCUMENT_KINDS,
  documentKindLabel,
} from '@/domain';
import { useAuthStore } from '@/store/auth';
import { useCarrierPacketsStore } from '@/store/carrierPackets';
import { useSubscriptionStore } from '@/store/subscription';
import { colors, spacing, type } from '@/theme';

export default function CarrierPacketTemplateEditRoute() {
  return (
    <CarrierPacketGate>
      <TemplateEditor />
    </CarrierPacketGate>
  );
}

function TemplateEditor() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const tier = useSubscriptionStore((s) => s.tier);
  const templates = useCarrierPacketsStore((s) =>
    s.templates.filter((t) => t.accountOwnerId === userId && t.lifecycle === 'ACTIVE'),
  );
  const [name, setName] = useState('My broker packet');
  const [kinds, setKinds] = useState<string[]>(['W9', 'CERTIFICATE_OF_INSURANCE']);
  const [notice, setNotice] = useState<string | null>(null);
  const canTemplates = canUseFeature(tier, 'carrierPacketTemplates');

  const toggle = (kind: string) => {
    setKinds((cur) => (cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind]));
  };

  const save = () => {
    if (!canTemplates) {
      router.push({ pathname: '/paywall', params: { trigger: 'carrier_packet_templates' } });
      return;
    }
    try {
      const created = createCustomCarrierTemplate({
        name,
        definition: {
          schemaVersion: 1,
          requireCarrierProfile: true,
          documentRequirements: kinds.map((documentKind, position) => ({
            key: documentKind.toLowerCase(),
            documentKind: documentKind as (typeof DOCUMENT_KINDS)[number],
            label: documentKindLabel(documentKind as (typeof DOCUMENT_KINDS)[number]),
            required: position < 2,
            position,
          })),
        },
      });
      const packet = createCarrierPacketDraft({ source: { kind: 'CUSTOM', id: created.id } });
      router.replace({ pathname: '/carrier-packet-review', params: { id: packet.id } });
    } catch (err) {
      if (err instanceof CarrierPacketDeniedError && err.reason === 'NOT_ENTITLED') {
        router.push({ pathname: '/paywall', params: { trigger: 'carrier_packet_templates' } });
        return;
      }
      setNotice('Could not save this template.');
    }
  };

  return (
    <Screen kicker="Carrier" title="Custom template">
      <Text style={styles.muted}>{CARRIER_PACKET_REQUIREMENTS_VARY_COPY}</Text>
      <Card style={styles.block}>
        <Text style={styles.label}>Template name</Text>
        <TextInput value={name} onChangeText={setName} style={styles.input} />
      </Card>
      <Card label="Document kinds" style={styles.block}>
        {DOCUMENT_KINDS.filter((k) => k !== 'CUSTOM').map((kind) => (
          <ChoiceRow
            key={kind}
            title={documentKindLabel(kind)}
            selected={kinds.includes(kind)}
            onPress={() => toggle(kind)}
          />
        ))}
      </Card>
      {templates.length > 0 && (
        <Card label="Saved templates" style={styles.block}>
          {templates.map((t) => (
            <ChoiceRow
              key={t.id}
              title={t.name}
              subtitle="Archive"
              onPress={() => archiveCustomCarrierTemplate(t.id)}
            />
          ))}
        </Card>
      )}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={styles.row}>
        <Button label="Save and create draft" onPress={save} />
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.bodySmall, color: colors.textMuted, marginBottom: spacing.md },
  block: { marginTop: spacing.md },
  label: { ...type.label, color: colors.textMuted },
  input: { ...type.body, color: colors.text, marginTop: spacing.sm },
  row: { marginTop: spacing.lg, gap: spacing.sm },
  notice: { ...type.bodySmall, color: colors.warning, marginTop: spacing.md },
});
