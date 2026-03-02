document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const playerCountEl = document.getElementById('player-count');
    const statusTextEl = document.getElementById('server-status-text');
    const statusIndicatorEl = document.querySelector('.status-indicator');
    const timestampTextEl = document.getElementById('timestamp-text');
    const trendIndicatorEl = document.getElementById('trend-indicator');
    const copyBtn = document.getElementById('copy-btn');

    // State
    let currentPlayers = 0;
    let lastUpdateDate = null;
    let lastModsUpdateDate = null; // New state for mods timestamp
    let chartInstance = null;

    // Chart Arrays (Loaded from backend DB)
    let timeLabels = [];
    let playerData = [];

    // Initialize
    initChart();

    // We fetch history first, which then calls fetchServerData
    fetchHistoryData();
    fetchModsData(); // Fetch mods on load
    fetchApiStats(); // Start real API stats tracking

    // Setup auto-refresh every 5 seconds (fetches from our fast Node cache)
    setInterval(fetchServerData, 5000);

    // Setup auto-refresh for mods every 15 seconds 
    setInterval(fetchModsData, 15000);

    // Setup auto-refresh for API Usage stats every 5 seconds
    setInterval(fetchApiStats, 5000);

    // Setup relative time updater every 1 second (smooth update)
    setInterval(() => {
        updateRelativeTime();
        updateModsRelativeTime();
    }, 1000);

    // Dynamic API Snippet Rotator
    const apiPreviewTitle = document.getElementById('api-preview-title');
    const apiPreviewCode = document.getElementById('api-preview-code');
    const apiEndpointUrl = document.getElementById('api-endpoint-url');
    let showingServerDataAPI = true;

    function rotateApiSnippet() {
        if (!apiPreviewTitle || !apiPreviewCode || !apiEndpointUrl) return;

        apiPreviewCode.style.opacity = '0'; // fade out

        setTimeout(() => {
            if (showingServerDataAPI) {
                // Switch to Mods API
                apiEndpointUrl.textContent = "/api/mods";
                apiPreviewTitle.textContent = "Response Example: /api/mods";
                apiPreviewCode.textContent = `{
  "status": "success",
  "data": {
    "online": [
      {
        "name": "misthios",
        "undercover": false,
        "onlineSince": 1772389167153,
        "duration": "30m"
      }
    ],
    "undercover": [],
    "total": 1,
    "lastUpdate": 1772391068136
  }
}`;
            } else {
                // Switch to Server Data API
                apiEndpointUrl.textContent = "/api/server-data";
                apiPreviewTitle.textContent = "Response Example: /api/server-data";
                apiPreviewCode.textContent = `{
  "status": "success",
  "data": {
    "onlinePlayers": 80200,
    "server": "Online",
    "timestamp": "2026-03-02T12:00:00Z"
  }
}`;
            }

            apiPreviewCode.style.transition = 'opacity 0.4s ease';
            apiPreviewCode.style.opacity = '1'; // fade in

            showingServerDataAPI = !showingServerDataAPI;
        }, 400); // Wait for fade out
    }

    // Initial content setup
    showingServerDataAPI = false; // Set to false so first rotate goes to server data explicitly
    rotateApiSnippet();

    // Rotate every 5 seconds
    setInterval(rotateApiSnippet, 5000);

    // Copy API Endpoints Helper
    function copyToClipboard(text, btnElement) {
        navigator.clipboard.writeText(text).then(() => {
            const originalHTML = btnElement.innerHTML;
            btnElement.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="copy-success"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            showToast('API Endpoint copied to clipboard!');
            setTimeout(() => { btnElement.innerHTML = originalHTML; }, 2000);
        }).catch(err => {
            console.error('Failed to copy: ', err);
            showToast('Failed to copy endpoint');
        });
    }

    // Main API Copy
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const apiEndpointUrl = document.getElementById('api-endpoint-url');
            const endpointPath = apiEndpointUrl ? apiEndpointUrl.textContent : '/api/server-data';
            const endpointUrl = window.location.origin + endpointPath;
            copyToClipboard(endpointUrl, copyBtn);
        });
    }

    // Functions
    async function fetchApiStats() {
        try {
            const apiUsersCountEl = document.getElementById('api-users-count');
            const apiRequestsCountEl = document.getElementById('api-requests-count');
            if (!apiUsersCountEl || !apiRequestsCountEl) return;

            const response = await fetch('/api/stats');
            if (response.ok) {
                const result = await response.json();
                if (result.status === 'success' && result.data) {

                    // Parse old values to animate from
                    const oldUsers = parseInt(apiUsersCountEl.textContent.replace(/\D/g, '')) || 0;
                    const oldRequests = parseInt(apiRequestsCountEl.textContent.replace(/\D/g, '')) || 0;

                    const newUsers = result.data.activeUsers;
                    const newRequests = result.data.requestsToday;

                    // Only animate if values changed or it's first load
                    if (oldUsers !== newUsers) {
                        animateValue(apiUsersCountEl, oldUsers, newUsers, 1000);
                    } else if (apiUsersCountEl.textContent === '--') {
                        animateValue(apiUsersCountEl, 0, newUsers, 1000);
                    }

                    if (oldRequests !== newRequests) {
                        animateValue(apiRequestsCountEl, oldRequests, newRequests, 1000);
                    } else if (apiRequestsCountEl.textContent === '--') {
                        animateValue(apiRequestsCountEl, 0, newRequests, 1000);
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching API stats:', error);
        }
    }

    async function fetchModsData() {
        try {
            const response = await fetch('/api/mods');
            if (response.ok) {
                const result = await response.json();
                if (result.status === 'success' && result.data) {

                    // Update timestamp from server side proxy time
                    if (result.data.serverTimestamp) {
                        lastModsUpdateDate = new Date(result.data.serverTimestamp);
                    } else if (result.data.lastUpdate) {
                        lastModsUpdateDate = new Date(result.data.lastUpdate);
                    }

                    renderModsList(result.data);

                    // Trigger UI update for time immediately
                    updateModsRelativeTime();
                }
            }
        } catch (error) {
            console.error('Error fetching mods data:', error);
            document.getElementById('mods-list').innerHTML = '<li class="mod-item placeholder" style="color: #ff5f56;">Error loading mods data</li>';
        }
    }

    function renderModsList(data) {
        const modsListEl = document.getElementById('mods-list');
        const totalModsCountEl = document.getElementById('total-mods-count');
        const undercoverModsCountEl = document.getElementById('undercover-mods-count');

        // Update Counts Explicitly
        let onlineCount = data.online ? data.online.length : 0;
        let undercoverCount = data.undercover ? data.undercover.length : 0;

        if (totalModsCountEl) totalModsCountEl.textContent = onlineCount;
        if (undercoverModsCountEl) undercoverModsCountEl.textContent = undercoverCount;

        // Clear current list
        modsListEl.innerHTML = '';

        // Combine online and undercover into one array for easier rendering
        const allActiveMods = [];

        if (data.online && data.online.length > 0) {
            allActiveMods.push(...data.online.map(mod => ({ ...mod, isUndercover: false })));
        }
        if (data.undercover && data.undercover.length > 0) {
            allActiveMods.push(...data.undercover.map(mod => ({ ...mod, isUndercover: true })));
        }

        if (allActiveMods.length === 0) {
            modsListEl.innerHTML = '<li class="mod-item placeholder">No mods are currently active.</li>';
            return;
        }

        // Render each mod
        allActiveMods.forEach(mod => {
            const li = document.createElement('li');
            li.className = 'mod-item';

            // Generate avatar initials (first 2 letters)
            const initials = mod.name.substring(0, 2).toUpperCase();

            // Determine role string
            const role = mod.isUndercover ? 'Undercover Mod' : 'Moderator';
            const duration = mod.duration || 'Just now';

            li.innerHTML = `
                <div class="mod-info">
                    <div class="mod-avatar">${initials}</div>
                    <div class="mod-name-wrapper">
                        <span class="mod-name">${mod.name}</span>
                        <span class="mod-role" style="color: ${mod.isUndercover ? '#ffbd2e' : 'var(--accent-secondary)'}">${role}</span>
                    </div>
                </div>
                <div class="mod-duration">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    ${duration}
                </div>
            `;

            modsListEl.appendChild(li);
        });
    }

    function updateModsRelativeTime() {
        const modsTimestampTextEl = document.getElementById('mods-timestamp-text');
        if (!modsTimestampTextEl || !lastModsUpdateDate) return;

        const now = new Date();
        const diffInSeconds = Math.floor((now - lastModsUpdateDate) / 1000);
        let relativeString = '';

        if (diffInSeconds < 60) {
            relativeString = `${diffInSeconds} seconds ago`;
        } else if (diffInSeconds < 3600) {
            const minutes = Math.floor(diffInSeconds / 60);
            relativeString = `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
        } else {
            relativeString = lastModsUpdateDate.toLocaleTimeString();
        }

        modsTimestampTextEl.textContent = relativeString;
    }

    async function fetchHistoryData() {
        try {
            const response = await fetch('/api/history');

            if (response.ok) {
                const result = await response.json();
                if (result.status === 'success' && result.data.length > 0) {
                    // Populate arrays from DB
                    result.data.forEach(row => {
                        const dateObj = new Date(row.created_at);
                        const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        timeLabels.push(timeString);
                        playerData.push(row.player_count);
                    });

                    chartInstance.update();
                }
            }
        } catch (error) {
            console.error('Error fetching history:', error);
        } finally {
            // Fetch live data immediately after history loads
            fetchServerData();
        }
    }

    async function fetchServerData() {
        try {
            statusTextEl.textContent = 'Updating...';

            const response = await fetch('/api/server-data');

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            // Check if backend cache is still initializing
            if (result.status === 'success') {
                updateUI(result.data);
            } else if (result.status === 'error' && result.message === 'Initializing...') {
                // Wait and try again if the server just started and hasn't fetched yet
                setTimeout(fetchServerData, 2000);
            } else {
                throw new Error(result.message || 'Unknown error');
            }

        } catch (error) {
            console.error('Error fetching live data:', error);
            setOfflineState();
        }
    }

    function updateUI(data) {
        // Update Server Status
        statusIndicatorEl.classList.remove('offline');
        statusIndicatorEl.classList.add('online');
        statusTextEl.textContent = data.server || 'Online';

        // Update Timestamp
        lastUpdateDate = new Date(data.timestamp);
        updateRelativeTime();

        // Handle Trend Indicator
        // Use the last stored player count from the chart data if currentPlayers is 0 (like on first load)
        let previousPlayers = currentPlayers;
        if (previousPlayers === 0 && playerData.length > 0) {
            previousPlayers = playerData[playerData.length - 1]; // Get last known value from history
        }

        if (previousPlayers > 0 && previousPlayers !== data.onlinePlayers) {
            updateTrendIndicator(previousPlayers, data.onlinePlayers);
        } else if (previousPlayers === 0 || previousPlayers === data.onlinePlayers) {
            // Hide if no change or no history
            trendIndicatorEl.classList.add('hidden');
        }

        // Ensure starting animation value is accurate (fall back to previous history if 0)
        let startAnimationValue = currentPlayers === 0 ? (playerData.length > 0 ? playerData[playerData.length - 1] : 0) : currentPlayers;

        // Animate Player Count
        animateValue(playerCountEl, startAnimationValue, data.onlinePlayers, 1500);
        currentPlayers = data.onlinePlayers;

        // Update Chart
        updateChartData(lastUpdateDate, data.onlinePlayers);
    }

    function updateRelativeTime() {
        if (!lastUpdateDate) return;

        const now = new Date();
        const diffInSeconds = Math.floor((now - lastUpdateDate) / 1000);

        let relativeString = '';

        if (diffInSeconds < 60) {
            relativeString = `${diffInSeconds} seconds ago`;
        } else if (diffInSeconds < 3600) {
            const minutes = Math.floor(diffInSeconds / 60);
            relativeString = `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
        } else {
            // Fallback to absolute time if it's very old
            relativeString = lastUpdateDate.toLocaleTimeString();
        }

        timestampTextEl.textContent = relativeString;
    }

    function updateTrendIndicator(oldValue, newValue) {
        const diff = newValue - oldValue;
        const percentChange = ((diff / oldValue) * 100).toFixed(2);

        const iconEl = trendIndicatorEl.querySelector('.trend-icon');
        const valueEl = trendIndicatorEl.querySelector('.trend-value');

        trendIndicatorEl.classList.remove('hidden', 'up', 'down', 'neutral');

        if (diff > 0) {
            trendIndicatorEl.classList.add('up');
            iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>';
            valueEl.textContent = `+${percentChange}%`;
        } else if (diff < 0) {
            trendIndicatorEl.classList.add('down');
            iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"></polyline><polyline points="16 17 22 17 22 11"></polyline></svg>';
            valueEl.textContent = `${percentChange}%`; // negative sign is included in diff
        } else {
            trendIndicatorEl.classList.add('neutral');
            iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
            valueEl.textContent = `0.00%`;
        }
    }

    function initChart() {
        const ctx = document.getElementById('playerChart').getContext('2d');

        // Gradient for chart area
        const gradient = ctx.createLinearGradient(0, 0, 0, 150);
        gradient.addColorStop(0, 'rgba(230, 32, 32, 0.4)');
        gradient.addColorStop(1, 'rgba(230, 32, 32, 0.0)');

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: timeLabels,
                datasets: [{
                    label: 'Online Players',
                    data: playerData,
                    borderColor: '#e62020',
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointBackgroundColor: '#e62020',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 1,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: true,
                    tension: 0.4 // Smooth curves
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(26, 10, 10, 0.9)',
                        titleColor: '#ffb3b3',
                        bodyColor: '#fff',
                        borderColor: 'rgba(230, 32, 32, 0.3)',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: false,
                        callbacks: {
                            label: function (context) {
                                return context.parsed.y.toLocaleString() + ' Players';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false, drawBorder: false },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 9 },
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 6
                        }
                    },
                    y: {
                        display: false, // Hide Y axis completely for cleaner look
                        min: function (context) {
                            // Dynamically adjust min slightly below lowest value
                            const values = context.chart.data.datasets[0].data;
                            if (values.length === 0) return 0;
                            const minData = Math.min(...values);
                            return Math.max(0, minData - (minData * 0.05)); // 5% padding bottom
                        },
                        max: function (context) {
                            // Dynamically adjust max slightly above highest value
                            const values = context.chart.data.datasets[0].data;
                            if (values.length === 0) return 100;
                            const maxData = Math.max(...values);
                            return maxData + (maxData * 0.05); // 5% padding top
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    }

    function updateChartData(dateObj, playerCount) {
        // Format time as HH:MM
        const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Prevent duplicate entries for the same update window if we fetch very fast
        if (timeLabels.length > 0 && timeLabels[timeLabels.length - 1] === timeString) {
            // Only update the last value instead of pushing a new one (prevents duplicate time labels if fetched multiple times in same minute)
            playerData[playerData.length - 1] = playerCount;
        } else {
            timeLabels.push(timeString);
            playerData.push(playerCount);
        }

        // Keep only last 25 data points to prevent crowding
        if (timeLabels.length > 25) {
            timeLabels.shift();
            playerData.shift();
        }

        chartInstance.update();
    }

    function setOfflineState() {
        statusIndicatorEl.classList.remove('online');
        statusIndicatorEl.classList.add('offline');
        statusTextEl.textContent = 'API Error / Offline';
        playerCountEl.textContent = 'Error';
        trendIndicatorEl.classList.add('hidden');
    }

    // Smooth number counting animation
    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);

            // Easing function (easeOutExpo)
            const easeOutProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

            const currentVal = Math.floor(easeOutProgress * (end - start) + start);

            // Format number with commas
            obj.innerHTML = currentVal.toLocaleString();

            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                // Formatting ensures exact end value on completion
                obj.innerHTML = end.toLocaleString();

                // Add tiny animation to text
                obj.classList.add('counting');
                setTimeout(() => {
                    obj.classList.remove('counting');
                }, 300);
            }
        };
        window.requestAnimationFrame(step);
    }

    // Toast notification
    function showToast(message) {
        // Remove existing toast if any
        const existingToast = document.querySelector('.toast');
        if (existingToast) {
            existingToast.remove();
        }

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;

        document.body.appendChild(toast);

        // Trigger reflow
        void toast.offsetWidth;

        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 3000);
    }
});
