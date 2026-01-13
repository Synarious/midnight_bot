import React, { useMemo, useState, useEffect } from 'react';
import {
    Box, Card, CardContent, Typography, Stack, Grid, CircularProgress
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
    TrendingUp as TrendingUpIcon,
    Message as MessageIcon,
    VoiceChat as VoiceIcon,
    Person as PersonIcon
} from '@mui/icons-material';
import { ResponsiveLine } from '@nivo/line';
import { useGuild } from '../context/GuildContext';
import { useSnackbar } from 'notistack';
import axios from 'axios';

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

function Activity() {
    const theme = useTheme();
    const { guildId } = useGuild();
    const { enqueueSnackbar } = useSnackbar();
    const [activityData, setActivityData] = useState({
        messagesLast24h: 0,
        activeMembersToday: 0,
        voiceMinutesToday: 0,
        topChannels: []
    });
    const [activityHistory, setActivityHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);

    useEffect(() => {
        if (!guildId) return;
        fetchActivityData();
        fetchActivityHistory();
    }, [guildId]);

    const fetchActivityData = async () => {
        setLoading(true);
        try {
            const response = await axios.get(`/api/guilds/${guildId}/activity`);
            setActivityData(response.data);
        } catch (error) {
            enqueueSnackbar('Failed to load activity data', { variant: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const fetchActivityHistory = async () => {
        setHistoryLoading(true);
        try {
            const response = await axios.get(`/api/guilds/${guildId}/activity/stats`, {
                params: { days: 30 }
            });
            const nextHistory = Array.isArray(response.data?.activity) ? response.data.activity : [];
            setActivityHistory(nextHistory);
        } catch (error) {
            enqueueSnackbar('Failed to load activity history', { variant: 'error' });
            setActivityHistory([]);
        } finally {
            setHistoryLoading(false);
        }
    };

    const nivoData = useMemo(() => {
        if (!Array.isArray(activityHistory) || activityHistory.length === 0) return [];

        const messages = {
            id: 'Messages',
            data: activityHistory.map((row) => ({ x: row.date, y: Number(row.messages || 0) })),
        };

        const voice = {
            id: 'Voice Minutes',
            data: activityHistory.map((row) => ({ x: row.date, y: Number(row.voice_minutes || 0) })),
        };

        return [messages, voice];
    }, [activityHistory]);

    if (!guildId) {
        return (
            <Typography variant="h5" color="text.secondary" align="center" sx={{ mt: 4 }}>
                Please enter a Guild ID above.
            </Typography>
        );
    }

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Grid container spacing={3}>
            {/* Header */}
            <Grid item xs={12}>
                <Card>
                    <CardContent>
                        <Typography variant="h5" gutterBottom>Activity Dashboard</Typography>
                        <Typography variant="body2" color="text.secondary">
                            View server activity metrics and trends.
                        </Typography>
                    </CardContent>
                </Card>
            </Grid>

            {/* Activity Stats */}
            <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="Messages (24h)"
                        value={activityData.messagesLast24h || 0}
                        icon={<MessageIcon />}
                        color="primary"
                    />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="Active Members"
                        value={activityData.activeMembersToday || 0}
                        icon={<PersonIcon />}
                        color="success"
                    />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="Voice Minutes"
                        value={activityData.voiceMinutesToday || 0}
                        icon={<VoiceIcon />}
                        color="info"
                    />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="Trending"
                        value="📈"
                        icon={<TrendingUpIcon />}
                        color="secondary"
                    />
            </Grid>

            {/* Top Channels */}
            <Grid item xs={12}>
                <Card>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>Most Active Channels</Typography>
                        {activityData.topChannels && activityData.topChannels.length > 0 ? (
                            <Stack spacing={2} sx={{ mt: 2 }}>
                                {activityData.topChannels.slice(0, 5).map((channel, idx) => (
                                    <Box 
                                        key={idx} 
                                        sx={{ 
                                            p: 2, 
                                            border: 1, 
                                            borderColor: 'divider', 
                                            borderRadius: 1,
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}
                                    >
                                        <Typography variant="body1" fontWeight="medium">
                                            #{channel.name || channel.channel_id}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {channel.count || channel.message_count} messages
                                        </Typography>
                                    </Box>
                                ))}
                            </Stack>
                        ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                                No activity data available yet.
                            </Typography>
                        )}
                    </CardContent>
                </Card>
            </Grid>

            {/* Activity Chart Placeholder */}
            <Grid item xs={12}>
                <Card>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>Activity Over Time</Typography>
                        <Box sx={{ height: 300, mt: 2 }}>
                            {historyLoading ? (
                                <Box display="flex" justifyContent="center" alignItems="center" minHeight="300px">
                                    <CircularProgress />
                                </Box>
                            ) : nivoData.length === 0 ? (
                                <Box
                                    sx={{
                                        height: 300,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        bgcolor: 'background.default',
                                        borderRadius: 1,
                                    }}
                                >
                                    <Typography variant="body2" color="text.secondary">
                                        No activity history available yet.
                                    </Typography>
                                </Box>
                            ) : (
                                <ResponsiveLine
                                    data={nivoData}
                                    margin={{ top: 20, right: 20, bottom: 60, left: 60 }}
                                    xScale={{ type: 'point' }}
                                    yScale={{ type: 'linear', min: 'auto', max: 'auto', stacked: false, reverse: false }}
                                    curve="monotoneX"
                                    axisBottom={{
                                        tickRotation: -45,
                                        legend: 'Date',
                                        legendOffset: 46,
                                        legendPosition: 'middle',
                                    }}
                                    axisLeft={{
                                        legend: 'Count',
                                        legendOffset: -46,
                                        legendPosition: 'middle',
                                    }}
                                    colors={[theme.palette.primary.main, theme.palette.info.main]}
                                    pointSize={4}
                                    pointBorderWidth={1}
                                    pointBorderColor={{ from: 'serieColor' }}
                                    enableArea={false}
                                    useMesh={true}
                                    theme={{
                                        text: { fill: theme.palette.text.primary },
                                        axis: {
                                            domain: { line: { stroke: theme.palette.divider } },
                                            ticks: { line: { stroke: theme.palette.divider }, text: { fill: theme.palette.text.secondary } },
                                            legend: { text: { fill: theme.palette.text.secondary } },
                                        },
                                        grid: { line: { stroke: theme.palette.divider } },
                                        tooltip: {
                                            container: {
                                                background: theme.palette.background.paper,
                                                color: theme.palette.text.primary,
                                                boxShadow: theme.shadows[2],
                                                borderRadius: 6,
                                            },
                                        },
                                    }}
                                />
                            )}
                        </Box>
                    </CardContent>
                </Card>
            </Grid>
        </Grid>
    );
}

export default Activity;
