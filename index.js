const path = require('path');
const express = require('express');
const cors = require("cors");
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { execSync } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let isClientReady = false;

// Find Chrome executable path - more thorough search
function findChrome() {
    // Common Chrome installation paths on Linux
    const pathsToCheck = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/opt/google/chrome/chrome',
        '/usr/local/bin/google-chrome',
        process.env.PUPPETEER_EXECUTABLE_PATH
    ].filter(Boolean);

    // Check each path
    for (const chromePath of pathsToCheck) {
        if (fs.existsSync(chromePath)) {
            console.log(`✅ Found Chrome at: ${chromePath}`);
            return chromePath;
        }
    }

    // Try using 'which' command
    try {
        const whichPath = execSync('which google-chrome-stable || which google-chrome || which chromium-browser || which chromium', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        }).trim();

        if (whichPath && fs.existsSync(whichPath)) {
            console.log(`✅ Found Chrome via which: ${whichPath}`);
            return whichPath;
        }
    } catch (e) {
        // Silent fail
    }

    // List what's in /usr/bin/ for debugging
    try {
        const files = execSync('ls -la /usr/bin/ | grep -i chrome', { encoding: 'utf8' });
        console.log('Files in /usr/bin/ containing chrome:', files);
    } catch (e) { }

    console.error('❌ Chrome not found!');
    return null;
}

const chromePath = findChrome();

if (!chromePath) {
    console.error('⚠️ Chrome not found. Trying to continue with bundled Chromium...');
    // Don't exit, let puppeteer try its bundled version
}

// Configure client with fallback options
const clientOptions = {
    authStrategy: new LocalAuth({
        clientId: 'main-session'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
};

// Add executable path if found
if (chromePath) {
    clientOptions.puppeteer.executablePath = chromePath;
}

const client = new Client(clientOptions);

client.on('qr', (qr) => {
    console.log('\n📱 SCAN THIS QR CODE IN WHATSAPP:\n');
    qrcode.generate(qr, { small: true });
});

client.on('loading_screen', (percent, message) => {
    console.log(`Loading... ${percent}% - ${message}`);
});

client.on('ready', () => {
    isClientReady = true;
    console.log('✅ WhatsApp client is ready!');
});

client.on('authenticated', () => {
    console.log('✅ Authenticated successfully');
});

client.on('auth_failure', (msg) => {
    isClientReady = false;
    console.error('❌ Auth failure:', msg);
});

client.on('disconnected', (reason) => {
    isClientReady = false;
    console.log('⚠️ Disconnected:', reason);
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
        whatsappReady: isClientReady,
        chromePath: chromePath || 'not found'
    });
});

app.post('/send-otp', async (req, res) => {
    try {
        const { number } = req.body;
        const otp = Math.floor(100000 + Math.random() * 900000);

        const message = `🔐 Your OTP for verification is *${otp}*.\nThis OTP is valid for 10 minutes. Please do not share it with anyone.\nIf you did not request this code, please ignore this message.`;

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
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Chrome path: ${chromePath || 'using default'}`);
});

client.initialize();