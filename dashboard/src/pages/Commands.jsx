import React, { useState, useEffect } from 'react';
import { 
    Box, Grid, Card, CardContent, Typography, Switch, Chip, Stack, Alert
} from '@mui/material';
import { useGuild } from '../context/GuildContext';
import axios from 'axios';
import { useSnackbar } from 'notistack';

export default function Commands() {
    const { guildId } = useGuild();
    const { enqueueSnackbar } = useSnackbar();
    const [commands, setCommands] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (guildId) fetchCommands();
    }, [guildId]);

    const fetchCommands = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`/api/guilds/${guildId}/commands`);
            const nextCommands = Array.isArray(res.data?.commands) ? res.data.commands : [];
            setCommands(nextCommands);
        } catch (error) {
            enqueueSnackbar('Failed to fetch commands', { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = async (commandName, currentStatus) => {
        const originalCommands = Array.isArray(commands) ? [...commands] : [];
        // Optimistic update
        setCommands(prev => {
            if (!Array.isArray(prev)) return prev;
            return prev.map(cmd =>
                cmd.command_name === commandName ? { ...cmd, enabled: !currentStatus } : cmd
            );
        });

        try {
            await axios.put(`/api/guilds/${guildId}/commands/${commandName}`, {
                enabled: !currentStatus
            });
            enqueueSnackbar(`Command ${!currentStatus ? 'enabled' : 'disabled'}`, { variant: 'success' });
        } catch (error) {
            // Revert
            setCommands(originalCommands);
            enqueueSnackbar('Failed to update command', { variant: 'error' });
        }
    };

    if (!guildId) return <Alert severity="info" sx={{ mt: 2 }}>Please select a guild to manage commands.</Alert>;

    // Group commands by category (assuming category is a field)
    const groupedGroups = (Array.isArray(commands) ? commands : []).reduce((acc, cmd) => {
        const cat = cmd.category || 'Uncategorized';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(cmd);
        return acc;
    }, {});

    return (
        <Box>
            {Object.entries(groupedGroups).map(([category, cmds]) => (
                <Box key={category} sx={{ mb: 4 }}>
                    <Typography variant="h5" sx={{ mb: 2, textTransform: 'capitalize' }}>{category}</Typography>
                    <Grid container spacing={2}>
                        {cmds.map((cmd) => (
                            <Grid item xs={12} sm={6} md={4} key={cmd.command_name}>
                                <Card variant="outlined">
                                    <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 2, '&:last-child': { pb: 2 } }}>
                                        <Box>
                                            <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
                                                {cmd.command_name}
                                            </Typography>
                                            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                                                {cmd.has_slash && <Chip size="small" label="/" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.625rem' }} />}
                                                {cmd.has_prefix && <Chip size="small" label="!" color="secondary" variant="outlined" sx={{ height: 20, fontSize: '0.625rem' }} />}
                                            </Stack>
                                        </Box>
                                        <Switch 
                                            checked={cmd.enabled !== false}
                                            onChange={() => handleToggle(cmd.command_name, cmd.enabled !== false)}
                                            disabled={loading}
                                        />
                                    </CardContent>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>
                </Box>
            ))}
        </Box>
    );
}
