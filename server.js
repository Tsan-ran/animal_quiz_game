import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.static('.'));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
