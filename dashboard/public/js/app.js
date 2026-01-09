/**
 * Midnight Bot Dashboard - Frontend Application
 */

// API Base URL
const API_BASE = '/api';

// DOMPurify configuration for XSS protection
const PURIFY_CONFIG = {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
    ALLOWED_ATTR: ['href', 'title'],
    KEEP_CONTENT: true
};

// Security helper: sanitize HTML content to prevent XSS
function sanitizeHtml(dirty) {
    if (!dirty) return '';
    return DOMPurify.sanitize(dirty, PURIFY_CONFIG);
}

// Security helper: safely escape text content
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Wrapper for fetch that handles authentication errors
window.authenticatedFetch = async function(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (response.status === 401) {
            showToast('Session expired, please login again', 'error');
            showLogin();
            throw new Error('Unauthorized');
        }
        return response;
    } catch (error) {
        throw error;
    }
};

// State
let currentUser = null;
let currentGuildId = null;
let currentSection = 'dashboard';
let activityChart = null;
let moderationChart = null;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const guildIdInput = document.getElementById('guild-id-input');
const navLinks = document.querySelectorAll('.nav-link[data-section]');
const sections = document.querySelectorAll('.content-section');
const logoutBtn = document.getElementById('logout-btn');
const toastContainer = document.getElementById('toast-container');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
});

// Global error handlers so users see failures (instead of silent console errors)
window.addEventListener('error', (event) => {
    try {
        console.error('Dashboard error:', event?.error || event);
        showToast(event?.message || 'Unexpected error', 'error');
    } catch {
        // ignore
    }
});

window.addEventListener('unhandledrejection', (event) => {
    try {
        console.error('Unhandled promise rejection:', event?.reason || event);
        const message = event?.reason?.message || 'Unexpected error';
        showToast(message, 'error');
    } catch {
        // ignore
    }
});

// Event Listeners
function setupEventListeners() {
    // Login form
    loginForm?.addEventListener('submit', handleLogin);
    
    // Logout button
    logoutBtn?.addEventListener('click', handleLogout);
    
    // Guild ID input - handle both change and Enter key
    guildIdInput?.addEventListener('change', (e) => {
        setGuildId(e.target.value);
    });
    guildIdInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            setGuildId(e.target.value);
        }
    });
    
    // Navigation links
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.dataset.section;
            navigateTo(section);
        });
    });
    
    // Settings forms
    document.getElementById('no-roleplay-form')?.addEventListener('submit', handleNoRoleplaySubmit);
    document.getElementById('no-danger-edits-form')?.addEventListener('submit', handleNoDangerEditsSubmit);
    document.getElementById('reply-thread-form')?.addEventListener('submit', handleReplyThreadSubmit);
    document.getElementById('onboarding-form')?.addEventListener('submit', handleOnboardingSubmit);
    document.getElementById('onboarding-category-form')?.addEventListener('submit', handleOnboardingCategorySubmit);
    document.getElementById('onboarding-role-form')?.addEventListener('submit', handleOnboardingRoleSubmit);
    document.getElementById('wow-guild-form')?.addEventListener('submit', handleWowGuildSubmit);
    document.getElementById('wow-guest-form')?.addEventListener('submit', handleWowGuestSubmit);
    document.getElementById('add-user-form')?.addEventListener('submit', handleAddUser);
    
    // Global click delegate
    document.addEventListener('click', handleGlobalClick);
    
    // Global submit delegate
    document.addEventListener('submit', handleGlobalSubmit);
}

function handleGlobalSubmit(e) {
    const target = e.target;
    // Check if form has data-submit-action
    if (!target.dataset.submitAction) return;
    
    // If it does, we handle it and prevent default submission
    const action = target.dataset.submitAction;
    const mode = target.dataset.mode;
    
    switch (action) {
        case 'handleInlineCategorySubmit':
            handleInlineCategorySubmit(e, mode, target.dataset.catId);
            break;
        case 'handleInlineRoleSubmit':
            handleInlineRoleSubmit(e, mode, target.dataset.roleId, target.dataset.categoryId);
            break;
    }
}

function handleGlobalClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    
    // Allow default behavior for some elements if needed, but usually we prevent default for button actions
    if (target.tagName === 'BUTTON' || target.tagName === 'A') {
        // e.preventDefault(); // Sometimes we might need default, e.g. links. Only prevent if it's purely JS action.
    }
    
    const action = target.dataset.action;
    const id = target.dataset.id;
    
    switch (action) {
        case 'createOnboardingCategory':
            createOnboardingCategory();
            break;
        case 'editOnboardingCategory':
            editOnboardingCategory(id);
            break;
        case 'deleteOnboardingCategory':
            deleteOnboardingCategory(id);
            break;
        case 'editOnboardingRole':
            editOnboardingRole(id);
            break;
        case 'deleteOnboardingRole':
            deleteOnboardingRole(id);
            break;
        case 'addRoleToCategory':
            addRoleToCategory(id);
            break;
        case 'loadOnboardingSettings':
            loadOnboardingSettings();
            break;
        case 'deleteUser':
            deleteUser(id);
            break;
    }
}

