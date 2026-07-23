# Ecommerce jumpers

Juego cooperativo online de plataformas para 2–12 personas. Cada integrante está conectado al siguiente por una cuerda física: avanzar exige coordinar saltos, empujes y rescates. Todo el arte, nivel y nombre son originales.

## Arquitectura

- `client`: Phaser 3 + Vite. Envía únicamente inputs secuenciados, predice al jugador local, reconcilia snapshots e interpola compañeros.
- `server`: Node, Socket.IO y Matter.js. Es la fuente de verdad de física, cuerda, colisiones, objetos, llave, puerta, muerte y victoria.
- `shared`: contratos TypeScript, Zod y parámetros de red/física.
- `tests`: pruebas unitarias y un flujo Playwright con dos contextos de navegador.

El servidor simula a 60 Hz y publica snapshots a 20 Hz. Las correcciones pequeñas se mezclan progresivamente; las discrepancias grandes se corrigen de inmediato. La cuerda simple aplica un resorte amortiguado sólo al superar su longitud de reposo y limita tanto fuerza como distancia.

## Desarrollo local

Requiere Node.js 20 o posterior.

```bash
npm install
npm run dev
```

Cliente: `http://localhost:5173`  
Servidor y health check: `http://localhost:3001/health`

Abra dos pestañas, cree una sala en la primera, copie el código, únase desde la segunda, marque ambas como listas e inicie desde la pestaña líder.

Comandos disponibles:

```bash
npm run dev:client
npm run dev:server
npm run build
npm run typecheck
npm run test
npx playwright install chromium
npm run test:e2e
```

## Controles

- `A`/`D` o flechas: movimiento.
- `W`, flecha arriba o espacio: salto.
- `F3`: panel de física/red.
- `R`: reinicio solicitado por el líder (sólo fuera de producción).
- Gamepad: stick izquierdo y botón inferior.

## Probar desde otra computadora de la red

1. Ejecute `npm run dev` en la computadora anfitriona.
2. Permita los puertos TCP 5173 y 3001 en el firewall local.
3. Cree `.env` con `CLIENT_ORIGIN=http://IP-DEL-ANFITRION:5173`.
4. Cree `client/.env.local` con `VITE_SERVER_URL=http://IP-DEL-ANFITRION:3001`.
5. En ambas computadoras abra `http://IP-DEL-ANFITRION:5173`.

## Producción

Compile con `npm run build`. Publique `client/dist` en Vercel o Netlify y el servidor Node persistente en Railway, Render o Fly.io. Configure:

- Servidor: `PORT`, `CLIENT_ORIGIN`, `RECONNECT_TIMEOUT_MS`, `NODE_ENV=production`.
- Cliente: `VITE_SERVER_URL=https://servidor.example`.

No aloje el servidor Socket.IO en una función serverless tradicional: necesita conexiones WebSocket persistentes y salas en memoria.

## Extensión

Los parámetros ajustables están en `shared/src/constants.ts`. `RopeConstraintSimple` está separado de `RopeConstraintWithSegments` para incorporar colisión de cuerda con esquinas sin reemplazar el modelo estable inicial. Las salas están detrás de `RoomManager`, por lo que persistencia, usuarios y estadísticas pueden agregarse sin cambiar el protocolo de juego.
