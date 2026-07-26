import { useRouter } from 'expo-router';
import { Fragment } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pill } from '@/components';
import { COMMUNITY_TERMS_VERSION } from '@/domain';
import { colors, palette, radii, spacing, type } from '@/theme';

/**
 * Community Rate Board terms (Sections 12/20/21/22/51). The plain-language rules
 * a driver agrees to before posting — reachable from the posting consent step
 * and from settings. Static, versioned content; the acknowledged version is
 * recorded against COMMUNITY_TERMS_VERSION when a user agrees.
 */

interface Section {
  heading: string;
  body?: string;
  bullets?: string[];
  tone?: 'green' | 'rust';
}

const SECTIONS: Section[] = [
  {
    heading: 'What the Rate Board is',
    body: 'The Community Rate Board is a historical rate-transparency feed. Drivers share what recent, completed lanes actually paid so everyone can judge an offer against real numbers.',
  },
  {
    heading: 'What it is not',
    tone: 'rust',
    body: 'RigReceipts is not a load board, broker, dispatch service, or freight marketplace. The Rate Board cannot be used to advertise, book, bid on, or arrange loads. Every rate is history — never an available load.',
  },
  {
    heading: 'What you can share',
    bullets: [
      'Rates from loads you actually ran or were verifiably offered.',
      'Lane, equipment, and the pay math (gross, loaded and all-mile RPM, deadhead) — your choice of which to show.',
      'An approximate load date. Exact dates are always bucketed (for example, “Mid July 2026”).',
    ],
  },
  {
    heading: 'What you must never post',
    tone: 'rust',
    bullets: [
      'Active or available loads, or anything that reads as arranging freight.',
      'Contact information — phone, email, or addresses, yours or anyone else’s.',
      'Confidential documents or their contents: rate confirmations, BOLs, PODs, contracts.',
      'Private shipment, customer, or broker details.',
      'Threats, harassment, or unsupported accusations against a broker or driver.',
      'Rates you know to be false, inflated, or misleading, or spam of any kind.',
    ],
  },
  {
    heading: 'Your privacy is built in',
    tone: 'green',
    body: 'Before any card is shared, RigReceipts removes your name, load and document numbers, exact addresses and times, and all contacts. On the public board your identity is never shown — posts carry a rotating, per-lane alias that cannot be traced back to you or followed from lane to lane.',
  },
  {
    heading: 'Verification',
    body: 'Only rates verified by a document or a completed load can be posted publicly. Self-entered rates stay private to you. A verification badge tells other drivers how a rate was confirmed — nothing more.',
  },
  {
    heading: 'Moderation and your controls',
    bullets: [
      'Posts may be reviewed and removed if they break these terms.',
      'You can report any card; repeated reports send a card for review.',
      'You can hide a card or block a contributor — you will not see their rates again.',
      'You can remove your own posts at any time.',
    ],
  },
  {
    heading: 'Not an official rate',
    body: 'Community figures are driver-shared history, not an official, guaranteed, or predicted market rate. Lane ranges appear only once enough distinct drivers have contributed, and no single account can dominate a lane’s numbers. Always run your own costs before you take a load.',
  },
  {
    heading: 'How the data is used',
    body: 'Shared rates build the anonymous, PII-free lane ranges other drivers see. RigReceipts never sells your identity, and community rates are never presented as a paid data product or an official market feed.',
  },
];

export default function CommunityTermsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>Community</Text>
          <Pressable
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>Rate Board Terms</Text>
        <View style={styles.versionRow}>
          <Pill label={`Version ${COMMUNITY_TERMS_VERSION}`} tone="neutral" />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
      >
        <Text style={styles.intro}>
          Share historical rates — not active freight. By posting to the Community Rate Board you
          agree to the following.
        </Text>

        {SECTIONS.map((s, i) => (
          <Fragment key={s.heading}>
            <View style={[styles.section, i === 0 && styles.sectionFirst]}>
              <Text
                style={[
                  styles.sectionHeading,
                  s.tone === 'rust' && styles.headingRust,
                  s.tone === 'green' && styles.headingGreen,
                ]}
              >
                {s.heading}
              </Text>
              {s.body && <Text style={styles.sectionBody}>{s.body}</Text>}
              {s.bullets?.map((b) => (
                <View key={b} style={styles.bulletRow}>
                  <Text style={[styles.bulletDot, s.tone === 'rust' && styles.dotRust]}>•</Text>
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
            </View>
          </Fragment>
        ))}

        <Text style={styles.footer}>
          These terms may change as the community grows. When they do, you will be asked to review
          and agree again before posting.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: spacing.xl },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
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
  versionRow: { flexDirection: 'row', marginTop: spacing.md },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  intro: { ...type.emphasis, color: colors.text, marginBottom: spacing.sm },
  section: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingVertical: spacing.lg,
  },
  sectionFirst: { borderTopWidth: 0 },
  sectionHeading: { ...type.h2, color: colors.text, marginBottom: spacing.sm },
  headingRust: { color: palette.clayRust },
  headingGreen: { color: palette.routeGreen },
  sectionBody: { ...type.body, color: colors.textMuted },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  bulletDot: { color: palette.routeGreen, fontSize: 15, lineHeight: 22 },
  dotRust: { color: palette.clayRust },
  bulletText: { ...type.body, color: colors.text, flex: 1 },
  footer: {
    ...type.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.lg,
  },
});
