import React, { useState, useEffect } from 'react';
import { 
  Box, Grid, Card, CardContent, Typography, Stack, 
  Switch, FormControlLabel, TextField, Button, Autocomplete, Chip, MenuItem, Select, InputLabel, FormControl
} from '@mui/material';
import { 
  Group as GroupIcon, 
  PersonAdd as PersonAddIcon, 
  Gavel as GavelIcon, 
  AccessTime as AccessTimeIcon 
} from '@mui/icons-material';
import { useGuild } from '../context/GuildContext';
import axios from 'axios';
import { useSnackbar } from 'notistack';
import RoleSelector from '../components/RoleSelector';

function StatCard({ title, value, icon, color }) {
    return (
        <Card sx={{ height: '100%' }}>
            <CardContent>
                <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                    <Box sx={{ 
                        p: 1.5, 
                        borderRadius: 2, 
                        bgcolor: `${color}.main`, 
                        color: `${color}.contrastText`,
                        display: 'flex',
                        opacity: 0.8
                    }}>
                        {icon}
                    </Box>
                    <Typography variant="subtitle1" color="text.secondary">
                        {title}
                    </Typography>
                </Stack>
                <Typography variant="h4" fontWeight="600">
                    {value}
                </Typography>
            </CardContent>
        </Card>
    );
}


const timezones = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London',
    'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney'
];

