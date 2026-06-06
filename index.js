const path = require('path');
const express = require('express');
const cors = require("cors");
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { execSync } = require('child_process');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let isClientReady = false;

// Find Chrome executable path
function findChrome() {
    const paths = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        process.env.PUPPETEER_EXECUTABLE_PATH
    ].filter(Boolean);
    
    for (const path of paths) {
        try {
            execSync(`test -f ${path}`, { stdio: 'ignore' });
            console.log(`Found Chrome at: ${path}`);
            return path;
        } catch (e) {
            // Path doesn't exist
        }
    }
    
    // Try to find Chrome using which command
    try {
        const whichPath = execSync('which google-chrome-stable || which google-chrome || which chromium', { encoding: 'utf8' }).trim();
        if (whichPath) {
            console.log(`Found Chrome via which: ${whichPath}`);
            return whichPath;
        }
    } catch (e) {}
    
    console.error('Chrome not found!');
    return null;
}

const chromePath = findChrome();

if (!chromePath) {
    console.error('FATAL: Chrome browser not found. Install Chrome first.');
    process.exit(1);
}

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'main-session'
    }),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('\nScan this QR in WhatsApp:\n');
    qrcode.generate(qr, { small: true });
});

client.on('loading_screen', (percent, message) => {
    console.log(`Loading... ${percent}% - ${message}`);
});

client.on('ready', () => {
    isClientReady = true;
    console.log('WhatsApp client is ready!');
});

client.on('authenticated', () => {
    console.log('Authenticated successfully');
});

client.on('auth_failure', (msg) => {
    isClientReady = false;
    console.error('Auth failure:', msg);
});

client.on('disconnected', (reason) => {
    isClientReady = false;
    console.log('Disconnected:', reason);
});

function normalizeNumber(number) {
    if (!number) return null;

    const cleaned = String(number).replace(/\D/g, '');
    if (cleaned.length < 10) return null;

    return cleaned;
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
    res.json({
        success: true,
        whatsappReady: isClientReady
    });
});

app.post('/send-otp', async (req, res) => {
    try {
        const { number } = req.body;
        const otp = Math.floor(100000 + Math.random() * 900000);

        const message = `🔐 Your OTP for verification is *${otp}*.
                This OTP is valid for 10 minutes. Please do not share it with anyone.
                If you did not request this code, please ignore this message.`;

        if (!number || !message) {
            return res.status(400).json({
                success: false,
                error: 'number and message are required'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp client is not ready yet. Scan QR and wait for ready status.'
            });
        }

        const normalizedNumber = normalizeNumber(number);

        if (!normalizedNumber) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number'
            });
        }

        const chatId = `${normalizedNumber}@c.us`;

        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            return res.status(400).json({
                success: false,
                error: 'This number is not registered on WhatsApp'
            });
        }

        await client.sendMessage(chatId, message);

        return res.status(200).json({
            success: true,
            otp: otp,
            message: 'OTP sent successfully'
        });
    } catch (error) {
        console.error('Send error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

app.post('/send-message', async (req, res) => {
    try {
        const { number, message } = req.body;

        if (!number || !message) {
            return res.status(400).json({
                success: false,
                error: 'number and message are required'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp client is not ready yet. Scan QR and wait for ready status.'
            });
        }

        const normalizedNumber = normalizeNumber(number);

        if (!normalizedNumber) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number'
            });
        }

        const chatId = `${normalizedNumber}@c.us`;

        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            return res.status(400).json({
                success: false,
                error: 'This number is not registered on WhatsApp'
            });
        }

        await client.sendMessage(chatId, message);

        return res.status(200).json({
            success: true,
            message: 'Message sent successfully'
        });
    } catch (error) {
        console.error('Send error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

client.initialize();
