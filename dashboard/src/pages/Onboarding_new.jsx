import React, { useState, useEffect } from 'react';
import {
    Card, CardContent, Typography, Stack, Switch, Grid, TextField, Autocomplete, Chip, Divider, Button, CircularProgress
} from '@mui/material';
import { useGuild } from '../context/GuildContext';
import { useSnackbar } from 'notistack';
import axios from 'axios';

function Onboarding() {
    const { guildId, channels, roles } = useGuild();
    const { enqueueSnackbar } = useSnackbar();
    
    const [loading, setLoading] = useState(false);
    
    // State for different settings
    const [onboardingData, setOnboardingData] = useState({ settings: {}, categories: [], roles: [] });
    const [wowGuildSettings, setWowGuildSettings] = useState({});
    const [wowGuestSettings, setWowGuestSettings] = useState({});

    const textChannels = (channels || []).filter(ch => ch.type === 0);
    const findChannel = (id) => textChannels.find((ch) => String(ch.id) === String(id)) || null;
    const findRole = (id) => (roles || []).find((r) => String(r.id) === String(id)) || null;

    useEffect(() => {
        if (!guildId) return;
        fetchAllSettings();
    }, [guildId]);

    const fetchAllSettings = async () => {
        setLoading(true);
        try {
            const [onboardingRes, wowGuildRes, wowGuestRes] = await Promise.all([
                axios.get(`/api/guilds/${guildId}/onboarding`),
                axios.get(`/api/guilds/${guildId}/wow-guild`),
                axios.get(`/api/guilds/${guildId}/wow-guest`)
            ]);

            setOnboardingData(onboardingRes.data.data || { settings: {}, categories: [], roles: [] });
            setWowGuildSettings(wowGuildRes.data.settings || {});
            setWowGuestSettings(wowGuestRes.data.settings || {});

        } catch (error) {
            console.error(error);
            enqueueSnackbar('Failed to load onboarding configurations', { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    // Update handlers
    const updateOnboarding = async (updates) => {
        try {
            const newSettings = { ...onboardingData.settings, ...updates };
            await axios.put(`/api/guilds/${guildId}/onboarding`, { settings: newSettings });
            setOnboardingData(prev => ({ ...prev, settings: newSettings }));
            enqueueSnackbar('Onboarding settings updated', { variant: 'success' });
        } catch (error) {
            enqueueSnackbar('Failed to update settings', { variant: 'error' });
        }
    };

    const updateWowGuild = async (updates) => {
        try {
            const newSettings = { ...wowGuildSettings, ...updates };
            await axios.put(`/api/guilds/${guildId}/wow-guild`, newSettings);
            setWowGuildSettings(newSettings);
            enqueueSnackbar('WoW Guild settings updated', { variant: 'success' });
        } catch (error) {
            enqueueSnackbar('Failed to update WoW Guild settings', { variant: 'error' });
        }
    };

    const updateWowGuest = async (updates) => {
        try {
            const newSettings = { ...wowGuestSettings, ...updates };
            await axios.put(`/api/guilds/${guildId}/wow-guest`, newSettings);
            setWowGuestSettings(newSettings);
            enqueueSnackbar('WoW Guest settings updated', { variant: 'success' });
        } catch (error) {
            enqueueSnackbar('Failed to update WoW Guest settings', { variant: 'error' });
        }
    };

    if (!guildId) {
        return (
            <Typography variant="h5" color="text.secondary" align="center" sx={{ mt: 4 }}>
                Please enter a Guild ID above.
            </Typography>
        );
    }

    if (loading && !onboardingData.settings) {
        return <CircularProgress sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
    }

    const { settings: obs } = onboardingData;

    return (
        <Stack spacing={3}>
            <Card>
                <CardContent>
                    <Typography variant="h5" gutterBottom>Onboarding Configuration</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Configure how new members join and verify in your server.
                    </Typography>
                </CardContent>
            </Card>

            <Grid container spacing={3}>
                {/* GLOBAL ONBOARDING SETTINGS */}
                <Grid item xs={12} lg={6}>
                    <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
                                <Switch
                                    checked={obs.enabled !== false}
                                    onChange={(e) => updateOnboarding({ enabled: e.target.checked })}
                                />
                                <Typography variant="h6">Global Onboarding</Typography>
                            </Stack>
                            
                            <Stack spacing={2}>
                                <Typography variant="body2" color="text.secondary">
                                    Base settings for server onboarding. Defines the gate role and logging.
                                </Typography>

                                <Autocomplete
                                    options={roles}
                                    getOptionLabel={(option) => option.name}
                                    isOptionEqualToValue={(option, val) => String(option.id) === String(val.id)}
                                    value={findRole(obs.gate_role_id)}
                                    onChange={(_, v) => updateOnboarding({ gate_role_id: v?.id || null })}
                                    renderInput={(params) => <TextField {...params} label="Gate Role (Unverified)" />}
                                    disabled={obs.enabled === false}
                                />

                                <Autocomplete
                                    options={textChannels}
                                    getOptionLabel={(option) => `#${option.name}`}
                                    isOptionEqualToValue={(option, val) => String(option.id) === String(val.id)}
                                    value={findChannel(obs.log_channel_id)}
                                    onChange={(_, v) => updateOnboarding({ log_channel_id: v?.id || null })}
                                    renderInput={(params) => <TextField {...params} label="Log Channel" />}
                                    disabled={obs.enabled === false}
                                />

                                <Autocomplete
                                    options={textChannels}
                                    getOptionLabel={(option) => `#${option.name}`}
                                    isOptionEqualToValue={(option, val) => String(option.id) === String(val.id)}
                                    value={findChannel(obs.welcome_channel_id)}
                                    onChange={(_, v) => updateOnboarding({ welcome_channel_id: v?.id || null })}
                                    renderInput={(params) => <TextField {...params} label="Welcome Channel" />}
                                    disabled={obs.enabled === false}
                                />
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>

                 {/* WOW GUILD SETTINGS */}
                 <Grid item xs={12} lg={6}>
                    <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
                                <Switch
                                    checked={wowGuildSettings.enabled !== false}
                                    onChange={(e) => updateWowGuild({ enabled: e.target.checked })}
                                />
                                <Typography variant="h6">WoW Guild Onboarding</Typography>
                            </Stack>
                            
                            <Stack spacing={2}>
                                <Typography variant="body2" color="text.secondary">
                                    Workflow for verifying guild members via code.
                                </Typography>

                                <TextField
                                    label="Onboarding Code"
                                    value={wowGuildSettings.onboarding_code || ''}
                                    onChange={(e) => updateWowGuild({ onboarding_code: e.target.value })}
                                    disabled={wowGuildSettings.enabled === false}
                                    helperText="Code members must enter to join"
                                />

                                <Autocomplete
                                    options={roles}
                                    getOptionLabel={(option) => option.name}
                                    isOptionEqualToValue={(option, val) => String(option.id) === String(val.id)}
                                    value={findRole(wowGuildSettings.wow_member_role_id)}
                                    onChange={(_, v) => updateWowGuild({ wow_member_role_id: v?.id || null })}
                                    renderInput={(params) => <TextField {...params} label="Member Role" />}
                                    disabled={wowGuildSettings.enabled === false}
                                />
                                
                                <Autocomplete
                                    options={textChannels}
                                    getOptionLabel={(option) => `#${option.name}`}
                                    value={findChannel(wowGuildSettings.onboarding_channel_id)}
                                    onChange={(_, v) => updateWowGuild({ onboarding_channel_id: v?.id || null })}
                                    renderInput={(params) => <TextField {...params} label="Onboarding Channel" />}
                                    disabled={wowGuildSettings.enabled === false}
                                />

                                <TextField
                                    label="Welcome Message"
                                    multiline
                                    rows={2}
                                    value={wowGuildSettings.welcome_message || ''}
                                    onChange={(e) => updateWowGuild({ welcome_message: e.target.value })}
                                    disabled={wowGuildSettings.enabled === false}
                                />

                                <TextField
                                    label="Code Prompt Message"
                                    value={wowGuildSettings.code_prompt_message || ''}
                                    onChange={(e) => updateWowGuild({ code_prompt_message: e.target.value })}
                                    disabled={wowGuildSettings.enabled === false}
                                />
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>

                {/* WOW GUEST SETTINGS */}
                <Grid item xs={12} lg={6}>
                    <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
                                <Switch
                                    checked={wowGuestSettings.enabled !== false}
                                    onChange={(e) => updateWowGuest({ enabled: e.target.checked })}
                                />
                                <Typography variant="h6">WoW Guest Onboarding</Typography>
                            </Stack>
                            
                            <Stack spacing={2}>
                                <Typography variant="body2" color="text.secondary">
                                    Workflow for guests/visitors using a button.
                                </Typography>

                                <Autocomplete
                                    options={roles}
                                    getOptionLabel={(option) => option.name}
                                    value={findRole(wowGuestSettings.guest_role_id)}
                                    onChange={(_, v) => updateWowGuest({ guest_role_id: v?.id || null })}
                                    renderInput={(params) => <TextField {...params} label="Guest Role" />}
                                    disabled={wowGuestSettings.enabled === false}
                                />

                                <Autocomplete
                                    options={textChannels}
                                    getOptionLabel={(option) => `#${option.name}`}
                                    value={findChannel(wowGuestSettings.onboarding_channel_id)}
                                    onChange={(_, v) => updateWowGuest({ onboarding_channel_id: v?.id || null })}
                                    renderInput={(params) => <TextField {...params} label="Onboarding Channel" />}
                                    disabled={wowGuestSettings.enabled === false}
                                />

                                <TextField
                                    label="Welcome Message"
                                    multiline
                                    rows={2}
                                    value={wowGuestSettings.welcome_message || ''}
                                    onChange={(e) => updateWowGuest({ welcome_message: e.target.value })}
                                    disabled={wowGuestSettings.enabled === false}
                                />

                                <TextField
                                    label="Button Label"
                                    value={wowGuestSettings.button_label || ''}
                                    onChange={(e) => updateWowGuest({ button_label: e.target.value })}
                                    disabled={wowGuestSettings.enabled === false}
                                />
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Stack>
    );
}

export default Onboarding;
