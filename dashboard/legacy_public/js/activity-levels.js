/**
 * Activity and Leveling Dashboard Features
 * Handles activity charts and leveling system UI
 */

let messageChart, voiceChart, topMessagesChart, topVoiceChart;

// ==================== ACTIVITY DASHBOARD ====================

async function loadActivitySection(guildId) {
    if (!guildId) return;
    
    const days = parseInt(document.getElementById('activity-days-range')?.value || 90);
    
    try {
        // Load activity stats
        const statsResponse = await authenticatedFetch(`/api/guilds/${guildId}/activity/stats?days=${days}`);
        const { activity } = await statsResponse.json();
        
        // Load top members
        const topMessagesResponse = await authenticatedFetch(`/api/guilds/${guildId}/activity/top-messages?days=${days}&limit=20`);
        const { members: topMessages } = await topMessagesResponse.json();
        
        const topVoiceResponse = await authenticatedFetch(`/api/guilds/${guildId}/activity/top-voice?days=${days}&limit=20`);
        const { members: topVoice } = await topVoiceResponse.json();
        
        // Render activity charts
        renderActivityCharts(activity);
        
        // Render pie charts
        renderTopMessagesChart(topMessages);
        renderTopVoiceChart(topVoice);
        
    } catch (error) {
        console.error('Error loading activity section:', error);
        showToast('Failed to load activity data', 'error');
    }
}

function renderActivityCharts(data) {
    renderMessageChart(data);
    renderVoiceChart(data);
}

function renderMessageChart(data) {
    const ctx = document.getElementById('message-activity-chart');
    if (!ctx) return;
    
    if (messageChart) {
        messageChart.destroy();
    }
    
    const labels = data.map(d => d.date);
    const messages = data.map(d => d.messages || 0);
    const joins = data.map(d => d.joins || 0);
    const leaves = data.map(d => d.leaves || 0);
    
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false
        },
        plugins: {
            zoom: {
                pan: {
                    enabled: true,
                    mode: 'x'
                },
                zoom: {
                    wheel: {
                        enabled: true
                    },
                    pinch: {
                        enabled: true
                    },
                    mode: 'x'
                }
            },
            legend: {
                labels: { color: '#9ca3af' }
            },
            title: {
                display: false
            }
        },
        scales: {
            x: {
                ticks: { color: '#9ca3af' },
                grid: { color: '#374151' }
            }
        }
    };

    messageChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Messages',
                    data: messages,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    yAxisID: 'y',
                    tension: 0.3
                },
                {
                    label: 'Joins',
                    data: joins,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    yAxisID: 'y1',
                    tension: 0.3
                },
                {
                    label: 'Leaves',
                    data: leaves,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    yAxisID: 'y1',
                    tension: 0.3
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Messages',
                        color: '#9ca3af'
                    },
                    ticks: { color: '#9ca3af' },
                    grid: { color: '#374151' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Joins / Leaves',
                        color: '#9ca3af'
                    },
                    ticks: { color: '#9ca3af' },
                    grid: { display: false }
                }
            }
        }
    });
}

function renderVoiceChart(data) {
    const ctx = document.getElementById('voice-activity-chart');
    if (!ctx) return;
    
    if (voiceChart) {
        voiceChart.destroy();
    }
    
    const labels = data.map(d => d.date);
    const voice = data.map(d => d.voice_minutes || 0);

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false
        },
        plugins: {
            zoom: {
                pan: {
                    enabled: true,
                    mode: 'x'
                },
                zoom: {
                    wheel: {
                        enabled: true
                    },
                    pinch: {
                        enabled: true
                    },
                    mode: 'x'
                }
            },
            legend: {
                labels: { color: '#9ca3af' }
            },
            title: {
                display: false
            }
        },
        scales: {
            x: {
                ticks: { color: '#9ca3af' },
                grid: { color: '#374151' }
            }
        }
    };
    
    voiceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Voice Minutes',
                    data: voice,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    yAxisID: 'y',
                    tension: 0.3
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Voice Minutes',
                        color: '#9ca3af'
                    },
                    ticks: { color: '#9ca3af' },
                    grid: { color: '#374151' }
                }
            }
        }
    });
}

