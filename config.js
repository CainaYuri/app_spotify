// Configuração central do Sintonia (app mobile)

// Passo 1: copie o Client ID do app criado em developer.spotify.com/dashboard
export const SPOTIFY_CLIENT_ID = 'COLE_SEU_CLIENT_ID_AQUI';

// Esquema de deep link do app. O redirect URI cadastrado no painel do Spotify
// deve ser exatamente: sintonia://callback
export const ESQUEMA = 'sintonia';

// Endereço do seu backend (server/index.js). Em teste local no celular,
// use o IP da sua máquina na rede (ex.: http://192.168.0.10:3000), não "localhost".
export const BACKEND_URL = 'http://192.168.0.10:3000';

// Permissões pedidas ao usuário no login do Spotify
export const SCOPES = [
  'user-read-currently-playing', // ler a música que está tocando
  'user-read-playback-state',
  'user-library-read',           // saber o que já está na biblioteca
  'user-library-modify',         // botão "Salvar na biblioteca"
  'playlist-read-private',       // excluir músicas que já estão nas playlists do usuário
  'playlist-read-collaborative',
  'user-modify-playback-state',  // botão "Adicionar à fila" (exige Premium)
];

// De quanto em quanto tempo o app consulta o Spotify enquanto está aberto
export const INTERVALO_LEITURA_MS = 8000;
