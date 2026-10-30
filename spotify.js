// Integração com o Spotify: Web API (dados) + deep links (abrir o app Spotify no celular).
// Endpoints já atualizados para as regras de 2026 do modo de desenvolvimento
// (ex.: /me/library/contains, /playlists/{id}/items, busca com limite máximo de 10).
import { Linking } from 'react-native';
import { obterTokenValido } from './auth';

const API = 'https://api.spotify.com/v1';

async function chamar(caminho, opcoes = {}) {
  const token = await obterTokenValido();
  if (!token) throw new Error('SEM_SESSAO');
  const res = await fetch(caminho.startsWith('http') ? caminho : `${API}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
  });
  if (res.status === 204) return null; // ex.: nada tocando
  if (res.status === 401) throw new Error('SEM_SESSAO');
  if (res.status === 429) {
    const espera = Number(res.headers.get('Retry-After') ?? 5);
    throw Object.assign(new Error('LIMITE_DE_REQUISICOES'), { espera });
  }
  if (!res.ok) throw new Error(`Spotify respondeu ${res.status} em ${caminho}`);
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

// ---------- Abrir o Spotify no celular ----------

export async function abrirSpotify() {
  try {
    await Linking.openURL('spotify:');
  } catch {
    await Linking.openURL('https://open.spotify.com'); // app não instalado
  }
}

export async function abrirFaixa(faixa) {
  try {
    await Linking.openURL(faixa.uri); // spotify:track:ID abre direto no app
  } catch {
    await Linking.openURL(faixa.external_urls?.spotify ?? `https://open.spotify.com/track/${faixa.id}`);
  }
}

// ---------- Leitura ----------

export function meuPerfil() {
  return chamar('/me');
}

// Lê a música que está tocando agora no Spotify do usuário
export async function lerMusicaAtual() {
  const d = await chamar('/me/player/currently-playing?additional_types=track');
  if (!d?.item || d.currently_playing_type !== 'track') return null;
  const t = d.item;
  return {
    id: t.id,
    uri: t.uri,
    nome: t.name,
    artistas: t.artists.map((a) => ({ id: a.id, nome: a.name })),
    album: t.album?.name,
    ano: Number((t.album?.release_date || '').slice(0, 4)) || null,
    capa: t.album?.images?.[0]?.url ?? null,
    tocando: d.is_playing,
  };
}

export async function generosDoArtista(artistaId) {
  const a = await chamar(`/artists/${artistaId}`);
  return a?.genres ?? [];
}

const normalizar = (s = '') =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

// Procura no catálogo do Spotify a faixa sugerida. Se a IA "inventar" uma música,
// ela simplesmente não é encontrada e cai fora da lista.
export async function buscarFaixa(titulo, artista) {
  const q = encodeURIComponent(`track:${titulo} artist:${artista}`);
  const r = await chamar(`/search?q=${q}&type=track&limit=5`);
  const itens = r?.tracks?.items ?? [];
  return itens.find((t) => t.artists.some((a) => normalizar(a.name) === normalizar(artista))) ?? null;
}

// true/false para cada URI: está nas "Músicas curtidas" / biblioteca?
export async function estaoNaBiblioteca(uris) {
  const resposta = [];
  for (let i = 0; i < uris.length; i += 20) {
    const lote = uris.slice(i, i + 20);
    const r = await chamar(`/me/library/contains?uris=${encodeURIComponent(lote.join(','))}`);
    resposta.push(...(r ?? lote.map(() => false)));
  }
  return resposta;
}

// Junta as músicas das playlists do próprio usuário para também excluí-las das sugestões.
// Limitado para não estourar a cota do modo de desenvolvimento.
export async function urisDasMinhasPlaylists(meuId, maxPlaylists = 20, maxPaginas = 4) {
  const uris = new Set();
  const lista = await chamar('/me/playlists?limit=50');
  const minhas = (lista?.items ?? [])
    .filter((p) => p.owner?.id === meuId || p.collaborative)
    .slice(0, maxPlaylists);

  for (const p of minhas) {
    let url = `/playlists/${p.id}/items?limit=50`;
    for (let pagina = 0; url && pagina < maxPaginas; pagina++) {
      const pag = await chamar(url);
      for (const it of pag?.items ?? []) {
        const uri = it?.item?.uri ?? it?.track?.uri;
        if (uri) uris.add(uri);
      }
      url = pag?.next ?? null;
    }
  }
  return uris;
}

// ---------- Ações ----------

export function adicionarNaFila(uri) {
  return chamar(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: 'POST' });
}

export function salvarNaBiblioteca(uri) {
  return chamar('/me/library', { method: 'PUT', body: JSON.stringify({ uris: [uri] }) });
}
