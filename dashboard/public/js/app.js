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

function looksLikeSnowflake(text) {
    return /^[0-9]{16,20}$/.test(String(text || '').trim());
}

function formatChannelDisplayName(channel) {
    if (!channel?.name) return '';
    return `#${channel.name}`;
}

function resolveChannelNameById(channelId) {
    const id = String(channelId || '').trim();
    if (!id) return '';
    const found = guildChannels.find(c => String(c.id) === id);
    return found ? formatChannelDisplayName(found) : id;
}

function resolveChannelIdFromUserInput(inputText) {
    const raw = String(inputText || '').trim();
    if (!raw) return '';

    // Accept <#123> mentions
    const mentionMatch = raw.match(/^<#[\s]*([0-9]{16,20})[\s]*>$/);
    if (mentionMatch) return mentionMatch[1];

    // Accept raw snowflake
    if (looksLikeSnowflake(raw)) return raw;

    // Accept #channel-name (best effort)
    const maybeName = raw.startsWith('#') ? raw.slice(1).trim() : raw;
    if (!maybeName) return '';

    const matches = guildChannels.filter(c => String(c.name || '').toLowerCase() === maybeName.toLowerCase());
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
        showToast(`Multiple channels named "${maybeName}". Paste the channel ID to disambiguate.`, 'error');
        return '';
    }

    return '';
}

function attachPrettyChannelDropdown(inputEl, { onPick } = {}) {
    if (!inputEl || inputEl.dataset.prettyDropdownAttached === '1') return;
    inputEl.dataset.prettyDropdownAttached = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'pretty-select';
    inputEl.parentNode.insertBefore(wrapper, inputEl);
    wrapper.appendChild(inputEl);

    inputEl.classList.add('pretty-select-input');

    const menu = document.createElement('div');
    menu.className = 'pretty-select-menu hidden';
    wrapper.appendChild(menu);

    const closeMenu = () => {
        menu.classList.add('hidden');
    };

    const openMenu = () => {
        menu.classList.remove('hidden');
    };

    const renderMenu = () => {
        const query = String(inputEl.value || '').trim().toLowerCase();
        const channels = [...guildChannels];

        // Simple filtering: name contains query OR user pasted an ID/mention.
        let results = channels;
        if (query) {
            const resolvedId = resolveChannelIdFromUserInput(inputEl.value);
            if (resolvedId) {
                results = channels.filter(c => String(c.id) === String(resolvedId));
            } else {
                const q = query.startsWith('#') ? query.slice(1) : query;
                results = channels.filter(c => String(c.name || '').toLowerCase().includes(q));
            }
        }

        results = results
            .sort((a, b) => {
                if (a.type !== b.type) return a.type - b.type;
                return String(a.name || '').localeCompare(String(b.name || ''));
            })
            .slice(0, 30);

        menu.innerHTML = '';

        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'pretty-select-empty';
            empty.textContent = 'No matching channels';
            menu.appendChild(empty);
            return;
        }

        for (const ch of results) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'pretty-select-item';
            item.dataset.id = ch.id;

            const left = document.createElement('div');
            left.className = 'pretty-select-item-title';
            left.textContent = formatChannelDisplayName(ch);

            const right = document.createElement('div');
            right.className = 'pretty-select-item-meta';
            right.textContent = getChannelTypeName(ch.type);

            item.appendChild(left);
            item.appendChild(right);

            item.addEventListener('mousedown', (e) => {
                // Prevent blur firing before click
                e.preventDefault();
            });

            item.addEventListener('click', () => {
                if (typeof onPick === 'function') {
                    onPick(ch);
                } else {
                    inputEl.value = formatChannelDisplayName(ch);
                }
                closeMenu();
            });

            menu.appendChild(item);
        }
    };

    inputEl.addEventListener('focus', () => {
        renderMenu();
        openMenu();
    });

    inputEl.addEventListener('input', () => {
        renderMenu();
        openMenu();
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMenu();
            return;
        }
        if (e.key === 'Enter') {
            // Let callers handle commit on blur/change; keep dropdown from submitting forms inadvertently.
            if (menu && !menu.classList.contains('hidden')) {
                e.preventDefault();
            }
        }
    });

    inputEl.addEventListener('blur', () => {
        // Delay so clicks on menu register
        setTimeout(() => closeMenu(), 150);
    });
}

function syncPrettyChannelInputFromHidden(hiddenInputEl) {
    if (!hiddenInputEl?._prettyDisplayInput) return;
    const id = String(hiddenInputEl.value || '').trim();
    hiddenInputEl._prettyDisplayInput.value = resolveChannelNameById(id);
    hiddenInputEl._prettyDisplayInput.dataset.channelId = id;
}

