import React, { useState, useEffect } from 'react';
import {
    Card, CardContent, Typography, Stack, Switch, Grid, TextField, Autocomplete, Chip, Button, Dialog, DialogTitle, DialogContent, DialogActions, Box, Divider,
    FormControlLabel, Checkbox
} from '@mui/material';
import { useGuild } from '../context/GuildContext';
import { useSnackbar } from 'notistack';
import axios from 'axios';

function Modules() {
    const { guildId, roles, channels } = useGuild();
    const { enqueueSnackbar } = useSnackbar();
    
    // States
    const [settings, setSettings] = useState({});
    const [levelingConfig, setLevelingConfig] = useState({});
    const [replyThreadSettings, setReplyThreadSettings] = useState({});
    const [dangerEditsSettings, setDangerEditsSettings] = useState({});
    const [loading, setLoading] = useState(false);

    // Dialogs
    const [levelingOpen, setLevelingOpen] = useState(false);
    const [economyOpen, setEconomyOpen] = useState(false);
    const [roleMenusOpen, setRoleMenusOpen] = useState(false);
    const [autoRoleOpen, setAutoRoleOpen] = useState(false);
    const [replyThreadOpen, setReplyThreadOpen] = useState(false);
    const [dangerEditsOpen, setDangerEditsOpen] = useState(false);

    const textChannels = (channels || []).filter(ch => ch.type === 0);
    const voiceChannels = (channels || []).filter(ch => ch.type === 2);
    const findChannel = (id) => textChannels.find((ch) => String(ch.id) === String(id)) || null;
    const findVoiceChannel = (id) => voiceChannels.find((ch) => String(ch.id) === String(id)) || null;
    const findRole = (id) => (roles || []).find((r) => String(r.id) === String(id)) || null;

    useEffect(() => {
        if (!guildId) return;
        fetchAllData();
    }, [guildId]);

    const fetchAllData = async () => {
        setLoading(true);
        try {
            const [settingsRes, levelingRes, replyRes, dangerRes] = await Promise.all([
                axios.get(`/api/guilds/${guildId}/settings`),
                axios.get(`/api/guilds/${guildId}/leveling/config`).catch(() => ({ data: { config: {} } })),
                axios.get(`/api/guilds/${guildId}/reply-thread`).catch(() => ({ data: { settings: {} } })),
                axios.get(`/api/guilds/${guildId}/automod/no-danger-edits`).catch(() => ({ data: { settings: {} } }))
            ]);

            setSettings(settingsRes.data.settings || {});
            setLevelingConfig(levelingRes.data.config || {});
            setReplyThreadSettings(replyRes.data.settings || {});
            setDangerEditsSettings(dangerRes.data.settings || {});
        } catch (error) {
            enqueueSnackbar('Failed to load settings', { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleSettingChange = async (key, value) => {
        if (!guildId) return;
        try {
            await axios.patch(`/api/guilds/${guildId}/settings`, { [key]: value });
            setSettings(prev => ({ ...prev, [key]: value }));
            enqueueSnackbar('Setting updated', { variant: 'success' });
        } catch (error) {
            enqueueSnackbar('Failed to update setting', { variant: 'error' });
        }
    };

    const saveLevelingConfig = async () => {
        try {
            await axios.post(`/api/guilds/${guildId}/leveling/config`, levelingConfig);
            enqueueSnackbar('Leveling settings saved', { variant: 'success' });
            setLevelingOpen(false);
        } catch (error) {
            enqueueSnackbar('Failed to save leveling settings', { variant: 'error' });
        }
    };

    const saveReplyThread = async () => {
         try {
            await axios.put(`/api/guilds/${guildId}/reply-thread`, replyThreadSettings);
            enqueueSnackbar('Reply Thread settings saved', { variant: 'success' });
            setReplyThreadOpen(false);
        } catch (error) {
            enqueueSnackbar('Failed to save settings', { variant: 'error' });
        }
    };

    const saveDangerEdits = async () => {
         try {
            await axios.put(`/api/guilds/${guildId}/automod/no-danger-edits`, dangerEditsSettings);
            enqueueSnackbar('Danger Edits settings saved', { variant: 'success' });
            setDangerEditsOpen(false);
        } catch (error) {
            enqueueSnackbar('Failed to save settings', { variant: 'error' });
        }
    };

    const isEnabled = (value) => value !== false;

    if (!guildId) {
        return (
            <Typography variant="h5" color="text.secondary" align="center" sx={{ mt: 4 }}>
                Please enter a Guild ID above.
            </Typography>
        );
    }

    return (
        <>
        <Grid container spacing={3}>
             <Grid item xs={12}>
                <Card>
                    <CardContent>
                        <Typography variant="h5" gutterBottom>Feature Modules</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Enable and configure various bot features and modules.
                        </Typography>
                    </CardContent>
                </Card>
            </Grid>

            {/* Leveling */}
            <Grid item xs={12} sm={6} lg={4}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                        <Stack direction="row" spacing={2} alignItems="flex-start">
                            <Switch
                                checked={isEnabled(settings.enable_leveling)}
                                onChange={(e) => handleSettingChange('enable_leveling', e.target.checked)}
                                disabled={loading}
                            />
                            <Stack spacing={1} sx={{ flexGrow: 1 }}>
                                <Typography variant="subtitle1" fontWeight="medium">Leveling System</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Members earn XP for sending messages.
                                </Typography>
                                <Button variant="outlined" size="small" onClick={() => setLevelingOpen(true)}>
                                    Configure
                                </Button>
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
            </Grid>

            {/* Economy */}
            <Grid item xs={12} sm={6} lg={4}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                        <Stack direction="row" spacing={2} alignItems="flex-start">
                            <Switch
                                checked={isEnabled(settings.enable_economy)}
                                onChange={(e) => handleSettingChange('enable_economy', e.target.checked)}
                                disabled={loading}
                            />
                            <Stack spacing={1} sx={{ flexGrow: 1 }}>
                                <Typography variant="subtitle1" fontWeight="medium">Economy System</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Members can earn currency through work, crime, etc.
                                </Typography>
                                <Button variant="outlined" size="small" onClick={() => setEconomyOpen(true)}>
                                    Configure
                                </Button>
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
            </Grid>

            {/* Role Menus */}
            <Grid item xs={12} sm={6} lg={4}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                        <Stack direction="row" spacing={2} alignItems="flex-start">
                            <Switch
                                checked={isEnabled(settings.enable_role_menus)}
                                onChange={(e) => handleSettingChange('enable_role_menus', e.target.checked)}
                                disabled={loading}
                            />
                            <Stack spacing={1} sx={{ flexGrow: 1 }}>
                                <Typography variant="subtitle1" fontWeight="medium">Role Menus</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Interactive role assignment menus.
                                </Typography>
                                <Button variant="outlined" size="small" onClick={() => setRoleMenusOpen(true)}>
                                    Configure
                                </Button>
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
            </Grid>

             {/* Auto Role */}
             <Grid item xs={12} sm={6} lg={4}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                        <Stack direction="row" spacing={2} alignItems="flex-start">
                            <Switch
                                checked={settings.auto_role_enabled === true}
                                onChange={(e) => handleSettingChange('auto_role_enabled', e.target.checked)}
                                disabled={loading}
                            />
                            <Stack spacing={1} sx={{ flexGrow: 1 }}>
                                <Typography variant="subtitle1" fontWeight="medium">Auto Role</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Automatically assign a role to new members.
                                </Typography>
                                <Button variant="outlined" size="small" onClick={() => setAutoRoleOpen(true)}>
                                    Configure
                                </Button>
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
            </Grid>

            {/* Reply Threads */}
            <Grid item xs={12} sm={6} lg={4}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                        <Stack direction="row" spacing={2} alignItems="flex-start">
                             <Switch
                                checked={replyThreadSettings.enabled !== false}
                                onChange={(e) => {
                                    setReplyThreadSettings(prev => ({ ...prev, enabled: e.target.checked }));
                                    handleSettingChange('enable_reply_threads', e.target.checked); // Sync with main setting if needed, but local state manages dialog
                                }}
                            />
                            <Stack spacing={1} sx={{ flexGrow: 1 }}>
                                <Typography variant="subtitle1" fontWeight="medium">Reply Threads</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Auto-threads for replies.
                                </Typography>
                                <Button variant="outlined" size="small" onClick={() => setReplyThreadOpen(true)}>
                                    Configure
                                </Button>
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
            </Grid>

             {/* Danger Edits */}
             <Grid item xs={12} sm={6} lg={4}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                        <Stack direction="row" spacing={2} alignItems="flex-start">
                             <Switch
                                checked={dangerEditsSettings.enabled !== false}
                                onChange={(e) => setDangerEditsSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                            />
                            <Stack spacing={1} sx={{ flexGrow: 1 }}>
                                <Typography variant="subtitle1" fontWeight="medium">Danger Edits</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Prevent dangerous message edits.
                                </Typography>
                                <Button variant="outlined" size="small" onClick={() => setDangerEditsOpen(true)}>
                                    Configure
                                </Button>
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
            </Grid>
        </Grid>

        {/* Leveling Dialog */}
        <Dialog open={levelingOpen} onClose={() => setLevelingOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Leveling Configuration</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography>Enable Leveling</Typography>
                        <Switch
                            checked={isEnabled(settings.enable_leveling)}
                            onChange={(e) => handleSettingChange('enable_leveling', e.target.checked)}
                        />
                    </Stack>
                    
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>General</Typography>
                    <TextField
                        label="Rolling Period (Days)"
                        type="number"
                        value={levelingConfig.rolling_period_days || 30}
                        onChange={(e) => setLevelingConfig(prev => ({ ...prev, rolling_period_days: parseInt(e.target.value) }))}
                        fullWidth
                    />
                    
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>Exclusions</Typography>
                    <FormControlLabel
                        control={<Checkbox checked={levelingConfig.exclude_bots !== false} onChange={(e) => setLevelingConfig(prev => ({ ...prev, exclude_bots: e.target.checked }))} />}
                        label="Exclude Bots"
                    />
                     <FormControlLabel
                        control={<Checkbox checked={levelingConfig.exclude_muted !== false} onChange={(e) => setLevelingConfig(prev => ({ ...prev, exclude_muted: e.target.checked }))} />}
                        label="Exclude Muted Users"
                    />
                    
                     <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>Ignored Channels</Typography>
                     <Autocomplete
                        multiple
                        options={textChannels}
                        getOptionLabel={(option) => `#${option.name}`}
                        value={textChannels.filter(ch => (levelingConfig.excluded_message_channels || []).includes(ch.id))}
                        onChange={(_, v) => setLevelingConfig(prev => ({ ...prev, excluded_message_channels: v.map(c => c.id) }))}
                        renderInput={(params) => <TextField {...params} label="Ignored Text Channels" placeholder="Select channels" />}
                    />
                     <Autocomplete
                        multiple
                        options={voiceChannels}
                        getOptionLabel={(option) => `🔊 ${option.name}`}
                        value={voiceChannels.filter(ch => (levelingConfig.excluded_voice_channels || []).includes(ch.id))}
                        onChange={(_, v) => setLevelingConfig(prev => ({ ...prev, excluded_voice_channels: v.map(c => c.id) }))}
                        renderInput={(params) => <TextField {...params} label="Ignored Voice Channels" placeholder="Select channels" />}
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setLevelingOpen(false)}>Cancel</Button>
                <Button onClick={saveLevelingConfig} variant="contained">Save</Button>
            </DialogActions>
        </Dialog>

        {/* Economy Dialog */}
        <Dialog open={economyOpen} onClose={() => setEconomyOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Economy Configuration</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography>Enable Economy</Typography>
                        <Switch
                            checked={isEnabled(settings.enable_economy)}
                            onChange={(e) => handleSettingChange('enable_economy', e.target.checked)}
                        />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                        Advanced economy settings (currency name, starting balance, etc.) are currently managed via bot commands or config files.
                    </Typography>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setEconomyOpen(false)}>Close</Button>
            </DialogActions>
        </Dialog>

        {/* Role Menus Dialog */}
        <Dialog open={roleMenusOpen} onClose={() => setRoleMenusOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Role Menus Configuration</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography>Enable Role Menus</Typography>
                        <Switch
                            checked={isEnabled(settings.enable_role_menus)}
                            onChange={(e) => handleSettingChange('enable_role_menus', e.target.checked)}
                        />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                        Role menus allow users to self-assign roles. 
                        Please use the <code>/rolemenu</code> command in Discord to create and manage menus.
                    </Typography>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setRoleMenusOpen(false)}>Close</Button>
            </DialogActions>
        </Dialog>

        {/* Auto Role Dialog */}
        <Dialog open={autoRoleOpen} onClose={() => setAutoRoleOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Auto Role Configuration</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography>Enable Auto Role</Typography>
                        <Switch
                            checked={settings.auto_role_enabled === true}
                            onChange={(e) => handleSettingChange('auto_role_enabled', e.target.checked)}
                        />
                    </Stack>
                    <Autocomplete
                        options={roles}
                        getOptionLabel={(option) => option.name}
                        value={findRole(settings.auto_role_id)}
                        onChange={(_, v) => handleSettingChange('auto_role_id', v?.id || null)}
                        renderInput={(params) => <TextField {...params} label="Role to Assign" helperText="This role will be given to new members immediately upon joining." />}
                        disabled={settings.auto_role_enabled !== true}
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setAutoRoleOpen(false)}>Close</Button>
            </DialogActions>
        </Dialog>

        {/* Reply Threads Dialog */}
        <Dialog open={replyThreadOpen} onClose={() => setReplyThreadOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Reply Threads Configuration</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3}>
                     <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography>Enable Module</Typography>
                        <Switch
                            checked={replyThreadSettings.enabled !== false}
                            onChange={(e) => setReplyThreadSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                        />
                    </Stack>
                    <TextField
                        label="Dating Phrases Regex"
                        value={replyThreadSettings.dating_phrases_regex || ''}
                        onChange={(e) => setReplyThreadSettings(prev => ({ ...prev, dating_phrases_regex: e.target.value }))}
                        helperText="Regex for dating phrases detection"
                        fullWidth
                    />
                    <Autocomplete
                        options={textChannels}
                        getOptionLabel={(option) => `#${option.name}`}
                        value={findChannel(replyThreadSettings.introduction_channel_id)}
                        onChange={(_, v) => setReplyThreadSettings(prev => ({ ...prev, introduction_channel_id: v?.id || null }))}
                        renderInput={(params) => <TextField {...params} label="Introduction Channel" />}
                    />
                     <Autocomplete
                        options={textChannels}
                        getOptionLabel={(option) => `#${option.name}`}
                        value={findChannel(replyThreadSettings.debug_channel_id)}
                        onChange={(_, v) => setReplyThreadSettings(prev => ({ ...prev, debug_channel_id: v?.id || null }))}
                        renderInput={(params) => <TextField {...params} label="Debug Channel" />}
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setReplyThreadOpen(false)}>Cancel</Button>
                <Button onClick={saveReplyThread} variant="contained">Save</Button>
            </DialogActions>
        </Dialog>

        {/* Danger Edits Dialog */}
        <Dialog open={dangerEditsOpen} onClose={() => setDangerEditsOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Danger Edits Configuration</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3}>
                     <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography>Enable Module</Typography>
                        <Switch
                            checked={dangerEditsSettings.enabled !== false}
                            onChange={(e) => setDangerEditsSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                        />
                    </Stack>
                     <TextField
                        label="Forbidden Words Regex"
                        value={dangerEditsSettings.forbidden_words_regex || ''}
                        onChange={(e) => setDangerEditsSettings(prev => ({ ...prev, forbidden_words_regex: e.target.value }))}
                        helperText="Regex for forbidden words in edits"
                        fullWidth
                    />
                     <Stack direction="row" spacing={2}>
                        <TextField
                            label="Mute Duration (Minutes)"
                            type="number"
                            value={dangerEditsSettings.mute_duration_minutes || 60}
                            onChange={(e) => setDangerEditsSettings(prev => ({ ...prev, mute_duration_minutes: parseInt(e.target.value) }))}
                            fullWidth
                        />
                         <Stack direction="row" alignItems="center">
                             <Typography variant="body2" sx={{ mr: 1 }}>Mute User</Typography>
                             <Switch
                                checked={dangerEditsSettings.mute_user !== false}
                                onChange={(e) => setDangerEditsSettings(prev => ({ ...prev, mute_user: e.target.checked }))}
                            />
                         </Stack>
                    </Stack>
                     <Autocomplete
                        options={textChannels}
                        getOptionLabel={(option) => `#${option.name}`}
                        value={findChannel(dangerEditsSettings.log_channel_id)}
                        onChange={(_, v) => setDangerEditsSettings(prev => ({ ...prev, log_channel_id: v?.id || null }))}
                        renderInput={(params) => <TextField {...params} label="Log Channel" />}
                    />
                </Stack>
            </DialogContent>
             <DialogActions>
                <Button onClick={() => setDangerEditsOpen(false)}>Cancel</Button>
                <Button onClick={saveDangerEdits} variant="contained">Save</Button>
            </DialogActions>
        </Dialog>
        </>
    );
}

export default Modules;