// Authentication
async function checkAuth() {
    try {
        const response = await fetch(`${API_BASE}/auth/me`);
        if (response.ok) {
            currentUser = await response.json();
            showDashboard();
        } else {
            showLogin();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showLogin();
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const username = formData.get('username');
    const password = formData.get('password');
    
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        if (response.ok) {
            currentUser = await response.json();
            showDashboard();
            showToast('Login successful', 'success');
        } else {
            const error = await safeReadJson(response);
            loginError.textContent = formatApiError(error, 'Login failed');
            loginError.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Login error:', error);
        loginError.textContent = 'Network error. Please try again.';
        loginError.classList.remove('hidden');
    }
}

async function handleLogout() {
    try {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch (error) {
        console.error('Logout error:', error);
    }
    currentUser = null;
    showLogin();
}

// Navigation
function showLogin() {
    loginScreen.classList.remove('hidden');
    dashboardScreen.classList.add('hidden');
}

function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
    
    // Load saved guild ID
    const savedGuildId = localStorage.getItem('guildId');
    if (savedGuildId) {
        guildIdInput.value = savedGuildId;
        setGuildId(savedGuildId);
    }
    
    // Restore last visited section or default to dashboard
    const lastSection = localStorage.getItem('lastSection') || 'dashboard';
    navigateTo(lastSection);
}

function navigateTo(section) {
    currentSection = section;
    localStorage.setItem('lastSection', section);
    
    // Update nav
    navLinks.forEach(link => {
        link.classList.toggle('active', link.dataset.section === section);
    });
    
    // Update sections
    sections.forEach(s => {
        s.classList.toggle('hidden', s.id !== `${section}-section`);
    });
    
    // Load section data
    loadSectionData(section);
}

async function setGuildId(guildId) {
    currentGuildId = guildId;
    localStorage.setItem('guildId', guildId);
    
    // Fetch guild channels and roles
    await fetchGuildData();
    
    // Reload current section data
    if (currentSection) {
        loadSectionData(currentSection);
    }
}

// Section Data Loading
async function loadSectionData(section) {
    if (!currentGuildId && section !== 'dashboard' && section !== 'users') {
        return;
    }
    
    switch (section) {
        case 'dashboard':
            loadDashboardStats();
            break;
        case 'no-roleplay':
            loadNoRoleplaySettings();
            break;
        case 'no-danger-edits':
            loadNoDangerEditsSettings();
            break;
        case 'reply-thread':
            loadReplyThreadSettings();
            break;
        case 'onboarding':
            loadOnboardingSettings();
            break;
        case 'wow-guild':
            loadWowGuildSettings();
            break;
        case 'wow-guest':
            loadWowGuestSettings();
            break;
        case 'activity':
            if (typeof loadActivitySection === 'function') {
                loadActivitySection(currentGuildId);
            }
            break;
        case 'levels':
            if (typeof loadLevelsSection === 'function') {
                loadLevelsSection(currentGuildId);
            }
            break;
        case 'users':
            loadUsers();
            break;
    }
}

// Dashboard Stats and Charts
async function loadDashboardStats() {
    if (!currentGuildId) {
        // Show placeholder data
        renderPlaceholderCharts();
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/stats`);
        if (response.ok) {
            const data = await response.json();
            renderDashboardStats(data);
            renderActivityChart(data.activity || []);
            renderModerationChart(data.moderation || {});
            renderRecentActions(data.recentActions || []);
        } else {
            renderPlaceholderCharts();
        }
    } catch (error) {
        console.error('Failed to load dashboard stats:', error);
        renderPlaceholderCharts();
    }
}

function renderDashboardStats(data) {
    document.getElementById('stat-total-members').textContent = data.totalMembers?.toLocaleString() || '--';
    document.getElementById('stat-joins-today').textContent = data.joinsToday?.toLocaleString() || '--';
    document.getElementById('stat-mod-actions').textContent = data.modActions7d?.toLocaleString() || '--';
    document.getElementById('stat-captcha-kicks').textContent = data.captchaKicks?.toLocaleString() || '--';
}

function renderPlaceholderCharts() {
    // Placeholder activity data
    const labels = [];
    const joins = [];
    const leaves = [];
    const messages = [];
    
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        joins.push(Math.floor(Math.random() * 20) + 5);
        leaves.push(Math.floor(Math.random() * 10) + 2);
        messages.push(Math.floor(Math.random() * 500) + 100);
    }
    
    renderActivityChart({ labels, joins, leaves, messages });
    
    // Placeholder moderation data
    renderModerationChart({
        bans: 5,
        kicks: 12,
        mutes: 28,
        warnings: 45
    });
}

function renderActivityChart(data) {
    const ctx = document.getElementById('activity-chart');
    if (!ctx) return;
    
    // Destroy existing chart
    if (activityChart) {
        activityChart.destroy();
    }
    
    const labels = data.labels || [];
    
    activityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Messages',
                    data: data.messages || [],
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    fill: true,
                    tension: 0.4,
                    yAxisID: 'y1'
                },
                {
                    label: 'Joins',
                    data: data.joins || [],
                    borderColor: '#22c55e',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    yAxisID: 'y'
                },
                {
                    label: 'Leaves',
                    data: data.leaves || [],
                    borderColor: '#ef4444',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#9ca3af',
                        usePointStyle: true,
                        padding: 20
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(75, 85, 99, 0.3)'
                    },
                    ticks: {
                        color: '#9ca3af'
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: {
                        color: 'rgba(75, 85, 99, 0.3)'
                    },
                    ticks: {
                        color: '#9ca3af'
                    },
                    title: {
                        display: true,
                        text: 'Joins / Leaves',
                        color: '#9ca3af'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: '#9ca3af'
                    },
                    title: {
                        display: true,
                        text: 'Messages',
                        color: '#9ca3af'
                    }
                }
            }
        }
    });
}

function renderModerationChart(data) {
    const ctx = document.getElementById('moderation-chart');
    if (!ctx) return;
    
    // Destroy existing chart
    if (moderationChart) {
        moderationChart.destroy();
    }
    
    const total = (data.bans || 0) + (data.kicks || 0) + (data.mutes || 0) + (data.warnings || 0);
    document.getElementById('moderation-total').innerHTML = `
        <div class="text-2xl font-bold text-white">${total}</div>
        <div class="text-xs text-gray-400">Total</div>
    `;
    
    moderationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Bans', 'Kicks', 'Mutes', 'Warnings'],
            datasets: [{
                data: [data.bans || 0, data.kicks || 0, data.mutes || 0, data.warnings || 0],
                backgroundColor: ['#ef4444', '#f97316', '#eab308', '#6366f1'],
                borderColor: '#1f2937',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
    
    // Render legend
    const legendContainer = document.getElementById('moderation-legend');
    if (legendContainer) {
        const colors = { bans: '#ef4444', kicks: '#f97316', mutes: '#eab308', warnings: '#6366f1' };
        legendContainer.innerHTML = `
            <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full" style="background: ${colors.bans}"></span>
                    <span class="text-gray-300">Bans</span>
                </div>
                <span class="font-mono text-gray-400">${data.bans || 0}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full" style="background: ${colors.kicks}"></span>
                    <span class="text-gray-300">Kicks</span>
                </div>
                <span class="font-mono text-gray-400">${data.kicks || 0}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full" style="background: ${colors.mutes}"></span>
                    <span class="text-gray-300">Mutes</span>
                </div>
                <span class="font-mono text-gray-400">${data.mutes || 0}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full" style="background: ${colors.warnings}"></span>
                    <span class="text-gray-300">Warnings</span>
                </div>
                <span class="font-mono text-gray-400">${data.warnings || 0}</span>
            </div>
        `;
    }
}

function renderRecentActions(actions) {
    const container = document.getElementById('recent-actions-table');
    if (!container) return;
    
    if (!actions || actions.length === 0) {
        container.innerHTML = '<tr><td colspan="5" class="text-center text-gray-400 py-4">No recent actions</td></tr>';
        return;
    }
    
    const badgeColors = {
        ban: 'badge-red',
        kick: 'badge-yellow',
        mute: 'badge-yellow',
        warn: 'badge-blue'
    };
    
    container.innerHTML = actions.slice(0, 10).map(action => `
        <tr>
            <td class="font-mono text-xs text-gray-400">${new Date(action.timestamp).toLocaleString()}</td>
            <td><span class="badge ${badgeColors[action.type] || 'badge-blue'}">${action.type}</span></td>
            <td class="font-mono">${action.user || 'Unknown'}</td>
            <td class="font-mono">${action.moderator || 'System'}</td>
            <td class="text-gray-400 truncate" style="max-width: 200px;">${action.reason || '-'}</td>
        </tr>
    `).join('');
}

// No Roleplay Settings
async function loadNoRoleplaySettings() {
    if (!currentGuildId) return;
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/automod/no-roleplay`);
        if (response.ok) {
            const data = await response.json();
            populateNoRoleplayForm(data.settings || data);
        }
    } catch (error) {
        console.error('Failed to load no-roleplay settings:', error);
    }
}

function populateNoRoleplayForm(data) {
    document.getElementById('no-roleplay-enabled').checked = data.enabled ?? true;
    document.getElementById('no-roleplay-romantic-keywords').value = data.romantic_keywords || 'cuddle|hug|kiss|nuzzle|wiggle|snuggle|purr|lick|blush';
    
    // Populate array fields - parse JSON strings if needed
    const whitelisted = parseArrayField(data.whitelisted_channels);
    const ignored = parseArrayField(data.ignored_roles);
    setArrayInputValues('no-roleplay-whitelisted-channels', whitelisted);
    setArrayInputValues('no-roleplay-ignored-roles', ignored);
}

function parseArrayField(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function handleNoRoleplaySubmit(e) {
    e.preventDefault();
    if (!currentGuildId) {
        showToast('Please set a Guild ID first', 'error');
        return;
    }
    
    const data = {
        enabled: document.getElementById('no-roleplay-enabled').checked,
        romantic_keywords: document.getElementById('no-roleplay-romantic-keywords').value || 'cuddle|hug|kiss|nuzzle|wiggle|snuggle|purr|lick|blush',
        whitelisted_channels: getArrayInputValues('no-roleplay-whitelisted-channels'),
        ignored_roles: getArrayInputValues('no-roleplay-ignored-roles')
    };
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/automod/no-roleplay`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showToast('Settings saved successfully', 'success');
        } else {
            const error = await safeReadJson(response);
            showToast(formatApiError(error, 'Failed to save settings'), 'error');
        }
    } catch (error) {
        console.error('Save error:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

// No Danger Edits Settings
async function loadNoDangerEditsSettings() {
    if (!currentGuildId) return;
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/automod/no-danger-edits`);
        if (response.ok) {
            const data = await response.json();
            populateNoDangerEditsForm(data.settings || data);
        } else {
            const error = await safeReadJson(response);
            showToast(error?.error || 'Failed to load settings', 'error');
        }
    } catch (error) {
        console.error('Failed to load no-danger-edits settings:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

function populateNoDangerEditsForm(data) {
    document.getElementById('danger-edits-enabled').checked = data.enabled ?? true;
    document.getElementById('danger-edits-delete-message').checked = data.delete_message ?? true;
    document.getElementById('danger-edits-mute-user').checked = data.mute_user ?? true;
    document.getElementById('danger-edits-mute-duration').value = data.mute_duration_minutes || 60;
    document.getElementById('danger-edits-log-channel').value = data.log_channel_id || '';
    document.getElementById('danger-edits-ping-role').value = data.ping_role_id || '';
    document.getElementById('danger-edits-forbidden-regex').value = data.forbidden_words_regex || '';
    
    const ignoredChannels = parseArrayField(data.ignored_channels);
    const ignoredRoles = parseArrayField(data.ignored_roles);
    setArrayInputValues('danger-edits-ignored-channels', ignoredChannels);
    setArrayInputValues('danger-edits-ignored-roles', ignoredRoles);
}

async function handleNoDangerEditsSubmit(e) {
    e.preventDefault();
    if (!currentGuildId) {
        showToast('Please set a Guild ID first', 'error');
        return;
    }
    
    const data = {
        enabled: document.getElementById('danger-edits-enabled').checked,
        delete_message: document.getElementById('danger-edits-delete-message').checked,
        mute_user: document.getElementById('danger-edits-mute-user').checked,
        mute_duration_minutes: parseInt(document.getElementById('danger-edits-mute-duration').value) || 60,
        log_channel_id: document.getElementById('danger-edits-log-channel').value || null,
        ping_role_id: document.getElementById('danger-edits-ping-role').value || null,
        forbidden_words_regex: document.getElementById('danger-edits-forbidden-regex').value || null,
        ignored_channels: getArrayInputValues('danger-edits-ignored-channels'),
        ignored_roles: getArrayInputValues('danger-edits-ignored-roles')
    };
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/automod/no-danger-edits`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showToast('Settings saved successfully', 'success');
        } else {
            const error = await safeReadJson(response);
            showToast(formatApiError(error, 'Failed to save settings'), 'error');
        }
    } catch (error) {
        console.error('Save error:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

// Reply Thread Settings
async function loadReplyThreadSettings() {
    if (!currentGuildId) return;
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/reply-thread`);
        if (response.ok) {
            const data = await response.json();
            populateReplyThreadForm(data.settings || data);
        } else {
            const error = await safeReadJson(response);
            showToast(error?.error || 'Failed to load settings', 'error');
        }
    } catch (error) {
        console.error('Failed to load reply-thread settings:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

function populateReplyThreadForm(data) {
    document.getElementById('reply-thread-enabled').checked = data.enabled ?? true;
    document.getElementById('reply-thread-introduction-channel').value = data.introduction_channel_id || '';
    document.getElementById('reply-thread-debug-channel').value = data.debug_channel_id || '';
    document.getElementById('reply-thread-dating-regex').value = data.dating_phrases_regex || '';
    document.getElementById('reply-thread-warning-message').value = data.dating_warning_message || '';
    
    setArrayInputValues('reply-thread-channels', data.thread_channels || []);
}

async function handleReplyThreadSubmit(e) {
    e.preventDefault();
    if (!currentGuildId) {
        showToast('Please set a Guild ID first', 'error');
        return;
    }
    
    const data = {
        enabled: document.getElementById('reply-thread-enabled').checked,
        introduction_channel_id: document.getElementById('reply-thread-introduction-channel').value || null,
        debug_channel_id: document.getElementById('reply-thread-debug-channel').value || null,
        dating_phrases_regex: document.getElementById('reply-thread-dating-regex').value || null,
        dating_warning_message: document.getElementById('reply-thread-warning-message').value || null,
        thread_channels: getArrayInputValues('reply-thread-channels')
    };
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/reply-thread`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showToast('Settings saved successfully', 'success');
        } else {
            const error = await safeReadJson(response);
            showToast(formatApiError(error, 'Failed to save settings'), 'error');
        }
    } catch (error) {
        console.error('Save error:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

// Onboarding Settings
async function loadOnboardingSettings() {
    if (!currentGuildId) return;
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/onboarding`);
        if (response.ok) {
            const data = await response.json();
            populateOnboardingForm(data.data || data);
        } else {
            const error = await safeReadJson(response);
            showToast(error?.error || 'Failed to load settings', 'error');
        }
    } catch (error) {
        console.error('Failed to load onboarding settings:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

function populateOnboardingForm(data) {
    document.getElementById('onboarding-enabled').checked = data.settings?.enabled ?? true;
    document.getElementById('onboarding-gate-role').value = data.settings?.gate_role_id || '';
    document.getElementById('onboarding-log-channel').value = data.settings?.log_channel_id || '';
    document.getElementById('onboarding-welcome-channel').value = data.settings?.welcome_channel_id || '';
    
    // Render categories and roles
    renderOnboardingRoles(data.roles || [], data.categories || []);
}





function getRoleName(roleId) {
    const role = guildRoles.find(r => r.id === roleId);
    return role ? role.name : roleId;
}

function renderOnboardingRoles(roles, categories = []) {
    const container = document.getElementById('onboarding-roles-container');
    if (!container) return;
    
    // Clear container
    container.innerHTML = '';

    // Sort categories by sort_order
    const sortedCategories = [...categories].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    if (sortedCategories.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-gray-500">
                <p class="mb-4">No categories configured.</p>
                <button class="btn btn-primary" data-action="createOnboardingCategory">Create First Category</button>
            </div>
        `;
        return;
    }

    sortedCategories.forEach(cat => {
        const catRoles = roles.filter(r => r.category_id === cat.id)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        const categoryEl = document.createElement('div');
        categoryEl.className = 'role-menu-category';
        categoryEl.id = `category-${cat.id}`;
        categoryEl.innerHTML = `
            <div class="role-menu-header">
                <div class="flex-1">
                    <div class="role-menu-title">
                        ${cat.emoji ? `<span>${cat.emoji}</span>` : ''}
                        <span>${cat.name}</span>
                    </div>
                    ${cat.description ? `<div class="role-menu-description">${cat.description}</div>` : ''}
                </div>
                <div class="flex items-center gap-4">
                    <div class="text-xs text-gray-400 font-mono bg-gray-800 px-2 py-1 rounded">
                        ${cat.selection_type || 'REQUIRED_ONE'}
                    </div>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-secondary" data-action="editOnboardingCategory" data-id="${cat.id}">Edit</button>
                        <button class="btn btn-sm btn-danger" data-action="deleteOnboardingCategory" data-id="${cat.id}">Delete</button>
                    </div>
                </div>
            </div>
            <div class="role-menu-grid" id="category-roles-${cat.id}">
                ${catRoles.map(role => `
                    <div class="role-card" id="role-${role.id}">
                        <div class="role-card-emoji">
                            ${role.emoji || '❓'}
                        </div>
                        <div class="role-card-content">
                            <div class="role-card-name" title="${role.name || getRoleName(role.role_id)}">${role.name || getRoleName(role.role_id)}</div>
                            <div class="role-card-id text-xs text-gray-500">${getRoleName(role.role_id)}</div>
                        </div>
                        <div class="role-card-actions">
                            <button class="btn btn-secondary btn-sm" data-action="editOnboardingRole" data-id="${role.id}">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                                </svg>
                            </button>
                            <button class="btn btn-danger btn-sm" data-action="deleteOnboardingRole" data-id="${role.id}">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                `).join('')}
                
                <button class="role-card role-card-add" data-action="addRoleToCategory" data-id="${cat.id}">
                    <div class="flex flex-col items-center justify-center w-full h-full text-gray-500 hover:text-white">
                        <svg class="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                        </svg>
                        <span class="text-sm font-medium">Add Role</span>
                    </div>
                </button>
            </div>
        `;
        container.appendChild(categoryEl);
    });
}

window.createOnboardingCategory = function() {
    console.log('createOnboardingCategory called');
    const container = document.getElementById('onboarding-roles-container');
    if (!container) {
        console.error('Container not found');
        return;
    }

    // Check if already creating
    if (container.querySelector('.role-menu-category.editing.new-category')) {
        return;
    }

    const formHtml = `
        <div class="role-menu-category editing new-category">
            <form data-submit-action="handleInlineCategorySubmit" data-mode="create">
                <div class="role-menu-header flex-col items-start gap-4">
                    <div class="w-full grid grid-cols-2 gap-4">
                        <div class="form-group">
                            <label class="form-label">Name</label>
                            <input type="text" name="name" class="form-input" placeholder="Category Name" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Emoji</label>
                            <input type="text" name="emoji" class="form-input" placeholder="Emoji">
                        </div>
                    </div>
                    <div class="w-full">
                        <label class="form-label">Description</label>
                        <input type="text" name="description" class="form-input" placeholder="Description">
                    </div>
                    <div class="w-full grid grid-cols-2 gap-4">
                        <div class="form-group">
                            <label class="form-label">Selection Type</label>
                            <select name="selection_type" class="form-input">
                                <option value="REQUIRED_ONE">REQUIRED_ONE</option>
                                <option value="ONLY_ONE">ONLY_ONE</option>
                                <option value="MULTIPLE">MULTIPLE</option>
                                <option value="NONE_OR_ONE">NONE_OR_ONE</option>
                                <option value="NONE_OR_MULTIPLE">NONE_OR_MULTIPLE</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Sort Order</label>
                            <input type="number" name="sort_order" class="form-input" value="0">
                        </div>
                    </div>
                    <div class="flex justify-end gap-2 w-full mt-2">
                        <button type="button" class="btn btn-secondary" data-action="loadOnboardingSettings">Cancel</button>
                        <button type="submit" class="btn btn-primary">Create Category</button>
                    </div>
                </div>
            </form>
        </div>
    `;
    
    // Insert at the top
    container.insertAdjacentHTML('afterbegin', formHtml);
};

window.editOnboardingCategory = function(catId) {
    console.log('editOnboardingCategory called', catId);
    if (!currentGuildId) {
        showToast('Guild ID missing', 'error');
        return;
    }

    fetch(`${API_BASE}/guilds/${currentGuildId}/onboarding`)
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch settings');
            return res.json();
        })
        .then(data => {
            const categories = data.categories || data.data?.categories || [];
            const category = categories.find(c => c.id == catId);
            
            if (!category) {
                showToast('Category not found', 'error');
                return;
            }

            const catEl = document.getElementById(`category-${catId}`);
            if (!catEl) {
                console.error(`Element category-${catId} not found`);
                return;
            }

            catEl.innerHTML = `
                <form data-submit-action="handleInlineCategorySubmit" data-mode="update" data-cat-id="${catId}">
                    <div class="role-menu-header flex-col items-start gap-4 bg-gray-800 p-4 rounded">
                        <div class="w-full grid grid-cols-2 gap-4">
                            <div class="form-group">
                                <label class="form-label">Name</label>
                                <input type="text" name="name" class="form-input" value="${category.name}" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Emoji</label>
                                <input type="text" name="emoji" class="form-input" value="${category.emoji || ''}">
                            </div>
                        </div>
                        <div class="w-full">
                            <label class="form-label">Description</label>
                            <input type="text" name="description" class="form-input" value="${category.description || ''}">
                        </div>
                        <div class="w-full grid grid-cols-2 gap-4">
                            <div class="form-group">
                                <label class="form-label">Selection Type</label>
                                <select name="selection_type" class="form-input">
                                    <option value="REQUIRED_ONE" ${category.selection_type === 'REQUIRED_ONE' ? 'selected' : ''}>REQUIRED_ONE</option>
                                    <option value="ONLY_ONE" ${category.selection_type === 'ONLY_ONE' ? 'selected' : ''}>ONLY_ONE</option>
                                    <option value="MULTIPLE" ${category.selection_type === 'MULTIPLE' ? 'selected' : ''}>MULTIPLE</option>
                                    <option value="NONE_OR_ONE" ${category.selection_type === 'NONE_OR_ONE' ? 'selected' : ''}>NONE_OR_ONE</option>
                                    <option value="NONE_OR_MULTIPLE" ${category.selection_type === 'NONE_OR_MULTIPLE' ? 'selected' : ''}>NONE_OR_MULTIPLE</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Sort Order</label>
                                <input type="number" name="sort_order" class="form-input" value="${category.sort_order || 0}">
                            </div>
                        </div>
                        <div class="flex justify-end gap-2 w-full mt-2">
                            <button type="button" class="btn btn-secondary" data-action="loadOnboardingSettings">Cancel</button>
                            <button type="submit" class="btn btn-primary">Save Changes</button>
                        </div>
                    </div>
                </form>
            `;
        })
        .catch(err => {
            console.error('Error editing category:', err);
            showToast('Failed to load category details', 'error');
        });
};

window.handleInlineCategorySubmit = async function(e, mode, catId) {
    e.preventDefault();
    console.log('handleInlineCategorySubmit', mode, catId);
    
    const formData = new FormData(e.target);
    const payload = {
        name: formData.get('name'),
        description: formData.get('description'),
        emoji: formData.get('emoji'),
        selection_type: formData.get('selection_type'),
        sort_order: Number(formData.get('sort_order'))
    };

    try {
        let url = `${API_BASE}/guilds/${currentGuildId}/onboarding/categories`;
        let method = 'POST';
        
        if (mode === 'update') {
            url += `/${catId}`;
            method = 'PUT';
        }

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            showToast(`Category ${mode === 'create' ? 'created' : 'updated'}`, 'success');
            loadOnboardingSettings();
        } else {
            const error = await safeReadJson(response);
            showToast(formatApiError(error, 'Failed to save category'), 'error');
        }
    } catch (error) {
        console.error('Category save error:', error);
        showToast('Network error', 'error');
    }
};

window.addRoleToCategory = function(catId) {
    console.log('addRoleToCategory called', catId);
    const container = document.getElementById(`category-roles-${catId}`);
    if (!container) {
        console.error(`Container category-roles-${catId} not found`);
        return;
    }
    const addBtn = container.querySelector('.role-card-add');
    if (!addBtn) {
        console.error('Add button not found');
        return;
    }
    
    const formHtml = `
        <div class="role-card editing col-span-full">
            <form data-submit-action="handleInlineRoleSubmit" data-mode="create" data-category-id="${catId}" class="w-full p-4">
                <h4 class="text-sm font-bold text-gray-400 uppercase mb-4">Add New Role</h4>
                <div class="grid grid-cols-2 gap-4">
                    <div class="form-group">
                        <label class="form-label">Role</label>
                        <input type="text" name="roleId" class="form-input" list="role-list" placeholder="Search Role..." required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Display Name</label>
                        <input type="text" name="name" class="form-input" placeholder="Display Name">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Emoji</label>
                        <input type="text" name="emoji" class="form-input" placeholder="Emoji">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Key</label>
                        <input type="text" name="key" class="form-input" placeholder="Internal Key" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Sort Order</label>
                        <input type="number" name="sort_order" class="form-input" value="0">
                    </div>
                </div>
                <div class="flex justify-end gap-2 mt-4">
                    <button type="button" class="btn btn-secondary btn-sm" data-action="loadOnboardingSettings">Cancel</button>
                    <button type="submit" class="btn btn-primary btn-sm">Add Role</button>
                </div>
            </form>
        </div>
    `;
    
    addBtn.insertAdjacentHTML('beforebegin', formHtml);
    addBtn.style.display = 'none';
};

window.editOnboardingRole = function(roleId) {
    console.log('editOnboardingRole called', roleId);
    if (!currentGuildId) {
        showToast('Guild ID missing', 'error');
        return;
    }

    fetch(`${API_BASE}/guilds/${currentGuildId}/onboarding`)
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch settings');
            return res.json();
        })
        .then(data => {
            const roles = data.roles || data.data?.roles || [];
            const role = roles.find(r => r.id == roleId);
            
            if (!role) {
                showToast('Role not found', 'error');
                return;
            }

            const roleEl = document.getElementById(`role-${roleId}`);
            if (!roleEl) {
                console.error(`Element role-${roleId} not found`);
                return;
            }

            roleEl.className = 'role-card editing col-span-full';
            roleEl.innerHTML = `
                <form data-submit-action="handleInlineRoleSubmit" data-mode="update" data-role-id="${roleId}" data-category-id="${role.category_id}" class="w-full p-4">
                    <h4 class="text-sm font-bold text-gray-400 uppercase mb-4">Edit Role Option</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="form-group">
                            <label class="form-label">Role</label>
                            <input type="text" name="roleId" class="form-input" list="role-list" value="${role.role_id}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Display Name</label>
                            <input type="text" name="name" class="form-input" value="${role.name || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Emoji</label>
                            <input type="text" name="emoji" class="form-input" value="${role.emoji || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Key</label>
                            <input type="text" name="key" class="form-input" value="${role.key || ''}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Sort Order</label>
                            <input type="number" name="sort_order" class="form-input" value="${role.sort_order || 0}">
                        </div>
                    </div>
                    <div class="flex justify-end gap-2 mt-4">
                        <button type="button" class="btn btn-secondary btn-sm" data-action="loadOnboardingSettings">Cancel</button>
                        <button type="submit" class="btn btn-primary btn-sm">Save Changes</button>
                    </div>
                </form>
            `;
        })
        .catch(err => {
            console.error('Error editing role:', err);
            showToast('Failed to load role details', 'error');
        });
};

window.handleInlineRoleSubmit = async function(e, mode, roleId, categoryId) {
    e.preventDefault();
    console.log('handleInlineRoleSubmit', mode, roleId, categoryId);
    
    const formData = new FormData(e.target);
    const payload = {
        categoryId: Number(categoryId),
        roleId: formData.get('roleId'),
        name: formData.get('name'),
        emoji: formData.get('emoji'),
        key: formData.get('key'),
        sortOrder: Number(formData.get('sort_order'))
    };

    try {
        let url = `${API_BASE}/guilds/${currentGuildId}/onboarding/roles`;
        let method = 'POST';
        
        if (mode === 'update') {
            url += `/${roleId}`;
            method = 'PUT';
        }

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            showToast(`Role ${mode === 'create' ? 'added' : 'updated'}`, 'success');
            loadOnboardingSettings();
        } else {
            const error = await safeReadJson(response);
            showToast(formatApiError(error, 'Failed to save role'), 'error');
        }
    } catch (error) {
        console.error('Role save error:', error);
        showToast('Network error', 'error');
    }
};





async function handleOnboardingSubmit(e) {
    e.preventDefault();
    if (!currentGuildId) {
        showToast('Please set a Guild ID first', 'error');
        return;
    }
    
    const data = {
        settings: {
            enabled: document.getElementById('onboarding-enabled').checked,
            gate_role_id: document.getElementById('onboarding-gate-role').value || null,
            log_channel_id: document.getElementById('onboarding-log-channel').value || null,
            welcome_channel_id: document.getElementById('onboarding-welcome-channel').value || null
        }
    };
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/onboarding`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showToast('Settings saved successfully', 'success');
        } else {
            const error = await safeReadJson(response);
            showToast(formatApiError(error, 'Failed to save settings'), 'error');
        }
    } catch (error) {
        console.error('Save error:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

// WoW Guild Settings
async function loadWowGuildSettings() {
    if (!currentGuildId) return;
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/wow-guild`);
        if (response.ok) {
            const data = await response.json();
            populateWowGuildForm(data.settings || data);
        } else {
            const error = await safeReadJson(response);
            showToast(error?.error || 'Failed to load settings', 'error');
        }
    } catch (error) {
        console.error('Failed to load wow-guild settings:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

function populateWowGuildForm(data) {
    document.getElementById('wow-guild-enabled').checked = data.enabled ?? true;
    document.getElementById('wow-guild-onboarding-code').value = data.onboarding_code || '';
    document.getElementById('wow-guild-gate-role').value = data.gate_role_id || '';
    document.getElementById('wow-guild-member-role').value = data.wow_member_role_id || '';
    document.getElementById('wow-guild-onboarding-channel').value = data.onboarding_channel_id || '';
    document.getElementById('wow-guild-welcome-channel').value = data.welcome_channel_id || '';
    document.getElementById('wow-guild-log-channel').value = data.log_channel_id || '';
    document.getElementById('wow-guild-intro-channel').value = data.introduction_channel_id || '';
    document.getElementById('wow-guild-welcome-message').value = data.welcome_message || '';
    document.getElementById('wow-guild-code-prompt').value = data.code_prompt_message || '';
    document.getElementById('wow-guild-invalid-code').value = data.invalid_code_message || '';
}

async function handleWowGuildSubmit(e) {
    e.preventDefault();
    if (!currentGuildId) {
        showToast('Please set a Guild ID first', 'error');
        return;
    }
    
    const data = {
        enabled: document.getElementById('wow-guild-enabled').checked,
        onboarding_code: document.getElementById('wow-guild-onboarding-code').value || null,
        gate_role_id: document.getElementById('wow-guild-gate-role').value || null,
        wow_member_role_id: document.getElementById('wow-guild-member-role').value || null,
        onboarding_channel_id: document.getElementById('wow-guild-onboarding-channel').value || null,
        welcome_channel_id: document.getElementById('wow-guild-welcome-channel').value || null,
        log_channel_id: document.getElementById('wow-guild-log-channel').value || null,
        introduction_channel_id: document.getElementById('wow-guild-intro-channel').value || null,
        welcome_message: document.getElementById('wow-guild-welcome-message').value || null,
        code_prompt_message: document.getElementById('wow-guild-code-prompt').value || null,
        invalid_code_message: document.getElementById('wow-guild-invalid-code').value || null
    };
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/wow-guild`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showToast('Settings saved successfully', 'success');
        } else {
            const error = await safeReadJson(response);
            showToast(formatApiError(error, 'Failed to save settings'), 'error');
        }
    } catch (error) {
        console.error('Save error:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

// WoW Guest Settings
async function loadWowGuestSettings() {
    if (!currentGuildId) return;
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/wow-guest`);
        if (response.ok) {
            const data = await response.json();
            populateWowGuestForm(data.settings || data);
        } else {
            const error = await safeReadJson(response);
            showToast(error?.error || 'Failed to load settings', 'error');
        }
    } catch (error) {
        console.error('Failed to load wow-guest settings:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

async function safeReadJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function formatApiError(payload, fallbackMessage) {
    const message = payload?.error || fallbackMessage;
    const requestId = payload?.requestId;
    return requestId ? `${message} (id: ${requestId})` : message;
}

function populateWowGuestForm(data) {
    document.getElementById('wow-guest-enabled').checked = data.enabled ?? true;
    document.getElementById('wow-guest-gate-role').value = data.gate_role_id || '';
    document.getElementById('wow-guest-guest-role').value = data.guest_role_id || '';
    document.getElementById('wow-guest-onboarding-channel').value = data.onboarding_channel_id || '';
    document.getElementById('wow-guest-welcome-channel').value = data.welcome_channel_id || '';
    document.getElementById('wow-guest-log-channel').value = data.log_channel_id || '';
    document.getElementById('wow-guest-intro-channel').value = data.introduction_channel_id || '';
    document.getElementById('wow-guest-welcome-message').value = data.welcome_message || '';
    document.getElementById('wow-guest-button-label').value = data.button_label || '';
}

async function handleWowGuestSubmit(e) {
    e.preventDefault();
    if (!currentGuildId) {
        showToast('Please set a Guild ID first', 'error');
        return;
    }
    
    const data = {
        enabled: document.getElementById('wow-guest-enabled').checked,
        gate_role_id: document.getElementById('wow-guest-gate-role').value || null,
        guest_role_id: document.getElementById('wow-guest-guest-role').value || null,
        onboarding_channel_id: document.getElementById('wow-guest-onboarding-channel').value || null,
        welcome_channel_id: document.getElementById('wow-guest-welcome-channel').value || null,
        log_channel_id: document.getElementById('wow-guest-log-channel').value || null,
        introduction_channel_id: document.getElementById('wow-guest-intro-channel').value || null,
        welcome_message: document.getElementById('wow-guest-welcome-message').value || null,
        button_label: document.getElementById('wow-guest-button-label').value || null
    };
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/wow-guest`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showToast('Settings saved successfully', 'success');
        } else {
            const error = await safeReadJson(response);
            showToast(formatApiError(error, 'Failed to save settings'), 'error');
        }
    } catch (error) {
        console.error('Save error:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

// Users Management
async function loadUsers() {
    if (currentUser?.role !== 'admin') {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/users`);
        if (response.ok) {
            const users = await response.json();
            renderUsersTable(users);
        }
    } catch (error) {
        console.error('Failed to load users:', error);
    }
}

function renderUsersTable(users) {
    const container = document.getElementById('users-table');
    if (!container) return;
    
    if (users.length === 0) {
        container.innerHTML = '<tr><td colspan="4" class="text-center text-gray-400 py-4">No users</td></tr>';
        return;
    }
    
    container.innerHTML = users.map(user => `
        <tr>
            <td>${user.username}</td>
            <td>
                <span class="badge ${user.role === 'admin' ? 'badge-red' : 'badge-blue'}">${user.role}</span>
            </td>
            <td>${new Date(user.created_at).toLocaleDateString()}</td>
            <td>
                ${user.username !== currentUser?.username ? `
                    <button class="btn btn-danger btn-sm" data-action="deleteUser" data-id="${user.id}">
                        Delete
                    </button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

async function handleAddUser(e) {
    e.preventDefault();
    
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;
    
    try {
        const response = await fetch(`${API_BASE}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        
        if (response.ok) {
            showToast('User created successfully', 'success');
            document.getElementById('add-user-form').reset();
            loadUsers();
        } else {
            const error = await safeReadJson(response);
            showToast(formatApiError(error, 'Failed to create user'), 'error');
        }
    } catch (error) {
        console.error('Create user error:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/users/${userId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('User deleted successfully', 'success');
            loadUsers();
        } else {
            const error = await safeReadJson(response);
            showToast(formatApiError(error, 'Failed to delete user'), 'error');
        }
    } catch (error) {
        console.error('Delete user error:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

// Array Input Helpers
function setArrayInputValues(containerId, values) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Clear existing tags
    container.querySelectorAll('.array-tag').forEach(tag => tag.remove());
    
    // Add new tags
    const input = container.querySelector('.array-input-field');
    values.forEach(value => {
        addArrayTag(container, value, input);
    });
}

function getArrayInputValues(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    
    const tags = container.querySelectorAll('.array-tag');
    return Array.from(tags).map(tag => tag.dataset.value);
}

function addArrayTag(container, value, inputField) {
    const tag = document.createElement('span');
    tag.className = 'array-tag';
    tag.dataset.value = value;
    
    const textNode = document.createTextNode(value + ' ');
    tag.appendChild(textNode);
    
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tag.remove();
    });
    
    tag.appendChild(removeBtn);
    container.insertBefore(tag, inputField);
}

// Initialize array inputs
document.querySelectorAll('.array-input').forEach(container => {
    const input = container.querySelector('.array-input-field');
    if (!input) return;
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const value = input.value.trim();
            if (value) {
                addArrayTag(container, value, input);
                input.value = '';
            }
        }
    });
    
    input.addEventListener('blur', () => {
        const value = input.value.trim();
        if (value) {
            addArrayTag(container, value, input);
            input.value = '';
        }
    });
});

// Toast Notifications
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Global functions for inline handlers
window.deleteUser = deleteUser;
window.deleteOnboardingCategory = async function(categoryId) {
    if (!confirm('Are you sure you want to delete this category?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/onboarding/categories/${categoryId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Category deleted', 'success');
            loadOnboardingSettings();
        } else {
            showToast('Failed to delete category', 'error');
        }
    } catch (error) {
        showToast('Network error', 'error');
    }
};

window.deleteOnboardingRole = async function(roleId) {
    if (!confirm('Are you sure you want to delete this role?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/guilds/${currentGuildId}/onboarding/roles/${roleId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Role deleted', 'success');
            loadOnboardingSettings();
        } else {
            showToast('Failed to delete role', 'error');
        }
    } catch (error) {
        showToast('Network error', 'error');
    }
};

// Discord Data Fetching & Selectors
let guildChannels = [];
let guildRoles = [];

async function fetchGuildData() {
    if (!currentGuildId) return;
    try {
        const [channelsRes, rolesRes] = await Promise.all([
            fetch(`${API_BASE}/discord/guild/${currentGuildId}/channels`),
            fetch(`${API_BASE}/discord/guild/${currentGuildId}/roles`)
        ]);

        if (channelsRes.ok) guildChannels = await channelsRes.json();
        if (rolesRes.ok) guildRoles = await rolesRes.json();
        
        updateSelectors();
    } catch (e) {
        console.error('Failed to fetch guild data', e);
    }
}

function updateSelectors() {
    // Create or update datalists
    let channelList = document.getElementById('channel-list');
    if (!channelList) {
        channelList = document.createElement('datalist');
        channelList.id = 'channel-list';
        document.body.appendChild(channelList);
    }
    
    // Sort channels: Text first, then Voice, then others. Alphabetical within type.
    const sortedChannels = [...guildChannels].sort((a, b) => {
        if (a.type !== b.type) return a.type - b.type;
        return a.name.localeCompare(b.name);
    });

    channelList.innerHTML = sortedChannels.map(c => 
        `<option value="${c.id}">${c.name} (${getChannelTypeName(c.type)})</option>`
    ).join('');

    let roleList = document.getElementById('role-list');
    if (!roleList) {
        roleList = document.createElement('datalist');
        roleList.id = 'role-list';
        document.body.appendChild(roleList);
    }
    
    // Sort roles by position (descending)
    const sortedRoles = [...guildRoles].sort((a, b) => b.position - a.position);

    roleList.innerHTML = sortedRoles.map(r => 
        `<option value="${r.id}">${r.name}</option>`
    ).join('');

    // Attach datalists to inputs
    attachDatalists();
}

function getChannelTypeName(type) {
    switch(type) {
        case 0: return 'Text';
        case 2: return 'Voice';
        case 4: return 'Category';
        case 5: return 'Announcement';
        case 13: return 'Stage';
        case 15: return 'Forum';
        default: return 'Unknown';
    }
}

function attachDatalists() {
    // Map of input IDs to list IDs
    const inputMap = {
        'no-roleplay-whitelisted-channels': 'channel-list',
        'no-roleplay-ignored-roles': 'role-list',
        'danger-edits-log-channel': 'channel-list',
        'danger-edits-ping-role': 'role-list',
        'danger-edits-ignored-channels': 'channel-list',
        'danger-edits-ignored-roles': 'role-list',
        'reply-thread-introduction-channel': 'channel-list',
        'reply-thread-debug-channel': 'channel-list',
        'reply-thread-channels': 'channel-list',
        'onboarding-gate-role': 'role-list',
        'onboarding-log-channel': 'channel-list',
        'onboarding-welcome-channel': 'channel-list',
        'onboarding-role-id': 'role-list',
        'wow-guild-gate-role': 'role-list',
        'wow-guild-member-role': 'role-list',
        'wow-guild-onboarding-channel': 'channel-list',
        'wow-guild-welcome-channel': 'channel-list',
        'wow-guild-log-channel': 'channel-list',
        'wow-guild-intro-channel': 'channel-list',
        'wow-guest-gate-role': 'role-list',
        'wow-guest-guest-role': 'role-list',
        'wow-guest-onboarding-channel': 'channel-list',
        'wow-guest-welcome-channel': 'channel-list',
        'wow-guest-log-channel': 'channel-list',
        'wow-guest-intro-channel': 'channel-list'
    };

    for (const [inputId, listId] of Object.entries(inputMap)) {
        const element = document.getElementById(inputId);
        if (element) {
            if (element.classList.contains('array-input')) {
                const input = element.querySelector('.array-input-field');
                if (input) input.setAttribute('list', listId);
            } else {
                element.setAttribute('list', listId);
            }
        }
    }
}
