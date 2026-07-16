import { Tabs } from 'expo-router';
import { ColorValue, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, palette, radii } from '@/theme';

function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={[styles.glyph, { color }]}>{glyph}</Text>;
}

/** Center Scan action — elevated Route Green square, per the mockup nav. */
function ScanGlyph() {
  return (
    <View style={styles.scanButton}>
      <Text style={styles.scanGlyph}>＋</Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.routeGreen2,
        tabBarInactiveTintColor: 'rgba(244, 241, 232, 0.5)',
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <TabGlyph glyph="◆" color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: () => <ScanGlyph />,
          tabBarActiveTintColor: colors.textOnDark,
          tabBarInactiveTintColor: 'rgba(244, 241, 232, 0.8)',
        }}
      />
      <Tabs.Screen
        name="loads"
        options={{
          title: 'Loads',
          tabBarIcon: ({ color }) => <TabGlyph glyph="▤" color={color} />,
        }}
      />
      <Tabs.Screen
        name="miles"
        options={{
          title: 'Miles',
          tabBarIcon: ({ color }) => <TabGlyph glyph="⌁" color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: ({ color }) => <TabGlyph glyph="▧" color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: palette.asphaltCharcoal,
    borderTopColor: colors.borderOnDark,
    borderTopWidth: 1,
  },
  tabLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
  },
  glyph: {
    fontSize: 17,
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: palette.routeGreen,
    borderRadius: radii.sm + 3,
    height: 40,
    justifyContent: 'center',
    marginTop: -14,
    shadowColor: palette.routeGreen,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.36,
    shadowRadius: 12,
    width: 40,
  },
  scanGlyph: {
    color: palette.mapIvory,
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 24,
  },
});
