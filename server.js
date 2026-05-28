process.on('uncaughtException',  e => { console.error('CRASH uncaughtException:', e.message, e.stack); process.exit(1); });
process.on('unhandledRejection', e => { console.error('CRASH unhandledRejection:', e); process.exit(1); });

require('dotenv').config();

console.log('=== SIYA STARTUP ===');
console.log('PORT env:', process.env.PORT);
console.log('RESEND_API_KEY aanwezig:', !!process.env.RESEND_API_KEY);

const express      = require('express');
const { Resend }   = require('resend');

const app    = express();
const PORT   = parseInt(process.env.PORT, 10) || 3001;
const resend = new Resend(process.env.RESEND_API_KEY);

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const FROM_ADDRESS = process.env.RESEND_FROM || 'SIYA Opleidingen <GDN1@wannatel.com>';
const REPLY_TO     = 'GDN1@wannatel.com';

app.get('/ping',   (_req, res) => res.send('pong'));
app.get('/health', (_req, res) => res.json({ status: 'ok', port: PORT }));

app.get('/test-mail', async (req, res) => {
  const to = req.query.to || 'hicham.yassir@gmail.com';
  console.log('[test-mail] Versturen naar:', to, '| from:', FROM_ADDRESS);
  try {
    const { data, error } = await resend.emails.send({
      from:    FROM_ADDRESS,
      to,
      bcc:     [REPLY_TO],
      replyTo: REPLY_TO,
      subject: 'SIYA test mail',
      text:    'Dit is een test mail van de Railway/Resend server.'
    });
    if (error) {
      console.error('[test-mail] Resend fout:', error);
      return res.status(500).json({ success: false, error });
    }
    console.log('[test-mail] Verstuurd, id:', data.id);
    res.json({ success: true, id: data.id, to });
  } catch (err) {
    console.error('[test-mail] Fout:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/send-email', async (req, res) => {
  const { naam, training, datum, certnr, email, pdf_base64 } = req.body;

  if (!email)      return res.status(400).json({ success: false, message: 'Geen e-mailadres opgegeven.' });
  if (!pdf_base64) return res.status(400).json({ success: false, message: 'Geen PDF data ontvangen.' });

  const subject = `Uw SIYA certificaat — ${training} | ${naam}`;
  const html = `<p>Beste ${naam},</p>
<p>Hartelijk dank voor uw betaling. Wij bevestigen hierbij de ontvangst van uw betaling voor de <strong>${training}</strong> training.</p>
<p>In de bijlage treft u uw officieel certificaat van deelname aan.</p>
<p><strong>Certificaatgegevens:</strong><br>
Naam: ${naam}<br>
Training: ${training}<br>
Datum: ${datum}<br>
Certificaatnummer: ${certnr}</p>
<p>Mocht u nog vragen hebben, dan kunt u contact met ons opnemen via <a href="mailto:info@siyaopleidingen.nl">info@siyaopleidingen.nl</a> of <a href="https://www.siyaopleidingen.nl">www.siyaopleidingen.nl</a>.</p>
<p>Met vriendelijke groet,<br><br>H. Harraz<br>Directeur — SIYA Opleidingen</p>`;

  const safeNaam = naam.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
  const safeCert = certnr.replace(/[^A-Za-z0-9_-]/g, '');

  console.log(`[send-email] Versturen naar: ${email} | cert: ${certnr}`);

  try {
    const { data, error } = await resend.emails.send({
      from:        FROM_ADDRESS,
      to:          email,
      bcc:         [REPLY_TO],
      replyTo:     REPLY_TO,
      subject,
      html,
      attachments: [{
        filename: `SIYA_${safeCert}_${safeNaam}.pdf`,
        content:  pdf_base64
      }]
    });

    if (error) {
      console.error('[send-email] Resend fout:', JSON.stringify(error));
      return res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
    }

    console.log(`[send-email] Verstuurd: ${data.id} → ${email}`);
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('[send-email] Fout:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.use((err, _req, res, _next) => {
  console.error('Onafgehandelde fout:', err.message);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Interne serverfout' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  const addr = server.address();
  console.log(`SIYA mail server gestart — adres: ${addr.address}:${addr.port}`);
});
