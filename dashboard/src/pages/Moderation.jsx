import React, { useState, useEffect } from 'react';
import {
    Card, CardContent, Typography, Stack, Switch, Grid, TextField, Autocomplete, Chip,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Avatar
} from '@mui/material';
import { useGuild } from '../context/GuildContext';
import { useSnackbar } from 'notistack';
import axios from 'axios';
import RoleSelector from '../components/RoleSelector';


function Moderation() {
    const { guildId, roles, channels, botHighestRolePosition } = useGuild();
    const { enqueueSnackbar } = useSnackbar();
    const [settings, setSettings] = useState({});
    const [mutedUsers, setMutedUsers] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!guildId) return;
        fetchData();
    }, [guildId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [settingsRes, mutedRes] = await Promise.all([
                axios.get(`/api/guilds/${guildId}/settings`),
                axios.get(`/api/guilds/${guildId}/moderation/muted`).catch(() => ({ data: { users: [] } }))
            ]);
            setSettings(settingsRes.data.settings);
            setMutedUsers(mutedRes.data.users || []);
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
            enqueueSnackbar('Setting updated successfully', { variant: 'success' });
        } catch (error) {
            enqueueSnackbar('Failed to update setting', { variant: 'error' });
        }
    };

    const getRolesFromIds = (roleIds) => {
        if (!roleIds || !Array.isArray(roleIds)) return [];
        return roleIds
            .map((id) => roles.find((r) => String(r.id) === String(id)))
            .filter(Boolean);
    };

    const handleRoleChange = async (key, newRoles) => {
        const roleIds = newRoles.map(r => r.id);
        await handleSettingChange(key, roleIds);
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
                    <Typography variant="h5" gutterBottom>Moderation</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Manage moderation settings and view recent moderation actions.
                    </Typography>
                </CardContent>
            </Card>

            {/* Currently Muted/Actioned Users */}
            <Card>
                <CardContent>
                    <Typography variant="h6" gutterBottom>Currently Muted Users</Typography>
                    {mutedUsers.length > 0 ? (
                        <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>User</TableCell>
                                        <TableCell>Reason</TableCell>
                                        <TableCell>Actioned By</TableCell>
                                        <TableCell>Expires</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {mutedUsers.slice(0, 10).map((user, idx) => (
                                        <TableRow key={idx}>
                                            <TableCell>
                                                <Stack direction="row" alignItems="center" spacing={1}>
                                                    <Avatar sx={{ width: 24, height: 24 }}>U</Avatar>
                                                    <Typography variant="body2">{user.user_id}</Typography>
                                                </Stack>
                                            </TableCell>
                                            <TableCell>{user.reason || 'No reason provided'}</TableCell>
                                            <TableCell>{user.actioned_by || 'Unknown'}</TableCell>
                                            <TableCell>{user.expires || 'Permanent'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    ) : (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                            No currently muted users.
                        </Typography>
                    )}
                </CardContent>
            </Card>


            <Grid container spacing={3}>
                <Grid item xs={12} sm={6} lg={4}>
                    <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                            <Stack direction="row" spacing={2} alignItems="flex-start">
                                <Stack sx={{ pt: 0.5 }}>
                                    <Switch
                                        checked={settings.enable_automod !== false}
                                        onChange={(e) => handleSettingChange('enable_automod', e.target.checked)}
                                        disabled={loading}
                                    />
                                </Stack>
                                <Stack spacing={1} sx={{ flexGrow: 1 }}>
                                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                                        <Typography variant="subtitle1" fontWeight="medium">Automod</Typography>
                                        <Chip
                                            label={settings.enable_automod !== false ? 'Enabled' : 'Disabled'}
                                            color={settings.enable_automod !== false ? 'success' : 'default'}
                                            size="small"
                                        />
                                    </Stack>
                                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                                        Configuration coming soon.
                                    </Typography>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid item xs={12} sm={6} lg={4}>
                    <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                            <Stack direction="row" spacing={2} alignItems="flex-start">
                                <Stack sx={{ pt: 0.5 }}>
                                    <Switch
                                        checked={settings.enable_openAI !== false}
                                        onChange={(e) => handleSettingChange('enable_openAI', e.target.checked)}
                                        disabled={loading}
                                    />
                                </Stack>
                                <Stack spacing={1} sx={{ flexGrow: 1 }}>
                                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                                        <Typography variant="subtitle1" fontWeight="medium">OpenAI Moderation</Typography>
                                        <Chip
                                            label={settings.enable_openAI !== false ? 'Enabled' : 'Disabled'}
                                            color={settings.enable_openAI !== false ? 'success' : 'default'}
                                            size="small"
                                        />
                                    </Stack>
                                    <Typography variant="body2" color="text.secondary">
                                        Use OpenAI's moderation API to automatically detect and flag harmful content.
                                    </Typography>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid item xs={12} sm={6} lg={4}>
                    <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                            <Stack direction="row" spacing={2} alignItems="flex-start">
                                <Stack sx={{ pt: 0.5, width: 42 }} />
                                <Stack spacing={2} sx={{ flexGrow: 1 }}>
                                    <Typography variant="subtitle1" fontWeight="medium">Muting</Typography>
                                    <RoleSelector
                                        label="Mute Role"
                                        value={roles.find((r) => String(r.id) === String(settings.mute_roleID)) || null}
                                        onChange={(newValue) => handleSettingChange('mute_roleID', newValue?.id || null)}
                                        options={roles}
                                        multiple={false}
                                        disabled={loading}
                                        botRolePosition={botHighestRolePosition}
                                    />
                                    <RoleSelector
                                        label="Roles Removed When Muted"
                                        value={getRolesFromIds(settings.mute_rolesRemoved)}
                                        onChange={(v) => handleRoleChange('mute_rolesRemoved', v)}
                                        options={roles}
                                        botRolePosition={botHighestRolePosition}
                                    />
                                    <Typography variant="body2" color="text.secondary">
                                        When a user is muted, they will be given the mute role and the selected roles will be temporarily removed.
                                    </Typography>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid item xs={12} sm={6} lg={4}>
                    <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                            <Stack direction="row" spacing={2} alignItems="flex-start">
                                <Stack sx={{ pt: 0.5, width: 42 }} />
                                <Stack spacing={2} sx={{ flexGrow: 1 }}>
                                    <Typography variant="subtitle1" fontWeight="medium">Bans</Typography>
                                    <RoleSelector
                                        label="Ban Immune Roles"
                                        value={getRolesFromIds(settings.ban_immuneRoles)}
                                        onChange={(v) => handleRoleChange('ban_immuneRoles', v)}
                                        options={roles}
                                    />
                                    <Typography variant="body2" color="text.secondary">
                                        Users with these roles cannot be banned by moderators.
                                    </Typography>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid item xs={12} sm={6} lg={4}>
                    <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                            <Stack direction="row" spacing={2} alignItems="flex-start">
                                <Stack sx={{ pt: 0.5, width: 42 }} />
                                <Stack spacing={2} sx={{ flexGrow: 1 }}>
                                    <Typography variant="subtitle1" fontWeight="medium">Kicks</Typography>
                                    <RoleSelector
                                        label="Kick Immune Roles"
                                        value={getRolesFromIds(settings.kick_immuneRoles)}
                                        onChange={(v) => handleRoleChange('kick_immuneRoles', v)}
                                        options={roles}
                                    />
                                    <Typography variant="body2" color="text.secondary">
                                        Users with these roles cannot be kicked by moderators.
                                    </Typography>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Stack>
    );
}

export default Moderation;
