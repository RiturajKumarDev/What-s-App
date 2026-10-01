const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
// CHROME / PUPPETEER CONFIGURATION
// =====================================================

let chromePath;

// 1. If environment variable is provided, use it
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    chromePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

// 2. Windows local development
else if (process.platform === 'win32') {
    const windowsChromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];

    chromePath = windowsChromePaths.find((chrome) =>
        fs.existsSync(chrome)
    );
}

// 3. Linux / Docker
else {
    const linuxChromePaths = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];

    chromePath = linuxChromePaths.find((chrome) =>
        fs.existsSync(chrome)
    );
}

// Chrome not found
if (!chromePath) {
    console.error('\n❌ Chrome executable not found!\n');

    if (process.platform === 'win32') {
        console.error('Please install Google Chrome or set:');
        console.error(
            'PUPPETEER_EXECUTABLE_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        );
    } else {
        console.error(
            'Please install Google Chrome/Chromium inside your Docker container.'
        );
    }

    process.exit(1);
}

console.log(`🌐 Using Chrome at: ${chromePath}`);

// =====================================================
// WHATSAPP CLIENT
// =====================================================

let isClientReady = false;
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'fresh-session-1'
    }),

    qrMaxRetries: 5,

    puppeteer: {
        executablePath: chromePath,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('📱 Scan QR:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('✅ WhatsApp authenticated successfully');
});

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Loading ${percent}% - ${message}`);
});

client.on('change_state', (state) => {
    console.log(`📡 State: ${state}`);
});

client.on('ready', () => {
    isClientReady = true;
    console.log('✅ WhatsApp client is ready!');
});

client.on('auth_failure', (msg) => {
    isClientReady = false;
    console.error('❌ Auth failure:', msg);
});

client.on('disconnected', (reason) => {
    isClientReady = false;
    console.log('⚠️ Disconnected:', reason);
});

client.on('error', (error) => {
    console.error('❌ WhatsApp client error:', error);
});

// Change state
client.on('change_state', (state) => {
    console.log('📡 WhatsApp state:', state);
});

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function normalizeNumber(number) {
    if (!number) {
        return null;
    }

    const cleaned = String(number).replace(/\D/g, '');

    if (cleaned.length < 10) {
        return null;
    }

    return cleaned;
}

// =====================================================
// HOME PAGE
// =====================================================

app.get('/', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'public', 'index.html')
    );
});

// =====================================================
// STATUS API
// =====================================================

app.get('/status', (req, res) => {
    res.json({
        success: true,
        whatsappReady: isClientReady,
        chromePath: chromePath
    });
});

// =====================================================
// SEND OTP
// =====================================================

app.post('/send-otp', async (req, res) => {
    try {
        const { number } = req.body;

        // Validate number
        if (!number) {
            return res.status(400).json({
                success: false,
                error: 'number is required'
            });
        }

        // Check WhatsApp client
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error:
                    'WhatsApp client is not ready yet. Scan QR and wait for ready status.'
            });
        }

        // Normalize phone number
        const normalizedNumber = normalizeNumber(number);

        if (!normalizedNumber) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number'
            });
        }

        // Generate OTP
        const otp = Math.floor(
            100000 + Math.random() * 900000
        );

        // OTP message
        const message =
            `🔐 Your OTP for verification is *${otp}*.\n` +
            `This OTP is valid for 10 minutes. Please do not share it with anyone.\n` +
            `If you did not request this code, please ignore this message.`;

        // WhatsApp chat ID
        const chatId = `${normalizedNumber}@c.us`;

        console.log(
            `📤 Checking WhatsApp number: ${normalizedNumber}`
        );

        // Check WhatsApp registration
        const isRegistered =
            await client.isRegisteredUser(chatId);

        if (!isRegistered) {
            return res.status(400).json({
                success: false,
                error:
                    'This number is not registered on WhatsApp'
            });
        }

        // Send OTP
        await client.sendMessage(
            chatId,
            message
        );

        console.log(
            `✅ OTP sent successfully to ${normalizedNumber}`
        );

        return res.status(200).json({
            success: true,
            otp: otp,
            message: 'OTP sent successfully'
        });

    } catch (error) {
        console.error('❌ Send OTP error:', error);

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                'Internal server error'
        });
    }
});

// =====================================================
// SEND MESSAGE
// =====================================================

app.post('/send-message', async (req, res) => {
    try {
        const {
            number,
            message
        } = req.body;

        // Validate request
        if (!number || !message) {
            return res.status(400).json({
                success: false,
                error:
                    'number and message are required'
            });
        }

        // Check WhatsApp client
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error:
                    'WhatsApp client is not ready yet. Scan QR and wait for ready status.'
            });
        }

        // Normalize number
        const normalizedNumber =
            normalizeNumber(number);

        if (!normalizedNumber) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number'
            });
        }

        // Chat ID
        const chatId =
            `${normalizedNumber}@c.us`;

        console.log(
            `📤 Checking WhatsApp number: ${normalizedNumber}`
        );

        // Check registration
        const isRegistered =
            await client.isRegisteredUser(chatId);

        if (!isRegistered) {
            return res.status(400).json({
                success: false,
                error:
                    'This number is not registered on WhatsApp'
            });
        }

        // Send message
        await client.sendMessage(
            chatId,
            message
        );

        console.log(
            `✅ Message sent successfully to ${normalizedNumber}`
        );

        return res.status(200).json({
            success: true,
            message:
                'Message sent successfully'
        });

    } catch (error) {
        console.error(
            '❌ Send message error:',
            error
        );

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                'Internal server error'
        });
    }
});

// =====================================================
// SERVER
// =====================================================

app.listen(PORT, () => {
    console.log(`Running server on http://localhost:${PORT}`);
});

// =====================================================
// INITIALIZE WHATSAPP
// =====================================================

console.log('🔄 Initializing WhatsApp client...');

client.initialize();