function upgradeSingleChannelIdInput(hiddenInputEl) {
    if (!hiddenInputEl || hiddenInputEl.dataset.prettyUpgraded === '1') return;
    hiddenInputEl.dataset.prettyUpgraded = '1';

    // Preserve original ID storage for form logic
    const originalType = hiddenInputEl.type;
    hiddenInputEl.type = 'hidden';
    hiddenInputEl.dataset.originalType = originalType;

    const displayInput = document.createElement('input');
    displayInput.type = 'text';
    displayInput.className = (hiddenInputEl.className || '').replace('font-mono', '').trim() || 'form-input';
    displayInput.placeholder = hiddenInputEl.placeholder || 'Search channel…';

    hiddenInputEl.parentNode.insertBefore(displayInput, hiddenInputEl);
    hiddenInputEl._prettyDisplayInput = displayInput;

    const commitTypedValue = () => {
        const typed = displayInput.value.trim();
        if (!typed) {
            hiddenInputEl.value = '';
            syncPrettyChannelInputFromHidden(hiddenInputEl);
            return;
        }

        const resolved = resolveChannelIdFromUserInput(typed);
        if (!resolved) {
            showToast('Select a valid channel from the list (or paste its ID)', 'error');
            syncPrettyChannelInputFromHidden(hiddenInputEl);
            return;
        }

        hiddenInputEl.value = resolved;
        syncPrettyChannelInputFromHidden(hiddenInputEl);
    };

    attachPrettyChannelDropdown(displayInput, {
        onPick: (ch) => {
            hiddenInputEl.value = ch.id;
            syncPrettyChannelInputFromHidden(hiddenInputEl);
        }
    });

    displayInput.addEventListener('change', commitTypedValue);
    displayInput.addEventListener('blur', commitTypedValue);

    syncPrettyChannelInputFromHidden(hiddenInputEl);
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
let currentSection = 'general';
let activityChart = null;
let moderationChart = null;
let currentBotTimezone = 'UTC';

const SECTION_TITLES = {
    general: 'General',
    commands: 'Commands',
    modules: 'Modules',
    moderation: 'Moderation',
    activity: 'Activity',
    logging: 'Logging',
    'onboarding-home': 'Onboarding',
    users: 'User Management',
    // Hidden/deep-link sections
    levels: 'Leveling',
    'no-roleplay': 'No Roleplay',
    'no-danger-edits': 'No Danger Edits',
    'reply-thread': 'Reply Threads',
    onboarding: 'Onboarding Config',
    'wow-guild': 'WoW Guild',
    'wow-guest': 'WoW Guest'
};

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

    // General page controls
    document.getElementById('general-bot-enabled')?.addEventListener('change', async (e) => {
        if (!currentGuildId) return;
        const enabled = !!e.target.checked;
        try {
            await patchGuildSettings({ bot_enabled: enabled });
            showToast('Bot enabled updated', 'success');
        } catch (error) {
            e.target.checked = !enabled;
            showToast(error.message || 'Failed to update bot enabled', 'error');
        }
    });

    document.getElementById('general-save-prefix')?.addEventListener('click', async () => {
        if (!currentGuildId) return;
        const value = document.getElementById('general-cmd-prefix')?.value?.trim() || '!';
        try {
            await patchGuildSettings({ cmd_prefix: value });
            showToast('Prefix updated', 'success');
        } catch (error) {
            showToast(error.message || 'Failed to update prefix', 'error');
        }
    });

    document.getElementById('general-save-timezone')?.addEventListener('click', async () => {
        if (!currentGuildId) return;
        const value = document.getElementById('general-bot-timezone')?.value?.trim() || 'UTC';
        try {
            await patchGuildSettings({ bot_timezone: value });
            showToast('Timezone updated', 'success');
            const tzEl = document.getElementById('stat-bot-timezone');
            if (tzEl) tzEl.textContent = value;
        } catch (error) {
            showToast(error.message || 'Failed to update timezone', 'error');
        }
    });

    document.getElementById('general-save-roles')?.addEventListener('click', async () => {
        if (!currentGuildId) return;
        try {
            await patchGuildSettings({
                roles_super_admin: getArrayInputValues('roles-super-admin'),
                roles_admin: getArrayInputValues('roles-admin'),
                roles_mod: getArrayInputValues('roles-mod'),
                roles_jr_mod: getArrayInputValues('roles-jr-mod'),
                roles_helper: getArrayInputValues('roles-helper'),
                roles_trust: getArrayInputValues('roles-trust'),
                roles_untrusted: getArrayInputValues('roles-untrusted')
            });
            showToast('Roles updated', 'success');
        } catch (error) {
            showToast(error.message || 'Failed to update roles', 'error');
        }
    });
    
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
    
    // Restore last visited section or default to General
    const lastSection = localStorage.getItem('lastSection') || 'general';
    navigateTo(lastSection === 'dashboard' ? 'general' : lastSection);
}

function navigateTo(section) {
    // Legacy route
    if (section === 'dashboard') section = 'general';
    if (!SECTION_TITLES[section] && section !== 'users') section = 'general';

    currentSection = section;
    localStorage.setItem('lastSection', section);

    const pageTitle = document.getElementById('page-title');
    if (pageTitle) pageTitle.textContent = SECTION_TITLES[section] || 'Settings';
    
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
    if (!currentGuildId && section !== 'users') {
        if (section === 'general') {
            renderGeneralPlaceholders();
        }
        return;
    }
    
    switch (section) {
        case 'general':
            loadGeneralSection();
            break;
        case 'commands':
            loadCommandsSection();
            break;
        case 'modules':
            loadModulesSection();
            break;
        case 'moderation':
            loadModerationSection();
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
        case 'logging':
            loadLoggingSection();
            break;
        case 'onboarding-home':
            loadOnboardingHomeSection();
            break;
        case 'users':
            loadUsers();
            break;
    }
}

function renderGeneralPlaceholders() {
    const ids = ['stat-total-members', 'stat-joins-today', 'stat-captcha-kicks', 'stat-bot-timezone'];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = '--';
    });
}

