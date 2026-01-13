import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import ConstructionIcon from '@mui/icons-material/Construction';

export default function Placeholder({ title }) {
    return (
        <Paper 
            sx={{ 
                p: 5, 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center',
                minHeight: '400px',
                textAlign: 'center'
            }}
        >
            <ConstructionIcon sx={{ fontSize: 60, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h4" gutterBottom>
                {title || 'Under Construction'}
            </Typography>
            <Typography variant="body1" color="text.secondary">
                This section is currently being overhauled. Check back soon for the new material design implementation.
            </Typography>
        </Paper>
    );
}
