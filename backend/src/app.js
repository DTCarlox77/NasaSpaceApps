'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const env = require('./config/env');
const routes = require('./routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const openapiDocument = YAML.load(path.join(__dirname, '../docs/openapi.yaml'));

const app = express();

// Detrás del proxy de Render/Railway: req.ip es la IP real del cliente (rate limit, auditoría).
if (env.trustProxy) app.set('trust proxy', env.trustProxy);

app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev', { skip: () => env.nodeEnv === 'test' }));

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));
app.use('/api/v1', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
