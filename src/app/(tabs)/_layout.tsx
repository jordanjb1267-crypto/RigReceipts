import { Tabs } from 'expo-router';
import { ColorValue, StyleSheet, Text } from 'react-native';

import { colors, fonts, palette } from '@/theme';

function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={[styles.glyph, { color }]}>{glyph}</Text>;
}

/** Night Atlas tab bar: amber active tint, canvas-deep bar, Scan is a normal tab. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.action,
        tabBarInactiveTintColor: 'rgba(244, 241, 232, 0.42)',
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
          tabBarIcon: ({ color }) => <TabGlyph glyph="⎙" color={color} />,
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
    backgroundColor: colors.canvasDeep,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tabLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
  },
  glyph: {
    fontSize: 17,
  },
});