async function getGuildSettings() {
    const response = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/settings`);
    if (!response.ok) {
        const error = await safeReadJson(response);
        throw new Error(formatApiError(error, 'Failed to load settings'));
    }
    const data = await response.json();
    return data.settings || {};
}

async function patchGuildSettings(partialSettings) {
    const response = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partialSettings || {})
    });

    if (!response.ok) {
        const error = await safeReadJson(response);
        throw new Error(formatApiError(error, 'Failed to update settings'));
    }

    const data = await response.json();
    return data.settings || {};
}

function createToggleCard({ title, description, enabled, onToggle, onSettings, settingsLabel = 'Settings' }) {
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'card-header';

    const h3 = document.createElement('h3');
    h3.className = 'card-title';
    h3.textContent = title;
    header.appendChild(h3);
    card.appendChild(header);

    const row = document.createElement('div');
    row.className = 'setting-row';

    const info = document.createElement('div');
    info.className = 'setting-info';
    const st = document.createElement('div');
    st.className = 'setting-title';
    st.textContent = 'Enabled';
    const sd = document.createElement('div');
    sd.className = 'setting-description';
    sd.textContent = description || '';
    info.appendChild(st);
    info.appendChild(sd);
    row.appendChild(info);

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!enabled;
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggleLabel.appendChild(input);
    toggleLabel.appendChild(slider);
    row.appendChild(toggleLabel);

    input.addEventListener('change', async () => {
        if (typeof onToggle === 'function') {
            await onToggle(input.checked, input);
        }
    });

    card.appendChild(row);

    const footer = document.createElement('div');
    footer.className = 'mt-4';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = settingsLabel;
    btn.addEventListener('click', () => {
        if (typeof onSettings === 'function') onSettings();
    });
    footer.appendChild(btn);
    card.appendChild(footer);

    return card;
}

function createLoggingChannelCard({ title, enabled, channelId, onToggle, onChannelChange, onSettings }) {
    const card = document.createElement('div');
    card.className = 'card logging-card';

    const header = document.createElement('div');
    header.className = 'card-header';

    const h3 = document.createElement('h3');
    h3.className = 'card-title';
    h3.textContent = title;
    header.appendChild(h3);
    card.appendChild(header);

    const row = document.createElement('div');
    row.className = 'logging-control-row';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = !!enabled;
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(slider);
    row.appendChild(toggleLabel);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input logging-channel-input';
    input.placeholder = 'Search channel…';
    input.value = resolveChannelNameById(channelId);
    input.dataset.channelId = channelId || '';
    row.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary btn-settings-small';
    btn.textContent = 'Setting';
    // Disabled for now; button is present for future expansion
    btn.disabled = true;
    btn.addEventListener('click', () => {
        return;
    });
    row.appendChild(btn);

    toggleInput.addEventListener('change', async () => {
        if (typeof onToggle === 'function') {
            await onToggle(toggleInput.checked, toggleInput);
        }
    });

    const commitChannelChange = async () => {
        if (typeof onChannelChange !== 'function') return;

        const typed = input.value.trim();
        const resolvedId = resolveChannelIdFromUserInput(typed);
        if (typed && !resolvedId) {
            // Revert to last known good value
            input.value = resolveChannelNameById(input.dataset.channelId);
            return;
        }

        await onChannelChange(resolvedId, input);
    };

    input.addEventListener('change', commitChannelChange);
    input.addEventListener('blur', commitChannelChange);

    attachPrettyChannelDropdown(input, {
        onPick: async (ch) => {
            input.value = formatChannelDisplayName(ch);
            input.dataset.channelId = ch.id;
            await onChannelChange(ch.id, input);
        }
    });

    card.appendChild(row);
    return card;
}

async function loadGeneralSection() {
    if (!currentGuildId) {
        renderGeneralPlaceholders();
        return;
    }

    try {
        const [statsResponse, settings] = await Promise.all([
            authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/stats`),
            getGuildSettings()
        ]);

        if (statsResponse.ok) {
            const stats = await statsResponse.json();
            // Stats cards live in the General section now
            document.getElementById('stat-total-members').textContent = stats.totalMembers?.toLocaleString() || '--';
            document.getElementById('stat-joins-today').textContent = stats.joinsToday?.toLocaleString() || '--';
            document.getElementById('stat-captcha-kicks').textContent = stats.captchaKicks?.toLocaleString() || '--';
        } else {
            renderGeneralPlaceholders();
        }

        const tz = settings.bot_timezone || 'UTC';
        currentBotTimezone = tz;
        const tzEl = document.getElementById('stat-bot-timezone');
        if (tzEl) tzEl.textContent = tz;

        const botEnabled = document.getElementById('general-bot-enabled');
        if (botEnabled) botEnabled.checked = settings.bot_enabled !== false;

        const prefix = document.getElementById('general-cmd-prefix');
        if (prefix) prefix.value = settings.cmd_prefix || '!';

        const tzInput = document.getElementById('general-bot-timezone');
        if (tzInput) tzInput.value = tz;

        setArrayInputValues('roles-super-admin', settings.roles_super_admin || []);
        setArrayInputValues('roles-admin', settings.roles_admin || []);
        setArrayInputValues('roles-mod', settings.roles_mod || []);
        setArrayInputValues('roles-jr-mod', settings.roles_jr_mod || []);
        setArrayInputValues('roles-helper', settings.roles_helper || []);
        setArrayInputValues('roles-trust', settings.roles_trust || []);
        setArrayInputValues('roles-untrusted', settings.roles_untrusted || []);
    } catch (error) {
        console.error('Failed to load general section:', error);
        showToast(error.message || 'Failed to load general section', 'error');
    }
}

