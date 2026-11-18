import { useRef } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type ScrollViewInstance } from 'react-native';

const RELEASES_URL = 'https://github.com/luizhmmachado/at-mail/releases/latest';
const FONT_REGULAR = 'Inter_400Regular';
const FONT_MEDIUM = 'Inter_500Medium';
const FONT_SEMIBOLD = 'Inter_600SemiBold';

type SectionName = 'resources' | 'flow' | 'faq';

export interface LandingScreenProps {
  onOpenApp: () => void;
}

export function LandingScreen({ onOpenApp }: LandingScreenProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= 860;
  const contentWidth = Math.min(width - 48, 1200);
  const desktopPreviewHeight = contentWidth * (750 / 1200);
  const mobilePreviewWidth = Math.min(contentWidth, 552);
  const mobilePreviewHeight = mobilePreviewWidth * (600 / 552);
  const scrollView = useRef<ScrollViewInstance | null>(null);
  const sectionOffsets = useRef<Record<SectionName, number>>({ resources: 0, flow: 0, faq: 0 });

  function rememberSection(name: SectionName) {
    return (event: LayoutChangeEvent): void => {
      sectionOffsets.current[name] = event.nativeEvent.layout.y;
    };
  }

  function scrollToSection(name: SectionName): void {
    scrollView.current?.scrollTo({ y: sectionOffsets.current[name], animated: true });
  }

  return (
    <ScrollView ref={scrollView} style={styles.root} contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <View style={styles.contentWidth}>
          <View style={styles.headerInner}>
            <View style={styles.brand}>
              <Image source={require('./figma-icon-light.png')} style={styles.brandIcon} />
              <Text style={styles.brandText}>mail</Text>
            </View>
            {isWide ? (
              <View style={styles.navigation}>
                <NavLink label="Recursos" onPress={() => scrollToSection('resources')} />
                <NavLink label="Como funciona" onPress={() => scrollToSection('flow')} />
                <NavLink label="Perguntas" onPress={() => scrollToSection('faq')} />
                <Pressable accessibilityRole="button" style={styles.headerButton} onPress={onOpenApp}>
                  <Text style={styles.headerButtonText}>Conhecer o @mail  →</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable accessibilityRole="button" style={styles.headerButton} onPress={onOpenApp}>
                <Text style={styles.headerButtonText}>Conhecer o @mail  →</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <View style={styles.hero}>
        <View style={styles.contentWidth}>
          <View style={styles.heroIntro}>
            <Text style={styles.eyebrow}>UMA CAIXA DE ENTRADA. MAIS CLAREZA.</Text>
            <Text style={[styles.heroTitle, !isWide && styles.heroTitleMobile]}>Menos abas.{ '\n' }Mais conversa.</Text>
            <Text style={styles.heroDescription}>
              E-mails e chats juntos, com espaço para o que importa.{ '\n' }
              Organize trabalho, estudos e vida pessoal no @mail.
            </Text>
            <View style={styles.heroButtons}>
              <PrimaryButton label="Começar agora  →" onPress={onOpenApp} />
              <SecondaryButton label="Explorar os recursos" onPress={() => scrollToSection('resources')} />
            </View>
          </View>
          <View style={[styles.desktopPreview, { height: desktopPreviewHeight }]}>
            <Image
              accessibilityLabel="Prévia do @mail no computador"
              source={require('./figma-preview-desktop.png')}
              resizeMode="contain"
              style={styles.fillImage}
            />
          </View>
        </View>
      </View>

      <View style={styles.benefitStrip}>
        <View style={[styles.contentWidth, isWide && styles.benefitRow]}>
          <Benefit icon="✉" title="E-mail e chat, lado a lado" description="Uma conversa contínua, sem trocar de aba." />
          <Benefit icon="⌕" title="Encontre. Continue. Resolva." description="Busca e respostas no mesmo espaço." />
          <Benefit icon="▤" title="Cada contexto no seu lugar" description="Trabalho, estudos e vida pessoal." />
        </View>
      </View>

      <View onLayout={rememberSection('resources')} style={styles.resources}>
        <View style={styles.contentWidth}>
          <View style={styles.sectionHeading}>
            <Text style={styles.eyebrow}>TUDO JUNTO. NADA MISTURADO.</Text>
            <Text style={[styles.sectionTitle, !isWide && styles.sectionTitleMobile]}>Uma inbox para os seus vários mundos.</Text>
          </View>
          <View style={[styles.resourceColumns, !isWide && styles.resourceColumnsMobile]}>
            <View style={styles.inboxPanel}>
              <Text style={styles.panelTitle}>Todas as conversas</Text>
              <Text style={styles.panelDescription}>E-mails e chats organizados em uma única visão.</Text>
              <View style={styles.contextFilters}>
                <Text style={styles.contextSelected}>Tudo</Text>
                <Text style={styles.contextFilter}>Trabalho</Text>
                <Text style={styles.contextFilter}>Estudos</Text>
                <Text style={styles.contextFilter}>Pessoal</Text>
              </View>
              <InboxPreviewRow icon="✉" name="Maya Chen" subject="Website handoff" context="Trabalho" />
              <InboxPreviewRow icon="▤" name="Study group" subject="Tomorrow’s session" context="Estudos" />
              <InboxPreviewRow icon="✉" name="Oliver Grant" subject="Coffee next week?" context="Pessoal" />
            </View>
            <View style={styles.contextPanel}>
              <Image source={require('./figma-icon-dark.png')} style={styles.contextIcon} />
              <Text style={styles.contextTitle}>Seu dia tem contextos.{ '\n' }Sua inbox também.</Text>
              <Text style={styles.contextDescription}>
                Escolha o que merece sua atenção agora.{ '\n' }
                O resto continua no lugar certo.
              </Text>
              <Text style={styles.contextLabels}>TRABALHO   /   ESTUDOS   /   PESSOAL</Text>
            </View>
          </View>
          <View style={styles.downloads}>
            <Text style={styles.downloadsLabel}>BAIXAR O @MAIL</Text>
            <DownloadLink label="Android" />
            <DownloadLink label="Windows" />
            <DownloadLink label="Linux" />
          </View>
        </View>
      </View>

      <View onLayout={rememberSection('flow')} style={styles.flow}>
        <View style={[styles.contentWidth, isWide && styles.flowRow]}>
          <View style={styles.flowIntro}>
            <Text style={styles.eyebrow}>MENOS ATRITO, MAIS FLUXO</Text>
            <Text style={[styles.flowTitle, !isWide && styles.flowTitleMobile]}>Da primeira leitura{ '\n' }à última resposta.</Text>
            <Text style={styles.flowDescription}>Tudo o que você precisa para seguir a conversa,{ '\n' }sem perder o fio da meada.</Text>
            <Pressable accessibilityRole="button" style={styles.inlineLink} onPress={onOpenApp}>
              <Text style={styles.inlineLinkText}>Conheça o seu novo ritmo  →</Text>
            </Pressable>
          </View>
          <View style={styles.flowSteps}>
            <FlowStep number="01" title="Encontre a conversa certa" description={'Use a busca ou alterne entre e-mails e chats.\nSua próxima resposta começa com contexto.'} />
            <FlowStep number="02" title="Veja o que realmente importa" description={'Leia a conversa e consulte os anexos\nsem sair da sua caixa de entrada.'} />
            <FlowStep number="03" title="Responda e siga em frente" description={'Escreva no próprio painel de leitura.\nMenos idas e vindas, mais continuidade.'} />
          </View>
        </View>
      </View>

      <View style={styles.mobileSection}>
        <View style={[styles.contentWidth, isWide && styles.mobileRow]}>
          <View style={[styles.mobilePreview, { height: mobilePreviewHeight }]}>
            <Image
              accessibilityLabel="Prévia do @mail em um telefone"
              source={require('./figma-preview-mobile.png')}
              resizeMode="contain"
              style={styles.fillImage}
            />
          </View>
          <View style={styles.mobileCopy}>
            <Text style={styles.eyebrow}>A MESMA CLAREZA, EM OUTRA TELA</Text>
            <Text style={[styles.mobileTitle, !isWide && styles.mobileTitleNarrow]}>Suas conversas{ '\n' }vão com você.</Text>
            <Text style={styles.mobileDescription}>
              A visão unificada do @mail também cabe na sua mão.{ '\n' }
              Encontre a conversa e mantenha o contexto,{ '\n' }
              mesmo longe da mesa.
            </Text>
            <View style={styles.mobileBenefits}>
              <NumberedLine number="01" label="E-mails e chats na mesma lista" />
              <NumberedLine number="02" label="Filtros simples, navegação direta" />
              <NumberedLine number="03" label="Trabalho e vida pessoal organizados" />
            </View>
          </View>
        </View>
      </View>

      <View onLayout={rememberSection('faq')} style={styles.faq}>
        <View style={[styles.contentWidth, isWide && styles.faqRow]}>
          <View style={styles.faqIntro}>
            <Text style={styles.eyebrow}>BOM SABER</Text>
            <Text style={[styles.faqTitle, !isWide && styles.faqTitleMobile]}>Uma ideia simples.{ '\n' }Sem pontas soltas.</Text>
            <Text style={styles.faqDescription}>Um pouco mais sobre a experiência.</Text>
          </View>
          <View style={styles.faqList}>
            <FaqItem question="O que é o @mail?" answer="Um espaço que reúne e-mails e chats em uma caixa de entrada unificada, para acompanhar suas conversas com mais clareza." />
            <FaqItem question="Como organizo meus diferentes contextos?" answer="Alterne entre trabalho, estudos e vida pessoal. Veja tudo junto ou concentre-se no contexto que faz sentido naquele momento." />
            <FaqItem question="Posso ver só e-mails ou só chats?" answer="Sim. Os filtros da caixa de entrada permitem alternar entre a visão unificada, os e-mails e as conversas de chat." />
            <FaqItem question="Preciso sair da inbox para responder?" answer="Não. No desktop, a leitura, os anexos e a resposta ficam no mesmo painel, ao lado da lista de conversas." />
          </View>
        </View>
      </View>

      <View style={styles.finalCta}>
        <Image source={require('./figma-icon-dark.png')} style={styles.finalIcon} />
        <Text style={[styles.finalTitle, !isWide && styles.finalTitleMobile]}>Dê espaço ao que importa.</Text>
        <Text style={styles.finalDescription}>Menos ruído na caixa de entrada. Mais presença em cada conversa.</Text>
        <Pressable accessibilityRole="button" style={styles.finalButton} onPress={onOpenApp}>
          <Text style={styles.finalButtonText}>Começar agora  →</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <View style={[styles.contentWidth, styles.footerInner]}>
          <View style={styles.footerBrand}>
            <View style={styles.brand}>
              <Image source={require('./figma-icon-light.png')} style={styles.footerIcon} />
              <Text style={styles.footerBrandText}>mail</Text>
            </View>
            <Text style={styles.footerDescription}>Um lugar para suas conversas.</Text>
          </View>
          {isWide ? (
            <View style={styles.footerNav}>
              <NavLink label="Recursos" onPress={() => scrollToSection('resources')} />
              <NavLink label="Como funciona" onPress={() => scrollToSection('flow')} />
              <NavLink label="Perguntas frequentes" onPress={() => scrollToSection('faq')} />
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={onOpenApp}>
              <Text style={styles.footerNavText}>Abrir app web</Text>
            </Pressable>
          )}
          <View style={styles.footerBottom}>
            <Text style={styles.footerMeta}>@mail — menos abas, mais conversa.</Text>
            <Text style={styles.footerMeta}>Feito para simplificar.</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function NavLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={styles.navLink} onPress={onPress}>
      <Text style={styles.navLinkText}>{label}</Text>
    </Pressable>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={onPress}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onPress}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function Benefit({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <View style={styles.benefit}>
      <Text style={styles.benefitIcon}>{icon}</Text>
      <View style={styles.benefitCopy}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitDescription}>{description}</Text>
      </View>
    </View>
  );
}

function InboxPreviewRow({ icon, name, subject, context }: { icon: string; name: string; subject: string; context: string }) {
  return (
    <View style={styles.inboxRow}>
      <Text style={styles.inboxRowIcon}>{icon}</Text>
      <View style={styles.inboxRowCopy}>
        <Text style={styles.inboxRowName}>{name}</Text>
        <Text style={styles.inboxRowSubject}>{subject}</Text>
      </View>
      <Text style={styles.inboxRowContext}>{context}</Text>
    </View>
  );
}

function DownloadLink({ label }: { label: string }) {
  return (
    <Pressable accessibilityRole="link" style={styles.downloadLink} onPress={() => void Linking.openURL(RELEASES_URL)}>
      <Text style={styles.downloadLinkText}>{label}  →</Text>
    </Pressable>
  );
}

function FlowStep({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <View style={styles.flowStep}>
      <Text style={styles.flowStepNumber}>{number}</Text>
      <View style={styles.flowStepCopy}>
        <Text style={styles.flowStepTitle}>{title}</Text>
        <Text style={styles.flowStepDescription}>{description}</Text>
      </View>
    </View>
  );
}

function NumberedLine({ number, label }: { number: string; label: string }) {
  return (
    <View style={styles.numberedLine}>
      <Text style={styles.numberedLineNumber}>{number}</Text>
      <Text style={styles.numberedLineText}>{label}</Text>
    </View>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <View style={styles.faqItem}>
      <View style={styles.faqQuestionRow}>
        <Text style={styles.faqQuestion}>{question}</Text>
        <Text style={styles.faqMinus}>−</Text>
      </View>
      <Text style={styles.faqAnswer}>{answer}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { alignItems: 'center' },
  contentWidth: { width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: 0 },
  header: { width: '100%', minHeight: 88, backgroundColor: '#FFFFFF' },
  headerInner: { minHeight: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center' },
  brandIcon: { width: 32, height: 32 },
  brandText: { marginLeft: 2, color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 26 },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 42 },
  navLink: { paddingVertical: 10 },
  navLinkText: { color: '#18181B', fontFamily: FONT_MEDIUM, fontSize: 14 },
  headerButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 25, borderRadius: 7, backgroundColor: '#18181B' },
  headerButtonText: { color: '#FFFFFF', fontFamily: FONT_MEDIUM, fontSize: 15 },
  hero: { width: '100%', backgroundColor: '#FAFAFA', paddingTop: 44, paddingBottom: 64 },
  heroIntro: { alignItems: 'center', paddingHorizontal: 16 },
  eyebrow: { color: '#1D4ED8', fontFamily: FONT_SEMIBOLD, fontSize: 11 },
  heroTitle: { marginTop: 28, color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 88, lineHeight: 92, textAlign: 'center' },
  heroTitleMobile: { marginTop: 22, fontSize: 40, lineHeight: 45 },
  heroDescription: { marginTop: 26, color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 19, lineHeight: 29, textAlign: 'center' },
  heroButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16, marginTop: 28 },
  primaryButton: { minWidth: 212, minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderRadius: 7, backgroundColor: '#18181B' },
  primaryButtonText: { color: '#FFFFFF', fontFamily: FONT_MEDIUM, fontSize: 15 },
  secondaryButton: { minWidth: 206, minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderWidth: 1, borderColor: '#E4E4E7', borderRadius: 7, backgroundColor: '#FFFFFF' },
  secondaryButtonText: { color: '#18181B', fontFamily: FONT_MEDIUM, fontSize: 15 },
  desktopPreview: { width: '100%', marginTop: 46 },
  fillImage: { width: '100%', height: '100%' },
  benefitStrip: { width: '100%', paddingVertical: 50, backgroundColor: '#FFFFFF' },
  benefitRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 30 },
  benefit: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 15, paddingVertical: 8 },
  benefitIcon: { width: 22, color: '#71717A', fontFamily: FONT_MEDIUM, fontSize: 20, textAlign: 'center' },
  benefitCopy: { flex: 1 },
  benefitTitle: { color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 17 },
  benefitDescription: { marginTop: 9, color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 14, lineHeight: 22 },
  resources: { width: '100%', paddingTop: 62, paddingBottom: 70, backgroundColor: '#FFFFFF' },
  sectionHeading: { borderTopWidth: 1, borderTopColor: '#E4E4E7', paddingTop: 62 },
  sectionTitle: { marginTop: 20, color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 43, lineHeight: 52 },
  sectionTitleMobile: { fontSize: 31, lineHeight: 38 },
  resourceColumns: { flexDirection: 'row', alignItems: 'stretch', gap: 24, marginTop: 48 },
  resourceColumnsMobile: { flexDirection: 'column' },
  inboxPanel: { flex: 1.45, minHeight: 340, padding: 28, borderWidth: 1, borderColor: '#E4E4E7', borderRadius: 16, backgroundColor: '#FAFAFA' },
  panelTitle: { color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 22 },
  panelDescription: { marginTop: 8, color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 14 },
  contextFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 26, marginBottom: 14 },
  contextSelected: { overflow: 'hidden', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 6, backgroundColor: '#18181B', color: '#FFFFFF', fontFamily: FONT_MEDIUM, fontSize: 12 },
  contextFilter: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 6, backgroundColor: '#F0F0F2', color: '#65656F', fontFamily: FONT_MEDIUM, fontSize: 12 },
  inboxRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, paddingHorizontal: 14, borderRadius: 6, backgroundColor: '#FFFFFF' },
  inboxRowIcon: { color: '#71717A', fontFamily: FONT_MEDIUM, fontSize: 15 },
  inboxRowCopy: { flex: 1, gap: 4 },
  inboxRowName: { color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 12 },
  inboxRowSubject: { color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 11 },
  inboxRowContext: { color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 11 },
  contextPanel: { flex: 0.8, minHeight: 340, alignItems: 'flex-start', justifyContent: 'center', padding: 30, borderRadius: 16, backgroundColor: '#18181B' },
  contextIcon: { width: 64, height: 64, marginBottom: 25 },
  contextTitle: { color: '#FFFFFF', fontFamily: FONT_SEMIBOLD, fontSize: 30, lineHeight: 40 },
  contextDescription: { marginTop: 16, color: '#A1A1AA', fontFamily: FONT_REGULAR, fontSize: 15, lineHeight: 24 },
  contextLabels: { marginTop: 44, color: '#A1A1AA', fontFamily: FONT_MEDIUM, fontSize: 9 },
  downloads: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 24, marginTop: 28, paddingTop: 22, borderTopWidth: 1, borderTopColor: '#E4E4E7' },
  downloadsLabel: { color: '#65656F', fontFamily: FONT_SEMIBOLD, fontSize: 10 },
  downloadLink: { paddingVertical: 8 },
  downloadLinkText: { color: '#18181B', fontFamily: FONT_MEDIUM, fontSize: 13 },
  flow: { width: '100%', paddingTop: 64, paddingBottom: 70, backgroundColor: '#FAFAFA' },
  flowRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 64 },
  flowIntro: { flex: 1 },
  flowTitle: { marginTop: 22, color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 47, lineHeight: 53 },
  flowTitleMobile: { fontSize: 36, lineHeight: 42 },
  flowDescription: { marginTop: 26, color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 16, lineHeight: 25 },
  inlineLink: { alignSelf: 'flex-start', marginTop: 38, paddingVertical: 10 },
  inlineLinkText: { color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 14 },
  flowSteps: { flex: 1, marginTop: 2 },
  flowStep: { flexDirection: 'row', gap: 24, paddingVertical: 25, borderBottomWidth: 1, borderBottomColor: '#E4E4E7' },
  flowStepNumber: { width: 40, color: '#1D4ED8', fontFamily: FONT_MEDIUM, fontSize: 13 },
  flowStepCopy: { flex: 1 },
  flowStepTitle: { color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 21 },
  flowStepDescription: { marginTop: 10, color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 15, lineHeight: 23 },
  mobileSection: { width: '100%', paddingVertical: 70, backgroundColor: '#FFFFFF' },
  mobileRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 120 },
  mobilePreview: { width: '100%', maxWidth: 552, alignSelf: 'center' },
  mobileCopy: { flex: 1, paddingVertical: 20 },
  mobileTitle: { marginTop: 26, color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 48, lineHeight: 54 },
  mobileTitleNarrow: { fontSize: 38, lineHeight: 44 },
  mobileDescription: { marginTop: 24, color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 17, lineHeight: 27 },
  mobileBenefits: { gap: 22, marginTop: 32 },
  numberedLine: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  numberedLineNumber: { width: 28, color: '#1D4ED8', fontFamily: FONT_MEDIUM, fontSize: 12 },
  numberedLineText: { color: '#18181B', fontFamily: FONT_MEDIUM, fontSize: 14 },
  faq: { width: '100%', paddingTop: 70, paddingBottom: 64, backgroundColor: '#FFFFFF' },
  faqRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 96, borderTopWidth: 1, borderTopColor: '#E4E4E7', paddingTop: 70 },
  faqIntro: { flex: 0.9 },
  faqTitle: { marginTop: 24, color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 43, lineHeight: 48 },
  faqTitleMobile: { fontSize: 35, lineHeight: 41 },
  faqDescription: { marginTop: 24, color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 16 },
  faqList: { flex: 1, borderTopWidth: 1, borderTopColor: '#E4E4E7' },
  faqItem: { paddingVertical: 19, borderBottomWidth: 1, borderBottomColor: '#E4E4E7' },
  faqQuestionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  faqQuestion: { flex: 1, color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 17 },
  faqMinus: { color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 18 },
  faqAnswer: { marginTop: 11, color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 14, lineHeight: 21 },
  finalCta: { width: '100%', alignItems: 'center', paddingHorizontal: 24, paddingTop: 76, paddingBottom: 72, backgroundColor: '#000000' },
  finalIcon: { width: 54, height: 54 },
  finalTitle: { marginTop: 20, color: '#FFFFFF', fontFamily: FONT_SEMIBOLD, fontSize: 48, lineHeight: 57, textAlign: 'center' },
  finalTitleMobile: { fontSize: 34, lineHeight: 41 },
  finalDescription: { marginTop: 12, color: '#A1A1AA', fontFamily: FONT_REGULAR, fontSize: 16, textAlign: 'center' },
  finalButton: { minWidth: 224, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 34, paddingHorizontal: 20, borderRadius: 7, backgroundColor: '#FFFFFF' },
  finalButtonText: { color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 15 },
  footer: { width: '100%', paddingTop: 44, paddingBottom: 18, backgroundColor: '#FFFFFF' },
  footerInner: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' },
  footerBrand: { minWidth: 260 },
  footerIcon: { width: 30, height: 30 },
  footerBrandText: { marginLeft: 2, color: '#18181B', fontFamily: FONT_SEMIBOLD, fontSize: 23 },
  footerDescription: { marginTop: 14, color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 13 },
  footerNav: { flexDirection: 'row', alignItems: 'center', gap: 44 },
  footerNavText: { color: '#18181B', fontFamily: FONT_MEDIUM, fontSize: 13 },
  footerBottom: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginTop: 26, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E4E4E7' },
  footerMeta: { color: '#65656F', fontFamily: FONT_REGULAR, fontSize: 11 }
});