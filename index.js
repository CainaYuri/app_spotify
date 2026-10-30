// Backend do Sintonia: entende a música e gera candidatas compatíveis.
// Fica num servidor (não no celular) para proteger as chaves de API.
import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(express.json({ limit: '20kb' }));

const PORTA = process.env.PORT || 3000;
const USAR_IA = process.env.USAR_IA !== 'false'; // false = modo só com Last.fm
const MODELO = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MAX_CANDIDATAS = 12;
const anthropic = USAR_IA ? new Anthropic() : null; // lê ANTHROPIC_API_KEY do .env

const normalizar = (s = '') =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const chave = (titulo, artista) => `${normalizar(titulo)}|${normalizar(artista)}`;

// ---------- Last.fm: tags (gênero, época, clima) e faixas semelhantes ----------

async function lastfm(metodo, params) {
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.search = new URLSearchParams({
    method: metodo, api_key: process.env.LASTFM_API_KEY, format: 'json', autocorrect: '1', ...params,
  });
  const r = await fetch(url);
  return r.ok ? r.json() : null;
}

async function contextoLastfm(titulo, artista) {
  const [tf, ta, sim] = await Promise.all([
    lastfm('track.gettoptags', { track: titulo, artist: artista }),
    lastfm('artist.gettoptags', { artist: artista }),
    lastfm('track.getsimilar', { track: titulo, artist: artista, limit: '40' }),
  ]);
  const tags = (d) => (d?.toptags?.tag ?? []).slice(0, 12).map((t) => t.name.toLowerCase());
  return {
    tagsFaixa: tags(tf),
    tagsArtista: tags(ta),
    similares: (sim?.similartracks?.track ?? []).map((t) => ({
      titulo: t.name, artista: t.artist?.name, match: Number(t.match) || 0,
    })),
  };
}

// ---------- Modo com IA ----------

const SISTEMA = `Você é um curador musical. Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois e sem crases, neste formato:
{
  "perfil": {
    "generos": ["..."],
    "epoca": { "decada": "anos 80", "anoReferencia": 1985, "movimento": "..." },
    "estilo": "...",
    "melodia": { "andamento": "...", "tonalidade": "... ou incerto", "contorno": "...", "instrumentacao": "...", "clima": "..." },
    "ouvintes": "descrição curta do perfil típico de quem ouve",
    "resumo": "uma frase"
  },
  "candidatas": [
    { "titulo": "...", "artista": "...", "compatibilidade": 0, "motivo": "frase curta em português" }
  ]
}`;

async function analisarComIA(musica, ctx) {
  const similares = ctx.similares.slice(0, 30)
    .map((s) => `- ${s.titulo} — ${s.artista} — ${s.match.toFixed(2)}`).join('\n');

  const pedido = `Música tocando agora: "${musica.titulo}", de ${musica.artista}${musica.ano ? `, álbum de ${musica.ano}` : ''}.
Tags do Last.fm para a faixa: ${ctx.tagsFaixa.join(', ') || 'nenhuma'}.
Tags do Last.fm para o artista: ${ctx.tagsArtista.join(', ') || 'nenhuma'}.
Faixas semelhantes segundo ouvintes do Last.fm (título — artista — similaridade de 0 a 1):
${similares || '- nenhuma'}

1. Monte o perfil musical: gêneros, época, estilo, melodia (andamento, tonalidade ou modo provável, contorno melódico, instrumentação, clima) e o perfil de quem costuma ouvir.
2. Escolha até ${MAX_CANDIDATAS} músicas mais compatíveis em melodia, gênero, época, estilo e público. Use a lista do Last.fm e acrescente sugestões suas. Varie os artistas e use no máximo 2 do mesmo artista da faixa original.
3. Sugira apenas músicas que existem de verdade, com título e artista exatos.
4. Dê a cada uma uma nota de compatibilidade de 0 a 100 e um motivo curto.
Quando não tiver certeza de algo, como a tonalidade, escreva "incerto".`;

  const msg = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 2500,
    system: SISTEMA,
    messages: [{ role: 'user', content: pedido }],
  });
  const texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const dados = JSON.parse(texto.replace(/```json|```/g, '').trim());
  return {
    perfil: dados.perfil ?? null,
    candidatas: Array.isArray(dados.candidatas) ? dados.candidatas : [],
  };
}

// ---------- Modo sem IA (só dados públicos do Last.fm) ----------

const CLIMAS = ['melancholic', 'sad', 'happy', 'chill', 'energetic', 'romantic', 'dark', 'mellow', 'upbeat', 'relaxing'];

function analisarSemIA(musica, ctx) {
  const tags = [...new Set([...ctx.tagsFaixa, ...ctx.tagsArtista])];
  const decadaTag = tags.find((t) => /^(\d{2}|\d{4})s$/.test(t));
  const decada = decadaTag ?? (musica.ano ? `${Math.floor(musica.ano / 10) * 10}s` : null);
  return {
    perfil: {
      generos: tags.filter((t) => !/^\d/.test(t) && !CLIMAS.includes(t)).slice(0, 4),
      epoca: { decada, anoReferencia: musica.ano ?? null },
      estilo: tags.slice(0, 3).join(', '),
      melodia: { clima: tags.filter((t) => CLIMAS.includes(t)).join(', ') || 'incerto' },
      ouvintes: null,
    },
    candidatas: ctx.similares.slice(0, MAX_CANDIDATAS).map((s) => ({
      titulo: s.titulo,
      artista: s.artista,
      compatibilidade: Math.round(s.match * 100),
      motivo: 'Muito ouvida por quem também ouve a música que estava tocando.',
    })),
  };
}

// ---------- Rota usada pelo app ----------

app.post('/analisar', async (req, res) => {
  const { titulo, artista, ano } = req.body ?? {};
  if (!titulo || !artista) return res.status(400).json({ erro: 'Envie titulo e artista.' });

  try {
    const ctx = await contextoLastfm(titulo, artista);
    const musica = { titulo, artista, ano };
    let resultado;
    try {
      resultado = USAR_IA ? await analisarComIA(musica, ctx) : analisarSemIA(musica, ctx);
    } catch (e) {
      console.warn('IA indisponível, usando só o Last.fm:', e.message);
      resultado = analisarSemIA(musica, ctx);
    }

    const matchLastfm = new Map(ctx.similares.map((s) => [chave(s.titulo, s.artista), s.match]));
    const vistas = new Set([chave(titulo, artista)]);
    const candidatas = [];
    for (const c of resultado.candidatas) {
      if (!c?.titulo || !c?.artista) continue;
      const k = chave(c.titulo, c.artista);
      if (vistas.has(k)) continue;
      vistas.add(k);
      candidatas.push({ ...c, similaridadeLastfm: matchLastfm.get(k) ?? 0 });
    }
    candidatas.sort((a, b) => (b.compatibilidade ?? 0) - (a.compatibilidade ?? 0));

    res.json({ perfil: resultado.perfil, candidatas: candidatas.slice(0, MAX_CANDIDATAS) });
  } catch (e) {
    console.error(e);
    res.status(502).json({ erro: 'Não foi possível analisar a música agora.' });
  }
});

app.get('/saude', (_req, res) => res.json({ ok: true, ia: USAR_IA }));

app.listen(PORTA, () => console.log(`Sintonia backend em http://localhost:${PORTA} (IA: ${USAR_IA ? 'ligada' : 'desligada'})`));
