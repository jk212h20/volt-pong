'use strict';

const path = require('path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');

const app = Fastify({ logger: true });
const root = __dirname;

app.register(fastifyStatic, {
  root,
  index: ['index.html'],
  decorateReply: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
});

app.get('/health', async () => ({ ok: true }));
app.setNotFoundHandler((req, reply) => reply.sendFile('index.html'));

const port = Number(process.env.PORT || 3000);
const host = '0.0.0.0';

app.listen({ port, host }).catch(err => {
  app.log.error(err);
  process.exit(1);
});
