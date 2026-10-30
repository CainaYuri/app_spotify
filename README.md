# Sintonia

App mobile (Android e iOS) que lê a música tocando no Spotify, entende gênero, época, estilo, melodia e perfil de ouvintes, e sugere a música mais compatível que ainda não está na biblioteca do usuário.

## Estrutura

```
sintonia/
  app/      App em React Native (Expo)
    App.js              tela principal
    app.json            esquema de deep link "sintonia://"
    src/config.js       Client ID, URL do backend, permissões
    src/auth.js         login Spotify (PKCE) e renovação de token
    src/spotify.js      leitura, busca, biblioteca, fila, abrir o Spotify
    src/recomendador.js pipeline: entender → buscar → excluir biblioteca → ranquear
  server/   Backend Node (Last.fm + IA)
```

## 1. Spotify

1. Acesse developer.spotify.com/dashboard com uma conta **Premium** e crie um app marcando "Web API".
2. Redirect URI: `sintonia://callback`.
3. Em "User Management", adicione o e-mail de quem vai testar (até 5 pessoas no modo de desenvolvimento).
4. Copie o Client ID para `app/src/config.js`.

## 2. Backend

```bash
cd server
npm install express dotenv @anthropic-ai/sdk
cp .env.example .env   # preencha LASTFM_API_KEY e ANTHROPIC_API_KEY
npm start
```

Chave do Last.fm: last.fm/api/account/create. Para não enviar nada a um modelo de IA, use `USAR_IA=false`.

## 3. App

```bash
npx create-expo-app@latest sintonia-app --template blank
cd sintonia-app
npx expo install expo-auth-session expo-crypto expo-web-browser expo-secure-store expo-font @expo-google-fonts/syne
# copie App.js, app.json e a pasta src/ deste projeto para cá
# ajuste BACKEND_URL em src/config.js para o IP da sua máquina
npx expo run:android   # ou: npx expo run:ios (precisa de Mac)
```

Use um build de desenvolvimento (`expo run:*`), não o Expo Go: o login depende do esquema `sintonia://`.
