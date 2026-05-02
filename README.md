# Fint Backend

API REST + Bot de WhatsApp para la plataforma Fint.

## Requisitos

- Node.js 18+
- MongoDB
- Cuenta en [Groq](https://console.groq.com) (IA + transcripción de audio)

## Setup inicial

```bash
npm install
cp .env.example .env
# Completar los valores en .env
```

## Correr en desarrollo

El backend y el worker de WhatsApp son **dos procesos separados**. Esto permite reiniciar el backend sin que WhatsApp se desconecte.

```bash
# Terminal 1 — Worker de WhatsApp (mantener siempre corriendo)
npm run dev:worker

# Terminal 2 — Backend principal
npm run dev
```

## Scripts disponibles

| Script | Descripción |
|---|---|
| `npm run dev` | Backend con nodemon (reinicia ante cambios) |
| `npm run dev:worker` | Worker de WhatsApp con nodemon |
| `npm start` | Backend en producción |
| `npm run start:worker` | Worker en producción |
| `npm test` | Tests con Vitest |
| `npm run lint` | Chequeo de sintaxis |

---

## Arquitectura: WhatsApp Worker

El worker corre como un proceso independiente en el **puerto 3001**. Su único trabajo es mantener la conexión de WhatsApp y actuar como gateway de mensajes.

```
[WhatsApp]
    │
    ▼
[Worker :3001]  ──POST webhook──▶  [Backend :5000]
                                        │
                                        ├─ Resuelve tenant (DB)
                                        ├─ Transcribe audio (Groq Whisper)
                                        ├─ Procesa con IA (Llama 3.3 70B)
                                        └─ Responde vía Worker API
```

### Por qué separado

- Al reiniciar el backend, la sesión de WhatsApp **no se interrumpe**
- El worker no tiene lógica de negocio, solo maneja la conexión
- Cada proceso puede escalar o reiniciarse de forma independiente

### Comunicación interna

Toda la comunicación entre backend y worker se autentica con `WORKER_INTERNAL_SECRET`.

| Dirección | Endpoint | Uso |
|---|---|---|
| Backend → Worker | `GET /status` | Estado de la conexión |
| Backend → Worker | `POST /start` | Iniciar cliente WhatsApp |
| Backend → Worker | `POST /stop` | Detener cliente |
| Backend → Worker | `POST /restart` | Reiniciar cliente |
| Backend → Worker | `POST /send` | Enviar mensaje de texto |
| Backend → Worker | `POST /send-media` | Enviar archivo (PDF, etc.) |
| Worker → Backend | `POST /api/whatsapp/webhook/message` | Mensaje entrante de WhatsApp |

### Flujo de un mensaje entrante

1. Usuario manda mensaje a WhatsApp
2. Worker lo recibe y hace `POST /api/whatsapp/webhook/message` al backend
3. Backend resuelve a qué tenant pertenece el número (tabla `settings`)
4. Si es audio, lo transcribe con Groq Whisper
5. `iaController` procesa el texto con Llama 3.3 70B
6. Backend llama a `POST /send` del worker con la respuesta
7. Worker envía el mensaje de vuelta al usuario

---

## Variables de entorno

Ver [.env.example](.env.example) para la lista completa con descripciones.

Variables clave:

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del backend (default: 5000) |
| `MONGO_URI` | URI de MongoDB |
| `JWT_SECRET` | Clave para tokens JWT |
| `GROQ_API_KEY` | API key de Groq |
| `WORKER_PORT` | Puerto del worker (default: 3001) |
| `WORKER_URL` | URL del worker (vista desde el backend) |
| `WORKER_INTERNAL_SECRET` | Secreto compartido backend ↔ worker |
| `BACKEND_WEBHOOK_URL` | URL del backend (vista desde el worker) |

Generar un `WORKER_INTERNAL_SECRET` seguro:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Estructura del proyecto

```
fint-backend/
├── server.js                    # Entry point del backend
├── whatsapp-worker/
│   ├── server.js                # Entry point del worker
│   └── handler.js               # Cliente WhatsApp (whatsapp-web.js)
└── src/
    ├── app.js                   # Factory de Express
    ├── config/
    ├── controllers/
    │   ├── whatsappController.js  # Endpoints + webhook handler
    │   └── iaController.js        # Lógica de IA (Llama 70B)
    ├── services/
    │   ├── whatsappService.js     # Proxy HTTP al worker
    │   └── groqService.js         # Groq API (IA + Whisper)
    ├── models/
    ├── routes/
    ├── middlewares/
    └── utils/
```

---

## Producción (PM2)

```bash
npm install -g pm2

pm2 start server.js --name fint-backend
pm2 start whatsapp-worker/server.js --name fint-worker

pm2 save
pm2 startup
```

Con esto ambos procesos se reinician automáticamente si el servidor se cae, y el worker mantiene la sesión de WhatsApp aunque el backend se reinicie por un deploy.
