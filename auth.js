// Login no Spotify via OAuth "Authorization Code com PKCE".
// PKCE é o fluxo indicado para apps de celular: não precisa de client secret no aparelho.
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { SPOTIFY_CLIENT_ID, SCOPES, ESQUEMA } from './config';

WebBrowser.maybeCompleteAuthSession();

const CHAVE = 'sintonia_spotify_token';

export const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

// Gera "sintonia://callback" num build de desenvolvimento ou de produção
export const redirectUri = AuthSession.makeRedirectUri({ scheme: ESQUEMA, path: 'callback' });

export function useSpotifyAuthRequest() {
  return AuthSession.useAuthRequest(
    {
      clientId: SPOTIFY_CLIENT_ID,
      scopes: SCOPES,
      usePKCE: true,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
    },
    discovery
  );
}

async function guardar({ accessToken, refreshToken, expiresIn }) {
  const dados = {
    accessToken,
    refreshToken,
    expiraEm: Date.now() + (expiresIn ?? 3600) * 1000,
  };
  await SecureStore.setItemAsync(CHAVE, JSON.stringify(dados));
}

export async function trocarCodigoPorToken(code, codeVerifier) {
  const res = await AuthSession.exchangeCodeAsync(
    { clientId: SPOTIFY_CLIENT_ID, code, redirectUri, extraParams: { code_verifier: codeVerifier } },
    discovery
  );
  await guardar(res);
  return res.accessToken;
}

// Devolve um token válido, renovando quando faltar menos de 1 minuto para expirar.
// Retorna null quando não há sessão (o app então pede login de novo).
export async function obterTokenValido() {
  const bruto = await SecureStore.getItemAsync(CHAVE);
  if (!bruto) return null;
  const dados = JSON.parse(bruto);
  if (Date.now() < dados.expiraEm - 60_000) return dados.accessToken;
  if (!dados.refreshToken) return null;
  try {
    const res = await AuthSession.refreshAsync(
      { clientId: SPOTIFY_CLIENT_ID, refreshToken: dados.refreshToken },
      discovery
    );
    // O Spotify às vezes não devolve um refresh token novo: mantém o anterior
    await guardar({ ...res, refreshToken: res.refreshToken ?? dados.refreshToken });
    return res.accessToken;
  } catch {
    // Refresh token expirado ou revogado: força novo login
    await SecureStore.deleteItemAsync(CHAVE);
    return null;
  }
}

export async function encerrarSessao() {
  await SecureStore.deleteItemAsync(CHAVE);
}