async function loadCommandsSection() {
    const container = document.getElementById('commands-list');
    if (!container) return;
    container.innerHTML = '';

    try {
        const response = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/commands`);
        if (!response.ok) {
            const error = await safeReadJson(response);
            throw new Error(formatApiError(error, 'Failed to load commands'));
        }

        const { commands } = await response.json();
        (commands || []).forEach((cmd) => {
            const title = cmd.command_name;
            const flags = [
                cmd.has_slash ? 'slash' : null,
                cmd.has_prefix ? 'prefix' : null
            ].filter(Boolean).join(', ');
            const desc = `${cmd.category || 'uncategorized'}${flags ? ` • ${flags}` : ''}`;

            const card = createToggleCard({
                title,
                description: desc,
                enabled: cmd.enabled !== false,
                onToggle: async (enabled, checkbox) => {
                    try {
                        const r = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/commands/${encodeURIComponent(cmd.command_name)}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ enabled })
                        });
                        if (!r.ok) {
                            const err = await safeReadJson(r);
                            throw new Error(formatApiError(err, 'Failed to update command'));
                        }
                        showToast('Command updated', 'success');
                    } catch (e) {
                        checkbox.checked = !enabled;
                        showToast(e.message || 'Failed to update command', 'error');
                    }
                },
                onSettings: () => showToast('No dashboard settings for this command', 'error')
            });

            container.appendChild(card);
        });
    } catch (error) {
        console.error('Failed to load commands section:', error);
        showToast(error.message || 'Failed to load commands', 'error');
    }
}

async function loadModulesSection() {
    const container = document.getElementById('modules-grid');
    if (!container) return;
    container.innerHTML = '';

    try {
        const [settings, replyThreadRes, dangerEditsRes] = await Promise.all([
            getGuildSettings(),
            authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/reply-thread`).catch(() => null),
            authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/automod/no-danger-edits`).catch(() => null)
        ]);

        let replyThreadEnabled = true;
        let dangerEditsEnabled = true;
        try {
            if (replyThreadRes && replyThreadRes.ok) {
                const d = await replyThreadRes.json();
                replyThreadEnabled = (d.settings?.enabled ?? true) === true;
            }
        } catch {
            // ignore
        }
        try {
            if (dangerEditsRes && dangerEditsRes.ok) {
                const d = await dangerEditsRes.json();
                dangerEditsEnabled = (d.settings?.enabled ?? true) === true;
            }
        } catch {
            // ignore
        }

        // Leveling (gated via enable_leveling)
        container.appendChild(createToggleCard({
            title: 'Leveling',
            description: 'XP tracking and leveling roles.',
            enabled: settings.enable_leveling !== false,
            onToggle: async (enabled, checkbox) => {
                try {
                    await patchGuildSettings({ enable_leveling: enabled });
                    showToast('Leveling updated', 'success');
                } catch (e) {
                    checkbox.checked = !enabled;
                    showToast(e.message || 'Failed to update leveling', 'error');
                }
            },
            onSettings: () => navigateTo('levels')
        }));

        // Economy
        container.appendChild(createToggleCard({
            title: 'Economy',
            description: 'Eco commands and economy features.',
            enabled: settings.enable_economy !== false,
            onToggle: async (enabled, checkbox) => {
                try {
                    await patchGuildSettings({ enable_economy: enabled });
                    showToast('Economy updated', 'success');
                } catch (e) {
                    checkbox.checked = !enabled;
                    showToast(e.message || 'Failed to update economy', 'error');
                }
            },
            onSettings: () => navigateTo('commands')
        }));

        // Role Menus
        container.appendChild(createToggleCard({
            title: 'Role Menus',
            description: 'Interactive role menus (buttons/selects).',
            enabled: settings.enable_role_menus !== false,
            onToggle: async (enabled, checkbox) => {
                try {
                    await patchGuildSettings({ enable_role_menus: enabled });
                    showToast('Role Menus updated', 'success');
                } catch (e) {
                    checkbox.checked = !enabled;
                    showToast(e.message || 'Failed to update role menus', 'error');
                }
            },
            onSettings: () => showToast('Role menu settings UI not implemented yet', 'error')
        }));

        // Auto Role
        container.appendChild(createToggleCard({
            title: 'Auto Role',
            description: 'Assign a role to new members on join.',
            enabled: settings.auto_role_enabled === true,
            onToggle: async (enabled, checkbox) => {
                try {
                    await patchGuildSettings({ auto_role_enabled: enabled });
                    showToast('Auto Role updated', 'success');
                } catch (e) {
                    checkbox.checked = !enabled;
                    showToast(e.message || 'Failed to update auto role', 'error');
                }
            },
            onSettings: async () => {
                const current = settings.auto_role_id || '';
                const roleId = prompt('Enter Auto Role role ID:', current);
                if (roleId === null) return;
                try {
                    await patchGuildSettings({ auto_role_id: roleId.trim() || null });
                    showToast('Auto Role role updated', 'success');
                    loadModulesSection();
                } catch (e) {
                    showToast(e.message || 'Failed to update auto role role', 'error');
                }
            }
        }));

        // Reply Threads
        container.appendChild(createToggleCard({
            title: 'Reply Threads',
            description: 'Auto-thread replies in configured channels.',
            enabled: replyThreadEnabled,
            onToggle: async (enabled, checkbox) => {
                try {
                    const getRes = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/reply-thread`);
                    const data = await getRes.json();
                    const current = data.settings || {};
                    const putRes = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/reply-thread`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...current, enabled })
                    });
                    if (!putRes.ok) {
                        const err = await safeReadJson(putRes);
                        throw new Error(formatApiError(err, 'Failed to update reply threads'));
                    }
                    showToast('Reply Threads updated', 'success');
                } catch (e) {
                    checkbox.checked = !enabled;
                    showToast(e.message || 'Failed to update reply threads', 'error');
                }
            },
            onSettings: () => navigateTo('reply-thread')
        }));

        // Danger Edits
        container.appendChild(createToggleCard({
            title: 'Danger Edits',
            description: 'Detect and respond to dangerous edited content.',
            enabled: dangerEditsEnabled,
            onToggle: async (enabled, checkbox) => {
                try {
                    const getRes = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/automod/no-danger-edits`);
                    const data = await getRes.json();
                    const current = data.settings || {};
                    const putRes = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/automod/no-danger-edits`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...current, enabled })
                    });
                    if (!putRes.ok) {
                        const err = await safeReadJson(putRes);
                        throw new Error(formatApiError(err, 'Failed to update danger edits'));
                    }
                    showToast('Danger Edits updated', 'success');
                } catch (e) {
                    checkbox.checked = !enabled;
                    showToast(e.message || 'Failed to update danger edits', 'error');
                }
            },
            onSettings: () => navigateTo('no-danger-edits')
        }));

        // (Enabled state for Reply Threads/Danger Edits is loaded upfront.)
    } catch (error) {
        console.error('Failed to load modules section:', error);
        showToast(error.message || 'Failed to load modules', 'error');
    }
}

async function loadModerationSection() {
    await Promise.all([
        loadModerationMutes(),
        loadModerationRecentActions(),
        loadModerationModulesCards()
    ]);
}

async function loadModerationMutes() {
    const tbody = document.getElementById('current-mutes-table');
    if (!tbody) return;

    try {
        const res = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/moderation/muted?limit=25`);
        if (!res.ok) {
            const err = await safeReadJson(res);
            throw new Error(formatApiError(err, 'Failed to load muted users'));
        }
        const data = await res.json();
        const rows = data.mutedUsers || [];

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-gray-400 py-4">No active mutes</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map((r) => {
            let expires = '—';
            if (r.expires_at) {
                try {
                    expires = new Date(r.expires_at).toLocaleString(undefined, { timeZone: currentBotTimezone });
                } catch {
                    expires = new Date(r.expires_at).toLocaleString();
                }
            }
            return `
                <tr>
                    <td class="font-mono">${escapeHtml(r.user_id)}</td>
                    <td>${escapeHtml(r.reason || '')}</td>
                    <td>${escapeHtml(expires)}</td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        console.error('Failed to load mutes:', e);
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-gray-400 py-4">Failed to load</td></tr>';
    }
}

async function loadModerationRecentActions() {
    try {
        const res = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/stats`);
        if (!res.ok) return;
        const data = await res.json();
        renderRecentActions(data.recentActions || []);
    } catch {
        // ignore
    }
}