function renderTopMessagesChart(data) {
    const ctx = document.getElementById('top-messages-chart');
    if (!ctx) return;
    
    if (topMessagesChart) {
        topMessagesChart.destroy();
    }
    
    const labels = data.map((d, i) => `#${i + 1}`);
    const values = data.map(d => d.total_messages);
    
    topMessagesChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: generateColors(data.length)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#9ca3af', font: { size: 10 } }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const userId = data[context.dataIndex]?.user_id || 'Unknown';
                            return `User ${userId}: ${context.parsed} messages`;
                        }
                    }
                }
            }
        }
    });
}

function renderTopVoiceChart(data) {
    const ctx = document.getElementById('top-voice-chart');
    if (!ctx) return;
    
    if (topVoiceChart) {
        topVoiceChart.destroy();
    }
    
    const labels = data.map((d, i) => `#${i + 1}`);
    const values = data.map(d => d.total_minutes);
    
    topVoiceChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: generateColors(data.length)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#9ca3af', font: { size: 10 } }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const userId = data[context.dataIndex]?.user_id || 'Unknown';
                            const hours = Math.floor(context.parsed / 60);
                            const mins = context.parsed % 60;
                            return `User ${userId}: ${hours}h ${mins}m`;
                        }
                    }
                }
            }
        }
    });
}

function generateColors(count) {
    const colors = [
        '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b',
        '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
        '#6366f1', '#a855f7', '#d946ef', '#e11d48', '#dc2626',
        '#ea580c', '#ca8a04', '#65a30d', '#16a34a', '#059669'
    ];
    return colors.slice(0, count);
}

// ==================== LEVELING DASHBOARD ====================

async function loadLevelsSection(guildId) {
    if (!guildId) return;
    
    try {
        // Load leaderboard
        const leaderboardResponse = await authenticatedFetch(`/api/guilds/${guildId}/leveling/leaderboard?limit=100`);
        const { leaderboard } = await leaderboardResponse.json();
        
        // Load config
        const configResponse = await authenticatedFetch(`/api/guilds/${guildId}/leveling/config`);
        const { config } = await configResponse.json();
        
        // Load roles
        const rolesResponse = await authenticatedFetch(`/api/guilds/${guildId}/leveling/roles`);
        const { roles } = await rolesResponse.json();
        
        // Render
        renderLeaderboard(leaderboard);
        renderLevelingConfig(config);
        renderLevelingRoles(roles);
        
    } catch (error) {
        console.error('Error loading levels section:', error);
        showToast('Failed to load leveling data', 'error');
    }
}

function renderLeaderboard(data) {
    const tbody = document.getElementById('leaderboard-table');
    if (!tbody) return;
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-400 py-4">No leveling data yet</td></tr>';
        return;
    }
    
    tbody.innerHTML = data.map((member, index) => `
        <tr>
            <td class="font-bold text-indigo-400">${index + 1}</td>
            <td class="font-mono text-sm">${member.user_id}</td>
            <td><span class="badge badge-primary">Level ${member.level}</span></td>
            <td>${member.msg_exp.toLocaleString()}</td>
            <td>${member.voice_exp.toLocaleString()}</td>
            <td class="font-bold">${member.total_exp.toLocaleString()}</td>
        </tr>
    `).join('');
}

function renderLevelingConfig(config) {
    document.getElementById('rolling-period-days').value = config.rolling_period_days || 90;
    document.getElementById('anti-spam-level').value = config.anti_spam_level || 'soft';
    document.getElementById('exclude-bots').checked = config.exclude_bots !== false;
    document.getElementById('exclude-muted').checked = config.exclude_muted || false;
    document.getElementById('exclude-deafened').checked = config.exclude_deafened || false;
    document.getElementById('remove-previous-role').checked = config.remove_previous_role || false;
}

