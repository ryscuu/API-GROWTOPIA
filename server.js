const express = require('express');
const cors = require('cors');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Credentials
const supabaseUrl = 'https://axuochmvpjlczgmskimy.supabase.co';
const supabaseKey = 'sb_publishable_gvFiMEp-oLuT5RoSBhLWdQ_al8sTI2S';
const supabase = createClient(supabaseUrl, supabaseKey);

// Apply security headers globally with Helmet
// Configure CSP to whitelist external CDNs used by the dashboard (Google Fonts, Chart.js)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
        },
    },
}));
app.use(cors());

// --- Security & Rate Limiting ---
app.set('trust proxy', 1); // Trust first proxy (important if hosting on Vercel/Heroku/Railway)

// API Rate Limiter: Max 120 requests per 1 minute per IP for API routes
// Dashboard polls ~3 endpoints every 5s = ~36/min, so 120 gives ample headroom
// while still blocking aggressive scrapers and DDoS attempts
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 120, // Limit each IP to 120 API requests per minute
    message: { error: 'API rate limit exceeded. Please wait 1 minute before trying again.' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use('/api/', apiLimiter);
// --------------------------------

// --- API Usage Tracking ---
let apiRequestsToday = 0;
let apiTrackingDate = new Date().toDateString();
const activeIPs = new Map(); // Tracks IP -> Last Seen Timestamp

// Middleware to track API hits
app.use((req, res, next) => {
    // Only track actual API calls
    if (req.path.startsWith('/api/')) {
        // Reset daily counter if a new day has started
        const today = new Date().toDateString();
        if (today !== apiTrackingDate) {
            apiRequestsToday = 0;
            apiTrackingDate = today;
            activeIPs.clear(); // Clear active users on a new day (optional, but clean)
        }

        apiRequestsToday++;

        // Track unique IP for active users (last 15 minutes)
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        activeIPs.set(clientIp, Date.now());
    }
    next();
});

// Clean up stale IPs every 5 minutes
setInterval(() => {
    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
    for (const [ip, lastSeen] of activeIPs.entries()) {
        if (lastSeen < fifteenMinutesAgo) {
            activeIPs.delete(ip);
        }
    }
}, 5 * 60 * 1000);
// --------------------------

// Serve static files from the 'public' directory
app.use(express.static('public'));

// In-memory cache
let latestDataCache = {
    status: 'error',
    message: 'Initializing...',
    data: null
};

let latestModsCache = {
    status: 'error',
    message: 'Initializing...',
    data: null
};

// Function to fetch Live Mods from external API
function fetchLiveModsData() {
    console.log('Fetching new mod data...');
    https.get('https://web-lilac-chi-57.vercel.app/api/mods', (response) => {
        let data = '';

        response.on('data', (chunk) => {
            data += chunk;
        });

        response.on('end', () => {
            try {
                const parsedData = JSON.parse(data);

                // Add our server's fetch time so the frontend knows exactly when we checked
                parsedData.serverTimestamp = new Date().toISOString();

                // Construct our clean JSON response for memory cache
                latestModsCache = {
                    status: 'success',
                    data: parsedData
                };

            } catch (error) {
                console.error('Error parsing Mod data:', error);
            }
        });

    }).on('error', (error) => {
        console.error('Error fetching data from Mod API:', error);
        latestModsCache = {
            status: 'error',
            message: 'Failed to fetch mod data',
            data: null
        };
    });
}

// Global state to track actual changes
let lastPlayerCount = 0;
let lastUpdateTimestamp = new Date().toISOString();

// Function to fetch Live Data from Growtopia
function fetchLiveGrowtopiaData() {
    console.log('Fetching new data from Growtopia...');
    https.get('https://growtopiagame.com/detail', (response) => {
        let data = '';

        response.on('data', (chunk) => {
            data += chunk;
        });

        response.on('end', () => {
            try {
                const parsedData = JSON.parse(data);
                const playerCount = parseInt(parsedData.online_user) || 0;

                if (playerCount > 0) {
                    // Keep track for the graph
                    lastPlayerCount = playerCount;
                }

                // Always update timestamp to show when the server last successfully checked
                lastUpdateTimestamp = new Date().toISOString();

                // Construct our clean JSON response for memory cache
                latestDataCache = {
                    status: 'success',
                    data: {
                        onlinePlayers: playerCount,
                        server: 'Online',
                        timestamp: lastUpdateTimestamp
                    }
                };

            } catch (error) {
                console.error('Error parsing Growtopia data:', error);
            }
        });

    }).on('error', (error) => {
        console.error('Error fetching data from Growtopia:', error);
    });
}

// Function to save exactly one data point per minute for the graph
async function saveToDatabase() {
    if (lastPlayerCount > 0) {
        const { error } = await supabase
            .from('player_history')
            .insert([{ player_count: lastPlayerCount }]);

        if (error) {
            console.error('Supabase insert error (Ensure table exists!):', error.message);
        } else {
            console.log('Saved point to graph (1-min interval):', lastPlayerCount);
        }
    }
}

// Automatically fetch new data every 30 seconds
setInterval(fetchLiveGrowtopiaData, 30000);

// Automatically fetch mods data every 60 seconds
setInterval(fetchLiveModsData, 60000);

// Automatically save to graph database every 60 seconds
setInterval(saveToDatabase, 60000);

// API Endpoint to fetch latest live data instantly from memory cache
app.get('/api/server-data', (req, res) => {
    res.json(latestDataCache);
});

// API Endpoint to fetch mods data
app.get('/api/mods', (req, res) => {
    res.json(latestModsCache);
});

// API Endpoint to fetch recent history from database for the chart
app.get('/api/history', async (req, res) => {
    try {
        // Fetch the last 25 records
        const { data, error } = await supabase
            .from('player_history')
            .select('*')
            .order('id', { ascending: false })
            .limit(25);

        if (error) {
            throw error;
        }

        // Return in reverse order (oldest to newest) so chart plots chronologically
        res.json({
            status: 'success',
            data: data.reverse()
        });
    } catch (err) {
        console.error('Failed to fetch history from Supabase:', err.message);
        res.status(500).json({ status: 'error', message: 'Failed to fetch history' });
    }
});

// API Endpoint to fetch live API Usage Stats (Active Users & Daily Requests)
app.get('/api/stats', (req, res) => {
    res.json({
        status: 'success',
        data: {
            activeUsers: activeIPs.size,
            requestsToday: apiRequestsToday
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    fetchLiveGrowtopiaData(); // Initial live fetch on startup
    fetchLiveModsData(); // Initial mod fetch on startup
});

