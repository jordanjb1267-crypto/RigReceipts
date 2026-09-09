import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card, Screen } from '@/components';
import { CarrierProfileGate } from '@/components/roadWallet/CarrierGates';
import {
  CarrierProfileDeniedError,
  currentCarrierProfile,
  saveCarrierProfile,
} from '@/data/carrierProfile';
import {
  CARRIER_PROFILE_ENTERED_COPY,
  CARRIER_PROFILE_SOURCE_COPY,
} from '@/domain';
import { colors, radii, spacing, type } from '@/theme';

export default function CarrierProfileRoute() {
  return (
    <CarrierProfileGate>
      <CarrierProfileScreen />
    </CarrierProfileGate>
  );
}

function CarrierProfileScreen() {
  const router = useRouter();
  const existing = currentCarrierProfile();
  const [legalName, setLegalName] = useState(existing?.legalName ?? '');
  const [dbaName, setDbaName] = useState(existing?.dbaName ?? '');
  const [usdotNumber, setUsdot] = useState(existing?.usdotNumber ?? '');
  const [mcNumber, setMc] = useState(existing?.mcNumber ?? '');
  const [addressLine1, setA1] = useState(existing?.addressLine1 ?? '');
  const [city, setCity] = useState(existing?.city ?? '');
  const [stateProvince, setState] = useState(existing?.stateProvince ?? '');
  const [postalCode, setPostal] = useState(existing?.postalCode ?? '');
  const [contactName, setContact] = useState(existing?.contactName ?? '');
  const [contactEmail, setEmail] = useState(existing?.contactEmail ?? '');
  const [contactPhone, setPhone] = useState(existing?.contactPhone ?? '');
  const [notice, setNotice] = useState<string | null>(null);

  const save = () => {
    try {
      saveCarrierProfile({
        legalName,
        dbaName,
        usdotNumber,
        mcNumber,
        addressLine1,
        addressLine2: existing?.addressLine2 ?? null,
        city,
        stateProvince,
        postalCode,
        contactName,
        contactEmail,
        contactPhone,
        equipmentTypes: existing?.equipmentTypes ?? [],
      });
      router.back();
    } catch (err) {
      if (err instanceof CarrierProfileDeniedError && err.reason === 'NOT_ENTITLED') {
        router.push({ pathname: '/paywall', params: { trigger: 'carrier_profile' } });
        return;
      }
      setNotice('Could not save these details. Check the legal name and try again.');
    }
  };

  return (
    <Screen kicker="Carrier" title="Carrier Profile">
      <Text style={styles.muted}>{CARRIER_PROFILE_ENTERED_COPY}</Text>
      <Text style={styles.source}>{CARRIER_PROFILE_SOURCE_COPY}</Text>
      <Field label="Legal business name" value={legalName} onChange={setLegalName} />
      <Field label="DBA" value={dbaName} onChange={setDbaName} />
      <Field label="USDOT" value={usdotNumber} onChange={setUsdot} />
      <Field label="MC" value={mcNumber} onChange={setMc} />
      <Field label="Address" value={addressLine1} onChange={setA1} />
      <Field label="City" value={city} onChange={setCity} />
      <Field label="State / province" value={stateProvince} onChange={setState} />
      <Field label="Postal code" value={postalCode} onChange={setPostal} />
      <Field label="Contact name" value={contactName} onChange={setContact} />
      <Field label="Contact email" value={contactEmail} onChange={setEmail} />
      <Field label="Contact phone" value={contactPhone} onChange={setPhone} />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={styles.row}>
        <Button label="Save" onPress={save} />
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Card style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        style={styles.input}
        autoCapitalize="words"
        placeholderTextColor={colors.textFaint}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.bodySmall, color: colors.textMuted, marginBottom: spacing.sm },
  source: { ...type.label, color: colors.textFaint, marginBottom: spacing.md },
  block: { marginBottom: spacing.sm },
  label: { ...type.label, color: colors.textMuted, marginBottom: spacing.xs },
  input: {
    ...type.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  row: { marginTop: spacing.lg, gap: spacing.sm },
  notice: { ...type.bodySmall, color: colors.warning, marginTop: spacing.md },
});