function renderLevelingRoles(roles) {
    const tbody = document.getElementById('leveling-roles-table');
    if (!tbody) return;
    
    if (roles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-400 py-4">No leveling roles configured</td></tr>';
        return;
    }
    
    tbody.innerHTML = roles.map(role => `
        <tr>
            <td class="font-mono text-sm">${role.role_id}</td>
            <td>${role.msg_exp_requirement.toLocaleString()}</td>
            <td>${role.voice_exp_requirement.toLocaleString()}</td>
            <td><span class="badge ${role.logic_operator === 'AND' ? 'badge-warning' : 'badge-info'}">${role.logic_operator}</span></td>
            <td>${role.rolling_period_days} days</td>
            <td>
                <button class="btn-icon" onclick="deleteLevelingRole('${role.role_id}')" title="Delete">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                </button>
            </td>
        </tr>
    `).join('');
}

async function deleteLevelingRole(roleId) {
    const guildId = document.getElementById('guild-id-input').value;
    if (!guildId || !confirm('Delete this leveling role?')) return;
    
    try {
        await authenticatedFetch(`/api/guilds/${guildId}/leveling/roles/${roleId}`, { method: 'DELETE' });
        showToast('Leveling role deleted', 'success');
        loadLevelsSection(guildId);
    } catch (error) {
        console.error('Error deleting leveling role:', error);
        showToast('Failed to delete leveling role', 'error');
    }
}

// ==================== EVENT HANDLERS ====================

function setupActivityHandlers() {
    // Activity days range change
    document.getElementById('activity-days-range')?.addEventListener('change', (e) => {
        const guildId = document.getElementById('guild-id-input').value;
        if (guildId) loadActivitySection(guildId);
    });
    
    // Leveling config form
    document.getElementById('leveling-config-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const guildId = document.getElementById('guild-id-input').value;
        if (!guildId) return;
        
        const config = {
            rolling_period_days: parseInt(document.getElementById('rolling-period-days').value),
            anti_spam_level: document.getElementById('anti-spam-level').value,
            exclude_bots: document.getElementById('exclude-bots').checked,
            exclude_muted: document.getElementById('exclude-muted').checked,
            exclude_deafened: document.getElementById('exclude-deafened').checked,
            remove_previous_role: document.getElementById('remove-previous-role').checked
        };
        
        try {
            await authenticatedFetch(`/api/guilds/${guildId}/leveling/config`, {
                method: 'POST',
                body: JSON.stringify(config)
            });
            showToast('Leveling configuration saved', 'success');
        } catch (error) {
            console.error('Error saving leveling config:', error);
            showToast('Failed to save leveling configuration', 'error');
        }
    });
    
    // Add leveling role form
    document.getElementById('add-leveling-role-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const guildId = document.getElementById('guild-id-input').value;
        if (!guildId) return;
        
        const role = {
            role_id: document.getElementById('new-role-id').value,
            msg_exp_requirement: parseInt(document.getElementById('new-msg-xp').value),
            voice_exp_requirement: parseInt(document.getElementById('new-voice-xp').value),
            logic_operator: document.getElementById('new-logic-operator').value,
            rolling_period_days: parseInt(document.getElementById('new-rolling-period').value)
        };
        
        try {
            await authenticatedFetch(`/api/guilds/${guildId}/leveling/roles`, {
                method: 'POST',
                body: JSON.stringify(role)
            });
            showToast('Leveling role added', 'success');
            e.target.reset();
            loadLevelsSection(guildId);
        } catch (error) {
            console.error('Error adding leveling role:', error);
            showToast('Failed to add leveling role', 'error');
        }
    });
}

// Initialize on page load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', setupActivityHandlers);
    window.loadActivitySection = loadActivitySection;
    window.loadLevelsSection = loadLevelsSection;
    window.deleteLevelingRole = deleteLevelingRole;
}
