import React from 'react';
import { ScrollView, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthModalContext';
import { useLanguage } from '../../context/LanguageContext';
import { useVerseSelection } from '../../context/VerseSelectionContext';
import { guardProtectedNavigation } from '../../utils/routeAccess';

type SidebarLeftProps = {
  onToggleSignInVisibility?: () => void;
};

const SidebarLeft = ({ onToggleSignInVisibility }: SidebarLeftProps) => {
  const router = useRouter();
  const auth = useAuth();
  const { lang, t } = useLanguage();
  const { selection } = useVerseSelection();
  const safeLang = typeof lang === 'string' ? lang.toUpperCase() : 'EN';
  const safeChapter = Math.max(1, Number(selection?.chapter || 1));
  const safeVerse = Math.max(1, Number(selection?.verse || 1));
  const links = [
    { label: t('Home'), path: '/home' },
    { label: t('Explore'), path: '/explore' },
    { label: t('Gita Verse'), path: '/gitaverse' },
    { label: t('Favourites'), path: '/myfavourates' },
    { label: t('Dilemma'), path: '/dilemma' },
    { label: t('About'), path: '/about' },
    { label: t('Privacy'), path: '/privacy-policy' },
    { label: t('Data Deletion'), path: '/data-deletion' },
  ];
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.8}
        onPress={onToggleSignInVisibility}
      />
      <ScrollView contentContainerStyle={styles.list}>
        {links.map((link) => (
          <TouchableOpacity
            key={link.label}
            style={styles.linkItem}
            activeOpacity={0.8}
            onPress={() =>
              guardProtectedNavigation({
                targetPath: link.path,
                sessionId: auth.sessionId,
                openLogin: auth.openLogin,
                onAllowed: () => {
                  if (link.path === '/gitaverse') {
                    router.push({
                      pathname: '/gitaverse',
                      params: { chapter: String(safeChapter), verse: String(safeVerse), lang: safeLang },
                    });
                    return;
                  }
                  router.push(link.path);
                },
              })
            }
          >
            <Text style={styles.linkText}>{link.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderRightWidth: 1,
    borderRightColor: 'rgba(226,232,240,1)',
    backgroundColor: '#fff',
    flex: 1,
    flexShrink: 0,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(226,232,240,1)',
    minHeight: 44,
  },
  list: {
    padding: 10,
  },
  linkItem: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,1)',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 10,
    width: '100%',
    alignItems: 'flex-start',
  },
  linkText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#475569',
  },
});

export default SidebarLeft;
