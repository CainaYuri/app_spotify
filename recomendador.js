// Pipeline completo de uma sugestão:
// 1) entender a música (backend: Last.fm + IA)  2) localizar candidatas no Spotify
// 3) excluir o que já está na biblioteca/playlists  4) ranquear e devolver a mais compatível
import { BACKEND_URL } from './config';
import { generosDoArtista, buscarFaixa, estaoNaBiblioteca } from './spotify';

export async function sugerir(musica, urisPlaylists = new Set()) {
  // 1. Entender. Só título, artista e ano saem do aparelho.
  const resp = await fetch(`${BACKEND_URL}/analisar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titulo: musica.nome, artista: musica.artistas[0].nome, ano: musica.ano }),
  });
  if (!resp.ok) throw new Error('ANALISE_FALHOU');
  const { perfil, candidatas } = await resp.json();

  // 2. Localizar cada candidata no catálogo do Spotify
  const encontradas = [];
  for (const c of candidatas) {
    const faixa = await buscarFaixa(c.titulo, c.artista).catch(() => null);
    if (faixa && faixa.uri !== musica.uri) encontradas.push({ ...c, faixa });
  }
  if (!encontradas.length) return { perfil, melhor: null, alternativas: [] };

  // 3. Regra: só músicas que NÃO estão na biblioteca nem nas playlists do usuário
  const naBiblioteca = await estaoNaBiblioteca(encontradas.map((e) => e.faixa.uri));
  const novas = encontradas.filter((e, i) => !naBiblioteca[i] && !urisPlaylists.has(e.faixa.uri));
  if (!novas.length) return { perfil, melhor: null, alternativas: [] };

  // 4. Ranquear: primeira passada barata, depois refina as 5 melhores com gêneros do Spotify
  const anoRef = perfil?.epoca?.anoReferencia ?? musica.ano;
  let lista = novas
    .map((e) => ({ ...e, pontuacao: pontuacaoBase(e, musica, anoRef) }))
    .sort((a, b) => b.pontuacao - a.pontuacao);

  const generosOriginal = await generosSeguros(musica.artistas[0].id);
  const topo = lista.slice(0, 5);
  for (const e of topo) {
    const g = await generosSeguros(e.faixa.artists[0].id);
    e.pontuacao += 0.2 * sobreposicaoDeGeneros(generosOriginal, g);
  }
  lista = [...topo.sort((a, b) => b.pontuacao - a.pontuacao), ...lista.slice(5)];

  return { perfil, melhor: lista[0], alternativas: lista.slice(1, 4) };
}

function pontuacaoBase(c, musica, anoRef) {
  const ano = Number((c.faixa.album?.release_date || '').slice(0, 4));
  const proximidadeEpoca = ano && anoRef ? Math.max(0, 1 - Math.abs(ano - anoRef) / 30) : 0.5;
  const mesmoArtista = c.faixa.artists.some((a) => musica.artistas.some((m) => m.id === a.id));
  return (
    0.4 * ((c.compatibilidade ?? 0) / 100) + // nota da IA (melodia, estilo, perfil de ouvintes)
    0.2 * (c.similaridadeLastfm ?? 0) +       // confirmação por comportamento real de ouvintes
    0.2 * proximidadeEpoca -                   // mesma época
    (mesmoArtista ? 0.1 : 0)                   // incentiva descoberta de outros artistas
  );
}

async function generosSeguros(artistaId) {
  try {
    return await generosDoArtista(artistaId);
  } catch {
    return [];
  }
}

// Compara gêneros por palavras ("rock alternativo" e "rock nacional" compartilham "rock")
function sobreposicaoDeGeneros(a, b) {
  if (!a.length || !b.length) return 0.5; // sem dado: neutro
  const pa = new Set(a.flatMap((g) => g.split(/[\s-]+/)));
  const pb = new Set(b.flatMap((g) => g.split(/[\s-]+/)));
  const comum = [...pa].filter((p) => pb.has(p)).length;
  return comum / new Set([...pa, ...pb]).size;
}