async function loadModerationModulesCards() {
    const container = document.getElementById('moderation-modules-grid');
    if (!container) return;
    container.innerHTML = '';

    let settings = {};
    try {
        settings = await getGuildSettings();
    } catch {
        // ignore
    }

    async function setCommandsEnabled(commandNames, enabled) {
        const unique = Array.from(new Set((commandNames || []).filter(Boolean)));
        await Promise.all(
            unique.map((name) =>
                authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/commands/${encodeURIComponent(name)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled })
                })
            )
        );
    }

    async function getCommandsEnabledMap() {
        const res = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/commands`);
        if (!res.ok) return new Map();
        const data = await res.json();
        const map = new Map();
        (data.commands || []).forEach((c) => map.set(c.command_name, c.enabled !== false));
        return map;
    }

    const cmdEnabled = await getCommandsEnabledMap();

    // Automod (module toggle)
    container.appendChild(createToggleCard({
        title: 'Automod',
        description: 'Enable/disable automod features for this server.',
        enabled: settings.enable_automod !== false,
        onToggle: async (enabled, checkbox) => {
            try {
                await patchGuildSettings({ enable_automod: enabled });
                showToast('Automod updated', 'success');
            } catch (e) {
                checkbox.checked = !enabled;
                showToast(e.message || 'Failed to update automod', 'error');
            }
        },
        onSettings: () => navigateTo('no-roleplay')
    }));

    // Automod submodules (placeholders)
    container.appendChild(createToggleCard({
        title: 'Automod - Discord Mode',
        description: 'Leave empty for now.',
        enabled: true,
        onToggle: async (_enabled, checkbox) => {
            checkbox.checked = true;
            showToast('Not implemented yet', 'error');
        },
        onSettings: () => showToast('Not implemented yet', 'error')
    }));

    container.appendChild(createToggleCard({
        title: 'Automod - Legacy Mode',
        description: 'Leave empty for now.',
        enabled: true,
        onToggle: async (_enabled, checkbox) => {
            checkbox.checked = true;
            showToast('Not implemented yet', 'error');
        },
        onSettings: () => showToast('Not implemented yet', 'error')
    }));

    // Muting (module toggle via commands)
    const mutingCommands = ['mute', 'unmute'];
    const mutingEnabled = mutingCommands.every((c) => cmdEnabled.get(c) !== false);
    container.appendChild(createToggleCard({
        title: 'Muting',
        description: 'Mute/unmute moderation commands and related settings.',
        enabled: mutingEnabled,
        onToggle: async (enabled, checkbox) => {
            try {
                await setCommandsEnabled(mutingCommands, enabled);
                showToast('Muting updated', 'success');
            } catch (e) {
                checkbox.checked = !enabled;
                showToast(e.message || 'Failed to update muting', 'error');
            }
        },
        onSettings: async () => {
            try {
                const muteRole = prompt('mute_roleID (role ID):', settings.mute_roleid || '');
                if (muteRole === null) return;
                const immuneUsersRaw = prompt('mute_immuneUserIDs (comma-separated user IDs):', (settings.mute_immuneuserids || []).join(','));
                if (immuneUsersRaw === null) return;
                const rolesRemovedRaw = prompt('mute_rolesRemoved (comma-separated role IDs):', (settings.mute_rolesremoved || []).join(','));
                if (rolesRemovedRaw === null) return;

                const immuneUsers = immuneUsersRaw.split(',').map(s => s.trim()).filter(Boolean);
                const rolesRemoved = rolesRemovedRaw.split(',').map(s => s.trim()).filter(Boolean);
                await patchGuildSettings({
                    mute_roleID: muteRole.trim() || null,
                    mute_immuneUserIDs: immuneUsers,
                    mute_rolesRemoved: rolesRemoved
                });
                showToast('Muting settings updated', 'success');
            } catch (e) {
                showToast(e.message || 'Failed to update muting settings', 'error');
            }
        }
    }));

    // Bans/Kicks (module toggle via ban commands)
    const banCommands = ['ban', 'unban', 'cban', 'ccBan'];
    const bansEnabled = banCommands.every((c) => cmdEnabled.get(c) !== false);
    container.appendChild(createToggleCard({
        title: 'Bans/Kicks',
        description: 'Ban/unban commands and ban/kick immunity settings.',
        enabled: bansEnabled,
        onToggle: async (enabled, checkbox) => {
            try {
                await setCommandsEnabled(banCommands, enabled);
                showToast('Bans/Kicks updated', 'success');
            } catch (e) {
                checkbox.checked = !enabled;
                showToast(e.message || 'Failed to update bans/kicks', 'error');
            }
        },
        onSettings: async () => {
            try {
                const banImmRolesRaw = prompt('ban_immuneRoles (comma-separated role IDs):', (settings.ban_immuneroles || []).join(','));
                if (banImmRolesRaw === null) return;
                const banImmUsersRaw = prompt('ban_immuneUserID (comma-separated user IDs):', (settings.ban_immuneuserid || []).join(','));
                if (banImmUsersRaw === null) return;

                const kickImmRolesRaw = prompt('kick_immuneRoles (comma-separated role IDs):', (settings.kick_immuneroles || []).join(','));
                if (kickImmRolesRaw === null) return;
                const kickImmUsersRaw = prompt('kick_immuneUserID (comma-separated user IDs):', (settings.kick_immuneuserid || []).join(','));
                if (kickImmUsersRaw === null) return;

                await patchGuildSettings({
                    ban_immuneRoles: banImmRolesRaw.split(',').map(s => s.trim()).filter(Boolean),
                    ban_immuneUserID: banImmUsersRaw.split(',').map(s => s.trim()).filter(Boolean),
                    kick_immuneRoles: kickImmRolesRaw.split(',').map(s => s.trim()).filter(Boolean),
                    kick_immuneUserID: kickImmUsersRaw.split(',').map(s => s.trim()).filter(Boolean)
                });
                showToast('Bans/Kicks settings updated', 'success');
            } catch (e) {
                showToast(e.message || 'Failed to update bans/kicks settings', 'error');
            }
        }
    }));

    // Kick (settings only; no dedicated kick command in this repo)
    container.appendChild(createToggleCard({
        title: 'Kick',
        description: 'Kick settings (no dedicated kick command detected).',
        enabled: true,
        onToggle: async (_enabled, checkbox) => {
            checkbox.checked = true;
            showToast('Kick module toggle not implemented', 'error');
        },
        onSettings: async () => {
            try {
                const kickImmRolesRaw = prompt('kick_immuneRoles (comma-separated role IDs):', (settings.kick_immuneroles || []).join(','));
                if (kickImmRolesRaw === null) return;
                const kickImmUsersRaw = prompt('kick_immuneUserID (comma-separated user IDs):', (settings.kick_immuneuserid || []).join(','));
                if (kickImmUsersRaw === null) return;
                await patchGuildSettings({
                    kick_immuneRoles: kickImmRolesRaw.split(',').map(s => s.trim()).filter(Boolean),
                    kick_immuneUserID: kickImmUsersRaw.split(',').map(s => s.trim()).filter(Boolean)
                });
                showToast('Kick settings updated', 'success');
            } catch (e) {
                showToast(e.message || 'Failed to update kick settings', 'error');
            }
        }
    }));

    // OpenAI
    container.appendChild(createToggleCard({
        title: 'Open AI',
        description: 'Enable/disable OpenAI features (if configured).',
        enabled: settings.enable_openai !== false,
        onToggle: async (enabled, checkbox) => {
            try {
                await patchGuildSettings({ enable_openAI: enabled });
                showToast('OpenAI updated', 'success');
            } catch (e) {
                checkbox.checked = !enabled;
                showToast(e.message || 'Failed to update OpenAI', 'error');
            }
        },
        onSettings: () => showToast('OpenAI settings UI not implemented yet', 'error')
    }));

    // (No additional hydration needed here; values come from settings/command registry)
}

async function loadLoggingSection() {
    const container = document.getElementById('logging-grid');
    if (!container) return;
    container.innerHTML = '';

    const LOG_KEYS = [
        'ch_actionLog',
        'ch_kickbanLog',
        'ch_auditLog',
        'ch_airlockJoin',
        'ch_airlockLeave',
        'ch_deletedMessages',
        'ch_editedMessages',
        'ch_automod_AI',
        'ch_voiceLog',
        'ch_inviteLog',
        'ch_permanentInvites',
        'ch_memberJoin'
    ];

    try {
        const settings = await getGuildSettings();

        const actionLogFallback = settings['ch_actionlog'] || '';

        LOG_KEYS.forEach((key) => {
            const channelKey = key;
            const enableKey = `enable_${key}`;

            const currentChannelId = settings[channelKey.toLowerCase()] || '';
            const enableValue = settings[enableKey.toLowerCase()];
            const enabled = (typeof enableValue === 'boolean') ? enableValue : !!currentChannelId;

            container.appendChild(createLoggingChannelCard({
                title: channelKey,
                enabled: enabled && !!currentChannelId,
                channelId: currentChannelId,
                onToggle: async (nextEnabled, checkboxEl) => {
                    try {
                        if (!nextEnabled) {
                            await patchGuildSettings({ [enableKey]: false });
                            showToast('Logging updated', 'success');
                            loadLoggingSection();
                            return;
                        }

                        // Turning ON requires a channel selection.
                        if (!currentChannelId) {
                            if (channelKey !== 'ch_actionLog' && actionLogFallback) {
                                await patchGuildSettings({
                                    [channelKey]: actionLogFallback,
                                    [enableKey]: true
                                });
                                showToast('Logging updated', 'success');
                                loadLoggingSection();
                                return;
                            }

                            checkboxEl.checked = false;
                            showToast('Select a channel first', 'error');
                            return;
                        }

                        await patchGuildSettings({ [enableKey]: true });
                        showToast('Logging updated', 'success');
                        loadLoggingSection();
                    } catch (e) {
                        checkboxEl.checked = !nextEnabled;
                        showToast(e.message || 'Failed to update logging', 'error');
                    }
                },
                onChannelChange: async (nextChannelId, inputEl) => {
                    const normalized = String(nextChannelId || '').trim();
                    try {
                        if (!normalized) {
                            // Clearing the channel also disables the logger.
                            await patchGuildSettings({
                                [channelKey]: null,
                                [enableKey]: false
                            });
                            showToast('Logging updated', 'success');
                            loadLoggingSection();
                            return;
                        }

                        await patchGuildSettings({ [channelKey]: normalized });
                        showToast('Logging updated', 'success');
                        loadLoggingSection();
                    } catch (e) {
                        // Revert UI to current DB value
                        inputEl.value = resolveChannelNameById(currentChannelId);
                        showToast(e.message || 'Failed to update logging', 'error');
                    }
                },
                onSettings: async () => {
                    const value = prompt(`Enter channel ID for ${channelKey}:`, currentChannelId || actionLogFallback);
                    if (value === null) return;
                    try {
                        const trimmed = value.trim();
                        if (!trimmed) {
                            await patchGuildSettings({ [channelKey]: null, [enableKey]: false });
                        } else {
                            await patchGuildSettings({ [channelKey]: trimmed });
                        }
                        showToast('Logging updated', 'success');
                        loadLoggingSection();
                    } catch (e) {
                        showToast(e.message || 'Failed to update logging', 'error');
                    }
                }
            }));
        });

        // Also include ch_* arrays from init.sql
        const ignoreCards = [
            { key: 'ch_categoryIgnoreAutomod', title: 'ch_categoryIgnoreAutomod', description: 'Category IDs ignored by automod.' },
            { key: 'ch_channelIgnoreAutomod', title: 'ch_channelIgnoreAutomod', description: 'Channel IDs ignored by automod.' }
        ];

        ignoreCards.forEach(({ key, title, description }) => {
            const currentArr = settings[key.toLowerCase()] || [];
            const enabled = Array.isArray(currentArr) ? currentArr.length > 0 : !!currentArr;

            container.appendChild(createToggleCard({
                title,
                description,
                enabled,
                onToggle: async (enabled, checkbox) => {
                    try {
                        if (!enabled) {
                            await patchGuildSettings({ [key]: [] });
                            showToast('Updated', 'success');
                            loadLoggingSection();
                            return;
                        }

                        const value = prompt(`Enter comma-separated IDs for ${key}:`, (currentArr || []).join(','));
                        if (value === null) {
                            checkbox.checked = false;
                            return;
                        }
                        const arr = value.split(',').map(s => s.trim()).filter(Boolean);
                        await patchGuildSettings({ [key]: arr });
                        showToast('Updated', 'success');
                        loadLoggingSection();
                    } catch (e) {
                        checkbox.checked = !enabled;
                        showToast(e.message || 'Failed to update', 'error');
                    }
                },
                onSettings: async () => {
                    const value = prompt(`Enter comma-separated IDs for ${key}:`, (currentArr || []).join(','));
                    if (value === null) return;
                    try {
                        const arr = value.split(',').map(s => s.trim()).filter(Boolean);
                        await patchGuildSettings({ [key]: arr });
                        showToast('Updated', 'success');
                        loadLoggingSection();
                    } catch (e) {
                        showToast(e.message || 'Failed to update', 'error');
                    }
                }
            }));
        });
    } catch (error) {
        console.error('Failed to load logging section:', error);
        showToast(error.message || 'Failed to load logging', 'error');
    }
}

async function loadOnboardingHomeSection() {
    const container = document.getElementById('onboarding-modules-grid');
    if (!container) return;
    container.innerHTML = '';

    // Gate Mode (Onboarding)
    container.appendChild(createToggleCard({
        title: 'Gate Mode',
        description: 'Role-gated onboarding flow.',
        enabled: true,
        onToggle: async (enabled, checkbox) => {
            try {
                const getRes = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/onboarding`);
                const data = await getRes.json();
                const current = data.settings || {};
                const putRes = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/onboarding`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...current, enabled })
                });
                if (!putRes.ok) {
                    const err = await safeReadJson(putRes);
                    throw new Error(formatApiError(err, 'Failed to update onboarding'));
                }
                showToast('Onboarding updated', 'success');
            } catch (e) {
                checkbox.checked = !enabled;
                showToast(e.message || 'Failed to update onboarding', 'error');
            }
        },
        onSettings: () => navigateTo('onboarding')
    }));

    // WoW Guild
    container.appendChild(createToggleCard({
        title: 'Guild',
        description: 'WoW guild onboarding flow.',
        enabled: true,
        onToggle: async (enabled, checkbox) => {
            try {
                const getRes = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/wow-guild`);
                const data = await getRes.json();
                const current = data.settings || {};
                const putRes = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/wow-guild`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...current, enabled })
                });
                if (!putRes.ok) {
                    const err = await safeReadJson(putRes);
                    throw new Error(formatApiError(err, 'Failed to update WoW guild'));
                }
                showToast('WoW guild updated', 'success');
            } catch (e) {
                checkbox.checked = !enabled;
                showToast(e.message || 'Failed to update WoW guild', 'error');
            }
        },
        onSettings: () => navigateTo('wow-guild')
    }));

    // WoW Guest
    container.appendChild(createToggleCard({
        title: 'Guild Guest',
        description: 'WoW guest onboarding flow.',
        enabled: true,
        onToggle: async (enabled, checkbox) => {
            try {
                const getRes = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/wow-guest`);
                const data = await getRes.json();
                const current = data.settings || {};
                const putRes = await authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/wow-guest`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...current, enabled })
                });
                if (!putRes.ok) {
                    const err = await safeReadJson(putRes);
                    throw new Error(formatApiError(err, 'Failed to update WoW guest'));
                }
                showToast('WoW guest updated', 'success');
            } catch (e) {
                checkbox.checked = !enabled;
                showToast(e.message || 'Failed to update WoW guest', 'error');
            }
        },
        onSettings: () => navigateTo('wow-guest')
    }));

    // Hydrate enabled states
    try {
        const [onRes, wgRes, wgsRes] = await Promise.all([
            authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/onboarding`),
            authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/wow-guild`),
            authenticatedFetch(`${API_BASE}/guilds/${currentGuildId}/wow-guest`)
        ]);

        if (onRes.ok) {
            const d = await onRes.json();
            const enabled = (d.settings?.enabled ?? true) === true;
            const inputs = container.querySelectorAll('input[type="checkbox"]');
            if (inputs[0]) inputs[0].checked = enabled;
        }
        if (wgRes.ok) {
            const d = await wgRes.json();
            const enabled = (d.settings?.enabled ?? true) === true;
            const inputs = container.querySelectorAll('input[type="checkbox"]');
            if (inputs[1]) inputs[1].checked = enabled;
        }
        if (wgsRes.ok) {
            const d = await wgsRes.json();
            const enabled = (d.settings?.enabled ?? true) === true;
            const inputs = container.querySelectorAll('input[type="checkbox"]');
            if (inputs[2]) inputs[2].checked = enabled;
        }
    } catch {
        // ignore
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
    const totalEl = document.getElementById('stat-total-members');
    if (totalEl) totalEl.textContent = data.totalMembers?.toLocaleString() || '--';

    const joinsEl = document.getElementById('stat-joins-today');
    if (joinsEl) joinsEl.textContent = data.joinsToday?.toLocaleString() || '--';

    const modEl = document.getElementById('stat-mod-actions');
    if (modEl) modEl.textContent = data.modActions7d?.toLocaleString() || '--';

    const captchaEl = document.getElementById('stat-captcha-kicks');
    if (captchaEl) captchaEl.textContent = data.captchaKicks?.toLocaleString() || '--';
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

    syncPrettyChannelInputFromHidden(document.getElementById('danger-edits-log-channel'));
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

    syncPrettyChannelInputFromHidden(document.getElementById('reply-thread-introduction-channel'));
    syncPrettyChannelInputFromHidden(document.getElementById('reply-thread-debug-channel'));
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

    syncPrettyChannelInputFromHidden(document.getElementById('onboarding-log-channel'));
    syncPrettyChannelInputFromHidden(document.getElementById('onboarding-welcome-channel'));
    
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

    // Sync upgraded channel selectors (if present)
    ['wow-guild-onboarding-channel', 'wow-guild-welcome-channel', 'wow-guild-log-channel', 'wow-guild-intro-channel']
        .map(id => document.getElementById(id))
        .forEach(el => syncPrettyChannelInputFromHidden(el));
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

    // Sync upgraded channel selectors (if present)
    ['wow-guest-onboarding-channel', 'wow-guest-welcome-channel', 'wow-guest-log-channel', 'wow-guest-intro-channel']
        .map(id => document.getElementById(id))
        .forEach(el => syncPrettyChannelInputFromHidden(el));
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
        if (container.dataset.arrayType === 'channel') {
            addArrayTag(container, value, input, resolveChannelNameById(value));
        } else {
            addArrayTag(container, value, input);
        }
    });
}

function getArrayInputValues(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    
    const tags = container.querySelectorAll('.array-tag');
    return Array.from(tags).map(tag => tag.dataset.value);
}

function addArrayTag(container, value, inputField, displayText) {
    const tag = document.createElement('span');
    tag.className = 'array-tag';
    tag.dataset.value = value;
    
    const label = (displayText !== undefined && displayText !== null) ? String(displayText) : String(value);
    const textNode = document.createTextNode(label + ' ');
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
                if (container.dataset.arrayType === 'channel') {
                    const id = resolveChannelIdFromUserInput(value);
                    if (!id) {
                        showToast('Select a valid channel (or paste its ID)', 'error');
                        input.value = '';
                        return;
                    }
                    addArrayTag(container, id, input, resolveChannelNameById(id));
                } else {
                    addArrayTag(container, value, input);
                }
                input.value = '';
            }
        }
    });
    
    input.addEventListener('blur', () => {
        const value = input.value.trim();
        if (value) {
            if (container.dataset.arrayType === 'channel') {
                const id = resolveChannelIdFromUserInput(value);
                if (!id) {
                    showToast('Select a valid channel (or paste its ID)', 'error');
                    input.value = '';
                    return;
                }
                addArrayTag(container, id, input, resolveChannelNameById(id));
            } else {
                addArrayTag(container, value, input);
            }
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

    let loggingChannelList = document.getElementById('logging-channel-list');
    if (!loggingChannelList) {
        loggingChannelList = document.createElement('datalist');
        loggingChannelList.id = 'logging-channel-list';
        document.body.appendChild(loggingChannelList);
    }
    
    // Sort channels: Text first, then Voice, then others. Alphabetical within type.
    const sortedChannels = [...guildChannels].sort((a, b) => {
        if (a.type !== b.type) return a.type - b.type;
        return a.name.localeCompare(b.name);
    });

    channelList.innerHTML = sortedChannels.map(c => 
        `<option value="${c.id}">${c.name} (${getChannelTypeName(c.type)})</option>`
    ).join('');

    // Logging selector: searchable by name, while we persist IDs under the hood.
    // Keep values as names here so the input displays names instead of IDs.
    loggingChannelList.innerHTML = sortedChannels.map(c =>
        `<option value="${escapeHtml(c.name)}">${c.id} (${getChannelTypeName(c.type)})</option>`
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

                // Upgrade channel array inputs to name-based pretty dropdown (still stores IDs)
                if (listId === 'channel-list' && input) {
                    element.dataset.arrayType = 'channel';
                    attachPrettyChannelDropdown(input, {
                        onPick: (ch) => {
                            addArrayTag(element, ch.id, input, formatChannelDisplayName(ch));
                            input.value = '';
                        }
                    });
                }
            } else {
                element.setAttribute('list', listId);

                // Upgrade single channel ID inputs to pretty selector.
                if (listId === 'channel-list' && element.tagName === 'INPUT') {
                    upgradeSingleChannelIdInput(element);
                }
            }
        }
    }
}
