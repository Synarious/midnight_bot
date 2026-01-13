import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Grid, Stack, Switch, TextField, Typography } from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import axios from 'axios';
import { useSnackbar } from 'notistack';
import { useGuild } from '../context/GuildContext';

const LOG_CHANNEL_KEYS = [
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
    'ch_memberJoin',
];

function humanizeChannelKey(key) {
    return key
        .replace(/^ch_/, '')
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim()
        .replace(/^\w/, (c) => c.toUpperCase());
}

export default function Logging() {
    const { guildId, channels } = useGuild();
    const { enqueueSnackbar } = useSnackbar();
    const [settings, setSettings] = useState({});
    const [loading, setLoading] = useState(false);

    const textChannels = useMemo(() => {
        return (channels || []).filter((ch) => ch.type === 0);
    }, [channels]);

    useEffect(() => {
        if (!guildId) return;
        const fetchSettings = async () => {
            setLoading(true);
            try {
                const response = await axios.get(`/api/guilds/${guildId}/settings`);
                setSettings(response.data.settings || {});
            } catch (error) {
                enqueueSnackbar('Failed to load settings', { variant: 'error' });
            } finally {
                setLoading(false);
            }
        };

        fetchSettings();
    }, [enqueueSnackbar, guildId]);

    const handleSettingChange = async (key, value) => {
        if (!guildId) return;
        try {
            await axios.patch(`/api/guilds/${guildId}/settings`, { [key]: value });
            setSettings((prev) => ({ ...prev, [key]: value }));
            enqueueSnackbar('Setting updated', { variant: 'success' });
        } catch (error) {
            enqueueSnackbar('Failed to update setting', { variant: 'error' });
        }
    };

    if (!guildId) {
        return (
            <Typography variant="h5" color="text.secondary" align="center" sx={{ mt: 4 }}>
                Please enter a Guild ID above.
            </Typography>
        );
    }

    return (
        <Stack spacing={3}>
            <Card>
                <CardContent>
                    <Typography variant="h5" gutterBottom>
                        Logging
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Configure where the bot sends log messages. Use the switch to enable/disable each log.
                    </Typography>
                </CardContent>
            </Card>

            <Card>
                <CardContent>
                    <Typography variant="h6" gutterBottom sx={{ mb: 3 }}>
                        Log Channels
                    </Typography>
                    <Grid container spacing={3}>
                        {LOG_CHANNEL_KEYS.map((channelKey) => {
                            const enableKey = `enable_${channelKey}`;
                            const enabled = settings[enableKey] !== false;
                            const selectedChannel = textChannels.find((ch) => ch.id === settings[channelKey]) || null;

                            return (
                                <Grid item xs={12} md={6} key={channelKey}>
                                    <Card variant="outlined">
                                        <CardContent>
                                            <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                                                {humanizeChannelKey(channelKey)}
                                            </Typography>
                                            <Stack direction="row" alignItems="center" spacing={2}>
                                                <Autocomplete
                                                    fullWidth
                                                    options={textChannels}
                                                    getOptionLabel={(option) => `#${option.name}`}
                                                    value={selectedChannel}
                                                    onChange={(_, newValue) => handleSettingChange(channelKey, newValue?.id || null)}
                                                    renderInput={(params) => (
                                                        <TextField {...params} placeholder="Select channel" size="small" />
                                                    )}
                                                    disabled={!enabled || loading}
                                                />
                                                <Switch
                                                    checked={enabled}
                                                    onChange={(e) => handleSettingChange(enableKey, e.target.checked)}
                                                    disabled={loading}
                                                />
                                            </Stack>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            );
                        })}
                    </Grid>
                </CardContent>
            </Card>
        </Stack>
    );
}
