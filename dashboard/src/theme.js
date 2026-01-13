import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#6366f1', // Indigo 500
      light: '#818cf8',
      dark: '#4f46e5',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#ec4899', // Pink 500
    },
    background: {
      default: '#0f172a', // Slate 900
      paper: '#1e293b',   // Slate 800
    },
    text: {
      primary: '#f8fafc', // Slate 50
      secondary: '#94a3b8', // Slate 400
    },
    divider: 'rgba(148, 163, 184, 0.12)',
    action: {
      hover: 'rgba(148, 163, 184, 0.08)',
      selected: 'rgba(99, 102, 241, 0.16)', // Primary-ish selection
    },
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 700, fontSize: '2.5rem' },
    h2: { fontWeight: 600, fontSize: '2rem' },
    h3: { fontWeight: 600, fontSize: '1.75rem' },
    h4: { fontWeight: 600, fontSize: '1.5rem' },
    h5: { fontWeight: 600, fontSize: '1.25rem' },
    h6: { fontWeight: 600, fontSize: '1rem' },
    body1: { fontSize: '0.9375rem', lineHeight: 1.5 },
    body2: { fontSize: '0.875rem', lineHeight: 1.43 },
    button: { fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: "#334155 #0f172a",
          "&::-webkit-scrollbar, & *::-webkit-scrollbar": {
            width: 8,
            height: 8,
          },
          "&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb": {
            borderRadius: 8,
            backgroundColor: "#334155",
            border: "2px solid #0f172a", // visual gap
          },
          "&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track": {
            borderRadius: 8,
            backgroundColor: "#0f172a",
          },
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
          padding: '6px 16px', // Reduced vertical padding
        },
        sizeSmall: {
          padding: '4px 10px',
        },
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid rgba(148, 163, 184, 0.1)',
          backgroundColor: '#1e293b',
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: '16px', // Default is usually more
          '&:last-child': {
            paddingBottom: '16px',
          },
        },
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        root: {
          padding: '16px 16px 8px',
        },
        title: {
          fontSize: '1.125rem',
          fontWeight: 600,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small', // Compact by default
        variant: 'outlined',
      },
    },
    MuiFormControl: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiSelect: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(148, 163, 184, 0.2)',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(148, 163, 184, 0.4)',
          },
        },
        input: {
          padding: '8.5px 14px', // Tweak for 'small' feel consistency
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 500,
        },
        sizeSmall: {
          fontSize: '0.75rem',
          height: 24,
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          width: 42,
          height: 26,
          padding: 0,
        },
        switchBase: {
          padding: 0,
          margin: 2,
          transitionDuration: '300ms',
          '&.Mui-checked': {
            transform: 'translateX(16px)',
            color: '#fff',
            '& + .MuiSwitch-track': {
              backgroundColor: '#6366f1',
              opacity: 1,
              border: 0,
            },
          },
        },
        thumb: {
          boxShadow: '0 2px 4px 0 rgb(0 35 11 / 20%)',
          width: 22,
          height: 22,
          borderRadius: 11,
        },
        track: {
          borderRadius: 26 / 2,
          opacity: 1,
          backgroundColor: '#334155',
        },
      },
    },
  },
});

export default theme;
