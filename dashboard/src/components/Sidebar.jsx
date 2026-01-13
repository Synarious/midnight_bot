import React from 'react';
import { 
  Box, 
  Drawer, 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText, 
  Divider, 
  Typography,
  Avatar,
  Stack
} from '@mui/material';
import { 
  Dashboard as DashboardIcon,
  Terminal as TerminalIcon,
  ViewModule as ModulesIcon,
  Gavel as ModerationIcon,
  Timeline as ActivityIcon,
  ListAlt as LoggingIcon,
  FlightTakeoff as OnboardingIcon,
  People as UsersIcon,
  Logout as LogoutIcon
} from '@mui/icons-material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const drawerWidth = 240;

const MENU_ITEMS = [
  { text: 'General', icon: <DashboardIcon />, path: '/general' },
  { text: 'Commands', icon: <TerminalIcon />, path: '/commands' },
  { text: 'Modules', icon: <ModulesIcon />, path: '/modules' },
  { text: 'Moderation', icon: <ModerationIcon />, path: '/moderation' },
  { text: 'Activity', icon: <ActivityIcon />, path: '/activity' },
  { text: 'Logging', icon: <LoggingIcon />, path: '/logging' },
  { text: 'Onboarding', icon: <OnboardingIcon />, path: '/onboarding' },
];

const ADMIN_ITEMS = [
  { text: 'User Management', icon: <UsersIcon />, path: '/users' },
];

function Sidebar({ mobileOpen, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleNavigate = (path) => {
      navigate(path);
      if (mobileOpen && onClose) onClose();
  };

  const drawerContent = (
      <>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, height: 64 }}>
        <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>M</Avatar>
        <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 'bold' }}>
          Midnight Bot
        </Typography>
      </Box>
      <Divider />
      <Box sx={{ overflow: 'auto', flexGrow: 1 }}>
        <List sx={{ p: 1 }}>
          {MENU_ITEMS.map((item) => {
            const isSelected = location.pathname === item.path;
            return (
                <ListItem key={item.text} disablePadding sx={{ mb: 0.5 }}>
                <ListItemButton 
                    selected={isSelected}
                    onClick={() => handleNavigate(item.path)}
                    sx={{
                        borderRadius: 1,
                        minHeight: 44,
                        borderLeft: isSelected ? '4px solid' : '4px solid transparent',
                        borderColor: isSelected ? 'primary.main' : 'transparent',
                        ml: isSelected ? 0 : 0.5, 
                        pl: isSelected ? 1.5 : 2, 
                        '&.Mui-selected': {
                            bgcolor: 'action.selected',
                            '&:hover': {
                                bgcolor: 'action.selected',
                            }
                        }
                    }}
                >
                    <ListItemIcon sx={{ 
                        color: isSelected ? 'primary.main' : 'inherit',
                        minWidth: 40
                    }}>
                    {item.icon}
                    </ListItemIcon>
                    <ListItemText 
                        primary={item.text} 
                        primaryTypographyProps={{ 
                            fontSize: '0.9rem', 
                            fontWeight: isSelected ? 600 : 400,
                            color: isSelected ? 'text.primary' : 'text.secondary' 
                        }}
                    />
                </ListItemButton>
                </ListItem>
            );
          })}
        </List>
        <Divider sx={{ my: 1 }} />
        <List subheader={<Typography variant="overline" sx={{ px: 3, py: 1, color: 'text.secondary', fontWeight: 700, letterSpacing: 1 }}>Admin</Typography>} sx={{ p: 1 }}>
            {ADMIN_ITEMS.map((item) => {
                const isSelected = location.pathname === item.path;
                return (
                    <ListItem key={item.text} disablePadding sx={{ mb: 0.5 }}>
                        <ListItemButton 
                        selected={isSelected}
                        onClick={() => handleNavigate(item.path)}
                        sx={{
                            borderRadius: 1,
                            minHeight: 44,
                            borderLeft: isSelected ? '4px solid' : '4px solid transparent',
                            borderColor: isSelected ? 'secondary.main' : 'transparent',
                            ml: isSelected ? 0 : 0.5,
                            pl: isSelected ? 1.5 : 2,
                            '&.Mui-selected': {
                                bgcolor: 'rgba(236, 72, 153, 0.12)', 
                                '&:hover': { bgcolor: 'rgba(236, 72, 153, 0.16)' },
                            }
                        }}
                        >
                        <ListItemIcon sx={{ 
                            color: isSelected ? 'secondary.main' : 'inherit',
                            minWidth: 40
                        }}>
                            {item.icon}
                        </ListItemIcon>
                        <ListItemText 
                            primary={item.text} 
                            primaryTypographyProps={{ 
                                fontSize: '0.9rem', 
                                fontWeight: isSelected ? 600 : 400 
                            }}
                        />
                        </ListItemButton>
                    </ListItem>
                );
            })}
        </List>
      </Box>

      {/* User Info / Logout */}
      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Stack direction="row" alignItems="center" spacing={2}>
              <Avatar sx={{ width: 36, height: 36, border: '1px solid', borderColor: 'divider' }}>
                  {user?.username?.charAt(0).toUpperCase()}
              </Avatar>
              <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                  <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>{user?.username}</Typography>
                  <Typography variant="caption" color="text.secondary">Admin</Typography>
              </Box>
              <LogoutIcon 
                  sx={{ 
                      cursor: 'pointer', 
                      color: 'text.secondary', 
                      opacity: 0.7, 
                      transition: 'all 0.2s',
                      '&:hover': { 
                          color: 'error.main',
                          opacity: 1 
                      } 
                  }} 
                  onClick={logout}
              />
          </Stack>
      </Box>
      </>
  );

  return (
    <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
        aria-label="mailbox folders"
    >
      <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={onClose}
          ModalProps={{
            keepMounted: true, 
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
      >
        {drawerContent}
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', sm: 'block' },
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth, borderRight: '1px solid rgba(148, 163, 184, 0.12)' },
        }}
        open
      >
        {drawerContent}
      </Drawer>
    </Box>
  );
}

export default Sidebar;
