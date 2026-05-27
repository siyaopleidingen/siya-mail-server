process.on('uncaughtException',  e => { console.error('CRASH uncaughtException:', e.message, e.stack); process.exit(1); });
process.on('unhandledRejection', e => { console.error('CRASH unhandledRejection:', e); process.exit(1); });

require('dotenv').config();

console.log('=== SIYA STARTUP ===');
console.log('PORT env:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Env vars aanwezig:', Object.keys(process.env).filter(k => !k.startsWith('npm_')).join(', '));

const express      = require('express');
const cors         = require('cors');
const nodemailer   = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const imaps        = require('imap-simple');

const app  = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;

const extraOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: [
    'https://siya-certificaten.netlify.app',
    'http://localhost',
    'http://localhost:3001',
    'http://127.0.0.1',
    'http://127.0.0.1:3001',
    ...extraOrigins
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const SMTP_CONFIG = {
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT) || 587,
  secure: false,   // STARTTLS (Gmail vereist dit op poort 587)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
};

const IMAP_CONFIG = {
  imap: {
    user:        process.env.IMAP_USER || 'GDN1@wannatel.com',
    password:    process.env.IMAP_PASS,
    host:        process.env.IMAP_HOST || 'wannatel.com',
    port:        parseInt(process.env.IMAP_PORT) || 993,
    tls:         true,
    authTimeout: 10000,
    tlsOptions:  { rejectUnauthorized: false }
  }
};

const SENT_BOXES = ['INBOX.Sent', 'Sent', 'Verzonden', 'Sent Items', 'INBOX.Verzonden'];

async function appendToSent(rawMsg) {
  let connection;
  try {
    connection = await imaps.connect(IMAP_CONFIG);
    let appended = false;
    for (const box of SENT_BOXES) {
      try {
        await new Promise((resolve, reject) => {
          connection.imap.append(rawMsg, { mailbox: box, flags: ['\\Seen'] }, err => {
            if (err) reject(err); else resolve();
          });
        });
        console.log(`Kopie opgeslagen in IMAP: ${box}`);
        appended = true;
        break;
      } catch (_) {}
    }
    if (!appended) console.warn('Geen geschikte Sent-map gevonden — kopie overgeslagen.');
  } catch (err) {
    console.warn('IMAP waarschuwing (niet fataal):', err.message);
  } finally {
    if (connection) { try { await connection.end(); } catch (_) {} }
  }
}

app.get('/ping',   (_req, res) => res.send('pong'));
app.get('/health', (_req, res) => res.json({ status: 'ok', port: PORT }));

app.post('/send-email', async (req, res) => {
  const { naam, training, datum, certnr, email, pdf_base64 } = req.body;

  if (!email)      return res.status(400).json({ success: false, message: 'Geen e-mailadres opgegeven.' });
  if (!pdf_base64) return res.status(400).json({ success: false, message: 'Geen PDF data ontvangen.' });

  const subject = `Uw SIYA certificaat — ${training} | ${naam}`;
  const body =
`Beste ${naam},

Hartelijk dank voor uw betaling. Wij bevestigen hierbij de ontvangst van uw betaling voor de ${training} training.

In de bijlage treft u uw officieel certificaat van deelname aan.

Certificaatgegevens:
- Naam: ${naam}
- Training: ${training}
- Datum: ${datum}
- Certificaatnummer: ${certnr}

Mocht u nog vragen hebben, dan kunt u contact met ons opnemen via info@siyaopleidingen.nl of www.siyaopleidingen.nl.

Met vriendelijke groet,

H. Harraz
Directeur — SIYA Opleidingen`;

  const safeNaam = naam.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
  const safeCert = certnr.replace(/[^A-Za-z0-9_-]/g, '');

  const smtpFrom = process.env.SMTP_FROM || '"SIYA Opleidingen" <GDN1@wannatel.com>';
  const mailOptions = {
    from:    smtpFrom,
    sender:  smtpFrom,
    replyTo: 'GDN1@wannatel.com',
    to:      email,
    subject,
    text: body,
    attachments: [{
      filename:    `SIYA_${safeCert}_${safeNaam}.pdf`,
      content:     Buffer.from(pdf_base64, 'base64'),
      contentType: 'application/pdf'
    }]
  };

  try {
    const transporter = nodemailer.createTransport(SMTP_CONFIG);
    const info = await transporter.sendMail(mailOptions);
    console.log(`E-mail verstuurd: ${info.messageId} → ${email}`);

    const raw = await new Promise((resolve, reject) => {
      new MailComposer(mailOptions).compile().build((err, buf) => {
        if (err) reject(err); else resolve(buf);
      });
    }).catch(err => { console.warn('Compile waarschuwing:', err.message); return null; });

    if (raw) await appendToSent(raw);

    res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error('SMTP fout:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Globale error handler — altijd JSON, nooit HTML
app.use((err, _req, res, _next) => {
  console.error('Onafgehandelde fout:', err.message);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Interne serverfout' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  const addr = server.address();
  console.log(`SIYA mail server gestart — adres: ${addr.address}:${addr.port} (family: ${addr.family})`);
});
