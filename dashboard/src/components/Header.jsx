import React from 'react';
import { Box, AppBar, Toolbar, Typography, TextField, InputAdornment, IconButton } from '@mui/material';
import { Tag as HashtagIcon, Search as SearchIcon, Menu as MenuIcon } from '@mui/icons-material';
import { useGuild } from '../context/GuildContext';
import { useLocation } from 'react-router-dom';

const getPageTitle = (pathname) => {
    switch (pathname) {
        case '/general': return 'General Overview';
        case '/commands': return 'Command Management';
        case '/modules': return 'Modules';
        case '/moderation': return 'Moderation Settings';
        case '/activity': return 'Server Activity';
        case '/logging': return 'Logging Configuration';
        case '/onboarding': return 'Onboarding';
        case '/users': return 'User Management';
        default: return 'Dashboard';
    }
};

function Header({ onDrawerToggle }) {
    const { guildId, setGuildId } = useGuild();
    const location = useLocation();

    return (
        <AppBar position="sticky" elevation={0} sx={{ 
            bgcolor: 'background.default', 
            borderBottom: 1, 
            borderColor: 'divider',
            backdropFilter: 'blur(8px)'
        }}>
            <Toolbar>
                <IconButton
                    color="inherit"
                    aria-label="open drawer"
                    edge="start"
                    onClick={onDrawerToggle}
                    sx={{ mr: 2, display: { sm: 'none' } }}
                >
                    <MenuIcon />
                </IconButton>
                
                <Typography variant="h6" color="text.primary" sx={{ flexGrow: 1, fontWeight: 600 }}>
                    {getPageTitle(location.pathname)}
                </Typography>

                <Box sx={{ width: 250 }}>
                    <TextField
                        size="small"
                        placeholder="Guild ID"
                        value={guildId}
                        onChange={(e) => setGuildId(e.target.value)}
                        fullWidth
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <HashtagIcon fontSize="small" color="disabled" />
                                </InputAdornment>
                            ),
                        }}
                    />
                </Box>
            </Toolbar>
        </AppBar>
    );
}

export default Header;
