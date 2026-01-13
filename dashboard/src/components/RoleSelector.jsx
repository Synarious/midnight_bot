import React from 'react';
import { Autocomplete, TextField, Chip, Box, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';

function RoleSelector({ label, value, onChange, options, multiple = true, disabled = false, helperText, placeholder, botRolePosition }) {
    const intToHex = (intColor) => {
        // Parse the input to integer, ensuring we handle string representations of numbers
        const colorVal = parseInt(intColor, 10);
        
        // Check if it's falsy (0) or NaN. Discord uses 0 for default/no color.
        if (!colorVal || isNaN(colorVal)) return '#99aab5'; 
        
        return `#${colorVal.toString(16).padStart(6, '0')}`;
    };

    const isRoleHigher = (rolePosition) => {
        if (botRolePosition === undefined || botRolePosition === null) return false;
        return rolePosition >= botRolePosition;
    };

    return (
        <Autocomplete
            disabled={disabled}
            multiple={multiple}
            options={options}
            getOptionLabel={(option) => option.name}
            getOptionDisabled={(option) => isRoleHigher(option.position)}
            value={value}
            isOptionEqualToValue={(option, val) => option.id === val.id}
            onChange={(_, newValue) => onChange(newValue)}
            renderTags={multiple ? (value, getTagProps) =>
                value.map((option, index) => {
                    const color = intToHex(option.color);
                    return (
                        <Chip 
                            variant="filled" 
                            label={option.name} 
                            size="small" 
                            {...getTagProps({ index })} 
                            sx={{
                                backgroundColor: option.color ? color : undefined,
                                color: option.color ? '#fff' : undefined,
                                '& .MuiChip-deleteIcon': {
                                    color: option.color ? 'rgba(255, 255, 255, 0.7)' : undefined,
                                    '&:hover': {
                                        color: option.color ? '#fff' : undefined
                                    }
                                }
                            }}
                        />
                    );
                }) : undefined
            }
            renderOption={(props, option) => {
                const color = intToHex(option.color);
                const higher = isRoleHigher(option.position);
                
                return (
                    <li {...props} style={{ opacity: higher ? 0.6 : 1 }}>
                         <Box sx={{ 
                            backgroundColor: higher ? '#e0e0e0' : color,
                            color: higher ? '#757575' : '#fff',
                            borderRadius: '4px',
                            padding: '4px 10px',
                            fontWeight: 500,
                            display: 'inline-flex',
                            alignItems: 'center',
                            lineHeight: '1.5',
                            gap: 0.5
                        }}>
                            {higher && <LockIcon sx={{ fontSize: 16 }} />}
                            {option.name}
                        </Box>
                    </li>
                );
            }}
            renderInput={(params) => (
                <TextField 
                    {...params} 
                    variant="outlined" 
                    label={label} 
                    placeholder={placeholder || (multiple ? "Select Roles" : "Select Role")}
                    helperText={helperText}
                />
            )}
            sx={{ mb: 2 }}
        />
    );
}

export default RoleSelector;
