'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const env = require('./config/env');
const routes = require('./routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');
const { requestLogger } = require('./middlewares/requestLog');

const openapiDocument = YAML.load(path.join(__dirname, '../docs/openapi.yaml'));

const app = express();

// Detrás del proxy de Render/Railway: req.ip es la IP real del cliente (rate limit, auditoría).
if (env.trustProxy) app.set('trust proxy', env.trustProxy);

app.use(helmet());
// CORS_ORIGIN: lista de orígenes permitidos (fuera de development/test nunca "*"). Un origen
// que no está en la lista no recibe Access-Control-Allow-Origin: el navegador lo bloquea. Las
// apps nativas no mandan Origin y no les afecta.
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '5mb' }));
// Sin valores de la query, headers ni bodies (src/utils/safeLog.js).
app.use(requestLogger({ skip: () => env.nodeEnv === 'test' }));

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));
app.use('/api/v1', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
