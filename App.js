import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, Image, Pressable, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import { useFonts, Syne_700Bold, Syne_800ExtraBold } from '@expo-google-fonts/syne';
import { useSpotifyAuthRequest, trocarCodigoPorToken, obterTokenValido, encerrarSessao } from './src/auth';
import {
  abrirSpotify, abrirFaixa, adicionarNaFila, lerMusicaAtual,
  meuPerfil, salvarNaBiblioteca, urisDasMinhasPlaylists,
} from './src/spotify';
import { sugerir } from './src/recomendador';
import { INTERVALO_LEITURA_MS } from './src/config';

const cor = {
  anil: '#2433B8',
  anilProfundo: '#141C6B',
  nevoa: '#B4BCF5',
  giz: '#F4F2FB',
  girassol: '#FFC83D',
  tinta: '#1A1A2E',
};

export default function App() {
  const [fontesProntas] = useFonts({ Syne_700Bold, Syne_800ExtraBold });
  const [request, response, promptAsync] = useSpotifyAuthRequest();

  // desligado | conectando | ouvindo | analisando | sugestao
  const [etapa, setEtapa] = useState('desligado');
  const [musica, setMusica] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [indice, setIndice] = useState(0);
  const [aviso, setAviso] = useState('');

  const ultimaAnalisada = useRef(null);
  const urisPlaylists = useRef(new Set());
  const ocupado = useRef(false);

  // Volta do login do Spotify
  useEffect(() => {
    if (!response) return;
    if (response.type === 'success' && request?.codeVerifier) {
      trocarCodigoPorToken(response.params.code, request.codeVerifier)
        .then(iniciarEscuta)
        .catch(() => desligar('O login no Spotify não foi concluído. Toque em Ligar para tentar de novo.'));
    } else if (response.type !== 'success') {
      desligar('Login cancelado. Toque em Ligar quando quiser entrar.');
    }
  }, [response]);

  async function ligar() {
    setAviso('');
    setEtapa('conectando');
    const token = await obterTokenValido().catch(() => null);
    if (token) return iniciarEscuta();
    await promptAsync();
  }

  async function iniciarEscuta() {
    setEtapa('ouvindo');
    await abrirSpotify(); // regra: após ligar, o usuário vai para o Spotify
    try {
      const eu = await meuPerfil();
      urisPlaylists.current = await urisDasMinhasPlaylists(eu.id);
    } catch {
      urisPlaylists.current = new Set(); // segue só com a checagem da biblioteca
    }
  }

  function desligar(mensagem = '') {
    setEtapa('desligado');
    setMusica(null);
    setResultado(null);
    ultimaAnalisada.current = null;
    setAviso(mensagem);
  }

  const verificar = useCallback(async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    try {
      const atual = await lerMusicaAtual();
      if (!atual) {
        setAviso('Nada tocando no Spotify agora. Dê play numa música e volte aqui.');
        return;
      }
      setAviso('');
      setMusica(atual);
      if (atual.id === ultimaAnalisada.current) return; // mesma música: nada a fazer
      ultimaAnalisada.current = atual.id;

      setEtapa('analisando');
      const r = await sugerir(atual, urisPlaylists.current);
      setResultado(r);
      setIndice(0);
      if (r.melhor) {
        setEtapa('sugestao');
      } else {
        setEtapa('ouvindo');
        setAviso('As músicas compatíveis que encontrei já estão na sua biblioteca. Toque outra para eu tentar de novo.');
      }
    } catch (e) {
      if (e.message === 'SEM_SESSAO') {
        desligar('Sua sessão do Spotify expirou. Toque em Ligar para entrar de novo.');
      } else {
        ultimaAnalisada.current = null; // tenta de novo na próxima leitura
        setEtapa((atual) => (atual === 'analisando' ? 'ouvindo' : atual));
        setAviso('A análise falhou nesta tentativa. Vou ler o Spotify de novo em alguns segundos.');
      }
    } finally {
      ocupado.current = false;
    }
  }, []);

  // Enquanto ligado: lê o Spotify periodicamente e sempre que o usuário volta ao app
  const ligado = ['ouvindo', 'analisando', 'sugestao'].includes(etapa);
  useEffect(() => {
    if (!ligado) return;
    verificar();
    const timer = setInterval(verificar, INTERVALO_LEITURA_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && verificar());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [ligado, verificar]);

  if (!fontesProntas) return <View style={estilos.tela} />;

  const opcoes = resultado ? [resultado.melhor, ...resultado.alternativas].filter(Boolean) : [];
  const sugestao = opcoes[indice];

  async function acao(fn, sucesso) {
    try {
      await fn();
      setAviso(sucesso);
    } catch {
      setAviso('O Spotify recusou a ação. Adicionar à fila exige Spotify Premium e um aparelho tocando.');
    }
  }

  return (
    <SafeAreaView style={estilos.tela}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={estilos.conteudo}>
        <Text style={estilos.marca}>Sintonia</Text>

        {!ligado && (
          <View style={estilos.inicio}>
            <Text style={estilos.chamada}>A próxima música vem da que está tocando agora.</Text>
            <Pressable
              onPress={ligar}
              disabled={etapa === 'conectando' || !request}
              accessibilityRole="button"
              style={({ pressed }) => [estilos.disco, pressed && { transform: [{ scale: 0.97 }] }]}
            >
              <View style={estilos.discoCentro} />
              <Text style={estilos.discoTexto}>{etapa === 'conectando' ? 'Conectando…' : 'Ligar'}</Text>
            </Pressable>
            <Text style={estilos.nota}>Ao ligar, você entra com sua conta Spotify e o app abre o Spotify.</Text>
          </View>
        )}

        {ligado && (
          <>
            {musica && (
              <View style={estilos.agora}>
                {musica.capa && <Image source={{ uri: musica.capa }} style={estilos.capaPequena} />}
                <View style={{ flex: 1 }}>
                  <Text style={estilos.rotulo}>Tocando agora</Text>
                  <Text style={estilos.agoraTitulo} numberOfLines={1}>{musica.nome}</Text>
                  <Text style={estilos.agoraArtista} numberOfLines={1}>
                    {musica.artistas.map((a) => a.nome).join(', ')}
                  </Text>
                </View>
              </View>
            )}

            {etapa === 'ouvindo' && !musica && (
              <Text style={estilos.nota}>Ouvindo o seu Spotify. Dê play numa música.</Text>
            )}

            {etapa === 'analisando' && (
              <View style={estilos.analisando}>
                <ActivityIndicator color={cor.girassol} />
                <Text style={estilos.nota}>Lendo gênero, época, estilo e melodia…</Text>
              </View>
            )}

            {etapa === 'sugestao' && sugestao && (
              <View style={estilos.cartao}>
                <Image source={{ uri: sugestao.faixa.album?.images?.[0]?.url }} style={estilos.capaGrande} />
                <Text style={estilos.sugTitulo}>{sugestao.faixa.name}</Text>
                <Text style={estilos.sugArtista}>{sugestao.faixa.artists.map((a) => a.name).join(', ')}</Text>
                <Text style={estilos.motivo}>{sugestao.motivo}</Text>

                <Perfil perfil={resultado.perfil} />

                <Botao principal texto="Tocar no Spotify" onPress={() => abrirFaixa(sugestao.faixa)} />
                <View style={estilos.linha}>
                  <Botao texto="Adicionar à fila" onPress={() => acao(() => adicionarNaFila(sugestao.faixa.uri), 'Adicionada à fila.')} />
                  <Botao texto="Salvar" onPress={() => acao(() => salvarNaBiblioteca(sugestao.faixa.uri), 'Salva na sua biblioteca.')} />
                </View>
                {opcoes.length > 1 && (
                  <Botao texto="Mostrar outra sugestão" onPress={() => setIndice((i) => (i + 1) % opcoes.length)} />
                )}
                <Text style={estilos.creditos}>Conteúdo e capas fornecidos pelo Spotify</Text>
              </View>
            )}

            <Pressable onPress={async () => { await encerrarSessao(); desligar(); }} style={estilos.desligar}>
              <Text style={estilos.desligarTexto}>Desligar e sair da conta</Text>
            </Pressable>
          </>
        )}

        {!!aviso && <Text style={estilos.aviso}>{aviso}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function Perfil({ perfil }) {
  if (!perfil) return null;
  const itens = [
    ['Gênero', perfil.generos?.join(', ')],
    ['Época', [perfil.epoca?.decada, perfil.epoca?.movimento].filter(Boolean).join(', ')],
    ['Estilo', perfil.estilo],
    ['Melodia', [perfil.melodia?.andamento, perfil.melodia?.tonalidade, perfil.melodia?.clima].filter(Boolean).join(', ')],
    ['Quem ouve', perfil.ouvintes],
  ].filter(([, v]) => v);
  return (
    <View style={estilos.perfil}>
      <Text style={estilos.perfilTitulo}>Como li a música que estava tocando</Text>
      {itens.map(([k, v]) => (
        <Text key={k} style={estilos.perfilItem}>
          <Text style={estilos.perfilChave}>{k}: </Text>{v}
        </Text>
      ))}
    </View>
  );
}

function Botao({ texto, onPress, principal }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [estilos.botao, principal && estilos.botaoPrincipal, pressed && { opacity: 0.8 }]}
    >
      <Text style={[estilos.botaoTexto, principal && { color: cor.anilProfundo }]}>{texto}</Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.anil },
  conteudo: { padding: 24, paddingBottom: 48 },
  marca: { fontFamily: 'Syne_800ExtraBold', fontSize: 34, color: cor.giz, letterSpacing: -0.5, marginTop: 8 },
  inicio: { alignItems: 'center', marginTop: 48 },
  chamada: { fontFamily: 'Syne_700Bold', fontSize: 26, lineHeight: 32, color: cor.giz, textAlign: 'center', marginBottom: 40 },
  disco: {
    width: 220, height: 220, borderRadius: 110, backgroundColor: cor.girassol,
    alignItems: 'center', justifyContent: 'center', borderWidth: 14, borderColor: cor.anilProfundo,
  },
  discoCentro: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: cor.anilProfundo, top: 40 },
  discoTexto: { fontFamily: 'Syne_800ExtraBold', fontSize: 30, color: cor.anilProfundo },
  nota: { color: cor.nevoa, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 20 },
  agora: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 28 },
  capaPequena: { width: 64, height: 64, borderRadius: 6 },
  rotulo: { color: cor.nevoa, fontSize: 13 },
  agoraTitulo: { color: cor.giz, fontSize: 18, fontWeight: '600' },
  agoraArtista: { color: cor.nevoa, fontSize: 15 },
  analisando: { alignItems: 'center', marginTop: 40 },
  cartao: { backgroundColor: cor.giz, borderRadius: 20, padding: 20, marginTop: 28 },
  capaGrande: { width: '100%', aspectRatio: 1, borderRadius: 12, marginBottom: 16 },
  sugTitulo: { fontFamily: 'Syne_800ExtraBold', fontSize: 24, color: cor.tinta },
  sugArtista: { fontSize: 17, color: cor.anil, marginTop: 2 },
  motivo: { fontSize: 15, lineHeight: 22, color: cor.tinta, marginTop: 12 },
  perfil: { borderTopWidth: 1, borderColor: '#D9D6EA', marginTop: 16, paddingTop: 14, marginBottom: 8 },
  perfilTitulo: { fontSize: 13, color: '#5A5878', marginBottom: 6 },
  perfilItem: { fontSize: 14, lineHeight: 21, color: cor.tinta },
  perfilChave: { fontWeight: '700' },
  linha: { flexDirection: 'row', gap: 10 },
  botao: {
    flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: 'center',
    backgroundColor: cor.anilProfundo, marginTop: 10,
  },
  botaoPrincipal: { backgroundColor: cor.girassol },
  botaoTexto: { color: cor.giz, fontSize: 15, fontWeight: '700' },
  creditos: { fontSize: 12, color: '#5A5878', textAlign: 'center', marginTop: 14 },
  desligar: { alignSelf: 'center', marginTop: 28, padding: 8 },
  desligarTexto: { color: cor.nevoa, fontSize: 14, textDecorationLine: 'underline' },
  aviso: { color: cor.giz, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 20 },
});