function Dashboard() {
    const { guildId, roles, refreshGuildData } = useGuild();
    const { enqueueSnackbar } = useSnackbar();
    const [stats, setStats] = useState({ totalMembers: 0, joinsToday: 0, captchaKicks: 0 });
    const [settings, setSettings] = useState({});
    const [loading, setLoading] = useState(false);

    // Form state for roles
    const [roleConfig, setRoleConfig] = useState({
        roles_super_admin: [],
        roles_admin: [],
        roles_mod: [],
        roles_jr_mod: [],
        roles_helper: [],
        roles_trust: [],
        roles_untrusted: []
    });

    useEffect(() => {
        if (!guildId) return;
        fetchData();
    }, [guildId]);

    const fetchData = async () => {
        try {
            const [statsRes, settingsRes] = await Promise.all([
                axios.get(`/api/guilds/${guildId}/stats`),
                axios.get(`/api/guilds/${guildId}/settings`)
            ]);
            setStats(statsRes.data);
            setSettings(settingsRes.data.settings);
            
            // Map role IDs to Role Objects for Autocomplete
            const roleMap = (roleIds) => {
                if (!roleIds || !Array.isArray(roleIds)) return [];
                return roleIds.map(id => roles.find(r => r.id === id)).filter(Boolean);
            };

            setRoleConfig({
                roles_super_admin: roleMap(settingsRes.data.settings.roles_super_admin),
                roles_admin: roleMap(settingsRes.data.settings.roles_admin),
                roles_mod: roleMap(settingsRes.data.settings.roles_mod),
                roles_jr_mod: roleMap(settingsRes.data.settings.roles_jr_mod),
                roles_helper: roleMap(settingsRes.data.settings.roles_helper),
                roles_trust: roleMap(settingsRes.data.settings.roles_trust),
                roles_untrusted: roleMap(settingsRes.data.settings.roles_untrusted),
            });
        } catch (error) {
            console.error(error);
        }
    };

    // Need to re-map roles when roles loaded/changed
    useEffect(() => {
        if(roles.length > 0 && settings.roles_admin) {
             const roleMap = (roleIds) => {
                if (!roleIds || !Array.isArray(roleIds)) return [];
                return roleIds.map(id => roles.find(r => r.id === id)).filter(Boolean);
            };
             setRoleConfig(prev => ({
                ...prev,
                roles_super_admin: roleMap(settings.roles_super_admin),
                roles_admin: roleMap(settings.roles_admin),
                roles_mod: roleMap(settings.roles_mod),
                roles_jr_mod: roleMap(settings.roles_jr_mod),
                roles_helper: roleMap(settings.roles_helper),
                roles_trust: roleMap(settings.roles_trust),
                roles_untrusted: roleMap(settings.roles_untrusted),
             }));
        }
    }, [roles, settings]);

    const handleRoleChange = (key, newRoles) => {
        setRoleConfig(prev => ({ ...prev, [key]: newRoles }));
    };

    const handleSaveRoles = async () => {
        if (!guildId) return;
        setLoading(true);
        try {
            const payload = {};
            // Convert objects back to IDs
            Object.keys(roleConfig).forEach(key => {
                payload[key] = roleConfig[key].map(r => r.id);
            });

            await axios.patch(`/api/guilds/${guildId}/settings`, payload);
            enqueueSnackbar('Roles updated successfully', { variant: 'success' });
        } catch (error) {
            enqueueSnackbar('Failed to update roles', { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleSettingChange = async (key, value) => {
        if (!guildId) return;
        try {
            await axios.patch(`/api/guilds/${guildId}/settings`, { [key]: value });
            setSettings(prev => ({ ...prev, [key]: value }));
            enqueueSnackbar('Setting updated successfully', { variant: 'success' });
        } catch (error) {
            enqueueSnackbar('Failed to update setting', { variant: 'error' });
        }
    };

    if (!guildId) {
        return <Typography variant="h5" color="text.secondary" align="center" sx={{ mt: 4 }}>Please enter a Guild ID above.</Typography>;
    }

    return (
        <Grid container spacing={3}>
            {/* Stats Grid items are now direct children */}
                <Grid item xs={12} sm={6} md={3}>
                    <StatCard 
                        title="Total Members" 
                        value={stats.totalMembers || '--'} 
                        icon={<GroupIcon />} 
                        color="primary" 
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <StatCard 
                        title="Joins Today" 
                        value={stats.joinsToday || '--'} 
                        icon={<PersonAddIcon />} 
                        color="success" 
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <StatCard 
                        title="Captcha Kicks" 
                        value={stats.captchaKicks || '--'} 
                        icon={<GavelIcon />} 
                        color="error" 
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <StatCard 
                        title="Bot Timezone" 
                        value={stats.timezone || settings.bot_timezone || 'UTC'} 
                        icon={<AccessTimeIcon />} 
                        color="info" 
                    />
                </Grid>

            {/* Bot Configuration */}
            <Grid item xs={12}>
                <Card>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>Bot Configuration</Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Command Prefix"
                                value={settings.cmd_prefix || '!'}
                                onChange={(e) => handleSettingChange('cmd_prefix', e.target.value)}
                                helperText="The prefix used for bot commands"
                                sx={{ mb: 2 }}
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <FormControl fullWidth sx={{ mb: 2 }}>
                                <InputLabel>Bot Timezone</InputLabel>
                                <Select
                                    value={settings.bot_timezone || 'UTC'}
                                    label="Bot Timezone"
                                    onChange={(e) => handleSettingChange('bot_timezone', e.target.value)}
                                >
                                    {timezones.map(tz => (
                                        <MenuItem key={tz} value={tz}>{tz}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12}>
                            <FormControlLabel
                                control={
                                    <Switch 
                                        checked={settings.bot_enabled !== false}
                                        onChange={(e) => handleSettingChange('bot_enabled', e.target.checked)}
                                    />
                                }
                                label="Bot Enabled (disable to stop processing events and commands)"
                            />
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>
            </Grid>

            {/* Role Management */}
            <Grid item xs={12}>
                <Card>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>Role Management</Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                            <RoleSelector 
                                label="Super Admin Roles"
                                value={roleConfig.roles_super_admin}
                                onChange={(v) => handleRoleChange('roles_super_admin', v)}
                                options={roles}
                            />
                            <RoleSelector 
                                label="Admin Roles"
                                value={roleConfig.roles_admin}
                                onChange={(v) => handleRoleChange('roles_admin', v)}
                                options={roles}
                            />
                            <RoleSelector 
                                label="Mod Roles"
                                value={roleConfig.roles_mod}
                                onChange={(v) => handleRoleChange('roles_mod', v)}
                                options={roles}
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <RoleSelector 
                                label="Jr Mod Roles"
                                value={roleConfig.roles_jr_mod}
                                onChange={(v) => handleRoleChange('roles_jr_mod', v)}
                                options={roles}
                            />
                            <RoleSelector 
                                label="Helper Roles"
                                value={roleConfig.roles_helper}
                                onChange={(v) => handleRoleChange('roles_helper', v)}
                                options={roles}
                            />
                             <RoleSelector 
                                label="Trusted Roles"
                                value={roleConfig.roles_trust}
                                onChange={(v) => handleRoleChange('roles_trust', v)}
                                options={roles}
                            />
                             <RoleSelector 
                                label="Untrusted Roles"
                                value={roleConfig.roles_untrusted}
                                onChange={(v) => handleRoleChange('roles_untrusted', v)}
                                options={roles}
                            />
                        </Grid>
                    </Grid>
                    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                        <Button variant="contained" onClick={handleSaveRoles} disabled={loading}>
                            Save Changes
                        </Button>
                    </Box>
                </CardContent>
            </Card>
            </Grid>
        </Grid>
    );
}

export default Dashboard;
